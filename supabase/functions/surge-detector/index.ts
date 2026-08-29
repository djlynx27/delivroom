import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { captureEdgeException } from '../_shared/sentry.ts';
import {
  decidePush,
  formatSurgeMessage,
  isRisingIntoPeak,
  type NewPeakCandidate,
  type PriorSurgeState,
} from './surgePush.ts';

/**
 * surge-detector — Edge Function Delivroom
 *
 * Batch surge detection exécuté toutes les 5 min via pg_cron.
 * Pour chaque zone active :
 *   1. Récupère le score actuel + baseline 4 semaines
 *   2. Calcule le multiplicateur de surge (formule sigmoid)
 *   3. Stocke le vecteur de contexte 8D dans zone_context_vectors
 *   4. Envoie une notification push ciblée (top 3 zones) uniquement pour les
 *      zones qui franchissent 'peak' vers le haut ce cycle-ci, avec cooldown
 *      (~50 min) et dédup — voir la section "Push noise control" plus bas
 *
 * Appelé par pg_cron :
 *   SELECT cron.schedule('surge-detector', every-5-minutes,
 *     $$SELECT net.http_post('https://<project>.supabase.co/functions/v1/surge-detector',
 *       '{}', 'application/json',
 *       ARRAY[http_header('Authorization','Bearer <service_role_key>')])$$
 *   );
 */

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type',
};

// ── Surge thresholds (matches surgeEngine.ts) ─────────────────────────────────
const SURGE_THRESHOLDS = {
  elevated: 1.18,
  high: 1.45,
  peak: 1.8,
} as const;

type SurgeClass = 'normal' | 'elevated' | 'high' | 'peak';

// ── DOW baseline (Mon=0 … Sun=6), Fri = 1.00 reference ───────────────────────
const DOW_BASELINE = [0.72, 0.78, 0.83, 0.88, 0.95, 1.0, 0.97];

// ── Monthly seasonal index (index 0 = Jan) ────────────────────────────────────
const SEASONAL_INDEX = [
  1.15, 1.08, 0.98, 0.92, 0.88, 0.9, 1.1, 1.05, 0.95, 0.88, 0.93, 1.18,
];

function sigmoid(x: number): number {
  return 1 / (1 + Math.exp(-x));
}

function computeSurgeFast(
  currentScore: number,
  baselineScore: number,
  now: Date
): { surgeMultiplier: number; surgeClass: SurgeClass } {
  const safeBaseline = baselineScore > 0 ? baselineScore : currentScore * 0.85;
  const dow = now.getDay();
  const month = now.getMonth();

  const dowFactor = DOW_BASELINE[dow] ?? 0.88;
  const seasonal = SEASONAL_INDEX[month] ?? 1.0;

  const adjustedBaseline = safeBaseline * dowFactor * seasonal;
  const rawRatio = adjustedBaseline > 0 ? currentScore / adjustedBaseline : 1.0;

  // Sigmoid shaping: 0.5 ratio → 1.0×, 2.0 ratio → ~2.0×
  const shaped = 0.5 + 2.0 * sigmoid(3.5 * (rawRatio - 1.0));
  const surgeMultiplier = Math.max(1.0, Math.min(2.5, shaped));

  let surgeClass: SurgeClass = 'normal';
  if (surgeMultiplier >= SURGE_THRESHOLDS.peak) surgeClass = 'peak';
  else if (surgeMultiplier >= SURGE_THRESHOLDS.high) surgeClass = 'high';
  else if (surgeMultiplier >= SURGE_THRESHOLDS.elevated)
    surgeClass = 'elevated';

  return { surgeMultiplier, surgeClass };
}

function buildContextVector(
  now: Date,
  currentScore: number,
  surgeMultiplier: number
): number[] {
  const hour = now.getHours() + now.getMinutes() / 60;
  const dow = now.getDay();
  const month = now.getMonth();

  return [
    hour / 24, // [0] heure normalisée
    dow / 6, // [1] jour de semaine normalisé
    0, // [2] météo (non dispo en EF batch)
    0, // [3] événements (non dispo en EF batch)
    0, // [4] trafic (non dispo en EF batch)
    (surgeMultiplier - 1.0) / 1.5, // [5] surge ratio normalisé
    0, // [6] deadhead inverse (non dispo)
    (SEASONAL_INDEX[month] ?? 1.0) - 0.88, // [7] indice saisonnier centré
  ];
}

interface Zone {
  id: string;
  name: string;
  current_score: number;
  base_score: number | null;
  city_id: string;
}

/** Most recent zone_context_vectors row per zone, keyed by zone_id — the
 * state to diff THIS cycle's class against to detect a rising edge (see
 * isRisingIntoPeak in surgePush.ts). Queried before this cycle's own rows
 * are inserted, so it's naturally "prior". */
// Generic over the client type rather than pinned to ReturnType<typeof
// createClient> — supabase-js's default generic instantiation isn't
// self-assignable across separate call sites in this version, which made a
// pinned param type fail `deno check` even though the value at the one call
// site is exactly right.
async function loadPriorSurgeState<
  T extends { from: (table: string) => { select: (columns: string) => any } },
>(supabase: T, zoneIds: string[]): Promise<Map<string, PriorSurgeState>> {
  const { data, error } = await supabase
    .from('zone_context_vectors')
    .select('zone_id, surge_class, surge_multiplier, captured_at')
    .in('zone_id', zoneIds)
    .order('captured_at', { ascending: false });
  if (error) throw new Error(`Prior surge state lookup failed: ${error.message}`);

  const byZone = new Map<string, PriorSurgeState>();
  for (const row of (data ?? []) as Array<PriorSurgeState & { zone_id: string }>) {
    if (!byZone.has(row.zone_id)) {
      byZone.set(row.zone_id, { surge_class: row.surge_class, surge_multiplier: row.surge_multiplier });
    }
  }
  return byZone;
}

// eslint-disable-next-line complexity
serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, serviceKey);

    const now = new Date();

    // 1. Fetch all active zones with current scores
    const { data: zones, error: zonesErr } = await supabase
      .from('zones')
      .select('id, name, current_score, base_score, city_id')
      .not('current_score', 'is', null);

    if (zonesErr) throw zonesErr;
    if (!zones || zones.length === 0) {
      return new Response(
        JSON.stringify({ ok: true, processed: 0, message: 'No zones found' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const results: Array<{
      zone_id: string;
      zone_name: string;
      surge_class: SurgeClass;
      surge_multiplier: number;
    }> = [];

    const priorByZone = await loadPriorSurgeState(
      supabase,
      (zones as Zone[]).map((z) => z.id)
    );
    const newPeakCandidates: NewPeakCandidate[] = [];

    for (const zone of zones as Zone[]) {
      if (zone.current_score == null) continue;

      // 2. Get 4-week rolling baseline for this zone/slot
      const hour = now.getHours();
      const dow = now.getDay();

      // get_surge_baseline(p_zone_id, p_hour_slot, p_dow) returns a bare
      // numeric (see 20260320000001_pgvector_context.sql) — not a row set,
      // so `data` here is already the scalar, never an array to index into.
      const { data: baselineData, error: baselineError } = await supabase.rpc(
        'get_surge_baseline',
        {
          p_zone_id: zone.id,
          p_hour_slot: hour,
          p_dow: dow,
        }
      );

      if (baselineError) {
        throw new Error(
          `Surge baseline lookup failed for zone ${zone.id}: ${baselineError.message}`
        );
      }

      const baselineScore: number =
        (baselineData as number | null) ??
        zone.base_score ??
        zone.current_score * 0.85;

      // 3. Compute surge
      const { surgeMultiplier, surgeClass } = computeSurgeFast(
        zone.current_score,
        baselineScore,
        now
      );

      // 4. Store vector (skip 'normal' to avoid DB bloat)
      if (surgeClass !== 'normal') {
        const contextVector = buildContextVector(
          now,
          zone.current_score,
          surgeMultiplier
        );
        const vectorStr = `[${contextVector.map((v) => v.toFixed(6)).join(',')}]`;

        const { error: contextInsertError } = await supabase
          .from('zone_context_vectors')
          .insert({
            zone_id: zone.id,
            context_vector: vectorStr,
            surge_multiplier: surgeMultiplier,
            surge_class: surgeClass,
            captured_at: now.toISOString(),
          });

        if (contextInsertError) {
          throw new Error(
            `Surge context insert failed for zone ${zone.id}: ${contextInsertError.message}`
          );
        }
      }

      const prior = priorByZone.get(zone.id);
      if (isRisingIntoPeak(surgeClass, prior)) {
        newPeakCandidates.push({
          zone_id: zone.id,
          zone_name: zone.name,
          surge_multiplier: surgeMultiplier,
          delta: surgeMultiplier - (prior?.surge_multiplier ?? surgeMultiplier),
        });
      }

      results.push({
        zone_id: zone.id,
        zone_name: zone.name,
        surge_class: surgeClass,
        surge_multiplier: Math.round(surgeMultiplier * 100) / 100,
      });
    }

    // 5. Push notification — only for zones that newly crossed into 'peak'
    // this cycle, gated by cooldown + dedup. All decision logic lives in
    // surgePush.ts (pure, unit-tested); this is just the I/O around it.
    const { data: lastPeakNotif, error: lastPeakErr } = await supabase
      .from('notifications')
      .select('created_at, metadata')
      .eq('type', 'surge_peak')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (lastPeakErr) throw new Error(`Last surge_peak lookup failed: ${lastPeakErr.message}`);

    const { decision: pushDecision, top3, signature } = decidePush({
      candidates: newPeakCandidates,
      lastPush: lastPeakNotif
        ? {
            createdAtMs: new Date(lastPeakNotif.created_at as string).getTime(),
            signature: (lastPeakNotif.metadata as { signature?: string } | null)?.signature,
          }
        : null,
      nowMs: now.getTime(),
    });

    if (pushDecision === 'sent') {
      const { title, body } = formatSurgeMessage(top3);

      const { error: notificationInsertError } = await supabase
        .from('notifications')
        .insert({
          type: 'surge_peak',
          title,
          message: body,
          metadata: {
            zones: top3.map((c) => c.zone_id),
            signature,
            detected_at: now.toISOString(),
          },
          created_at: now.toISOString(),
        });
      if (notificationInsertError) {
        throw new Error(`Peak notification insert failed: ${notificationInsertError.message}`);
      }

      const pushResponse = await fetch(`${supabaseUrl}/functions/v1/push-notifier`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${serviceKey}`,
          apikey: serviceKey,
        },
        body: JSON.stringify({ title, body, url: '/', tag: 'surge-peak' }),
      });
      if (!pushResponse.ok) {
        throw new Error(`Push notifier failed with status ${pushResponse.status}`);
      }
    }

    return new Response(
      JSON.stringify({
        ok: true,
        processed: results.length,
        new_peak_candidates: newPeakCandidates.map((c) => c.zone_name),
        push: pushDecision,
        results,
        timestamp: now.toISOString(),
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[surge-detector]', message);
    captureEdgeException(err, 'surge-detector', { url: req.url, method: req.method });
    return new Response(JSON.stringify({ ok: false, error: message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
