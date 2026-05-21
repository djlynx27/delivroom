import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

/**
 * platform-signal-collector — Edge Function Delivroom
 *
 * Collecte les signaux de demande par plateforme (Lyft, DoorDash, Skip, Hypra)
 * pour alimenter le moteur d'arbitrage (PlatformArbitrage).
 *
 * Routes :
 *
 *   POST /platform-signal-collector
 *     { action: 'infer', zone_id, zone_score, weather_score?, event_active? }
 *     → Génère des signaux inférés (~IA) par plateforme basés sur le score zone.
 *       Utilité : fallback quand pas de capture screenshot.
 *
 *   POST /platform-signal-collector
 *     { action: 'store', zone_id, platform, demand_level, surge_active?,
 *       surge_multiplier?, estimated_wait_min? }
 *     → Stocke un signal capturé manuellement ou via analyze-screenshot.
 *
 *   POST /platform-signal-collector
 *     { action: 'infer_all', city_id }
 *     → Génère des signaux inférés pour toutes les zones d'une ville.
 *       Appelé par pg_cron ou score-calculator après chaque recalcul.
 *
 *   GET /platform-signal-collector?zone_id=xxx&lookback_min=30
 *     → Retourne les signaux récents pour une zone (meilleure plateforme en tête).
 */

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type',
};

// ── Platform demand profiles ───────────────────────────────────────────────────
// Each platform has an inherent demand bias per hour range.
// These offsets modulate the zone's base score to produce a per-platform demand_level.
// Calibrated for Montreal gig market.
const PLATFORM_PROFILES: Record<
  string,
  {
    label: string;
    // Hourly bias: index = hour (0–23), value = multiplier on zone score
    hourlyBias: number[];
    // Extra surge propensity (0.0 = never surges, 1.0 = always surges when score > 80)
    surgePropensity: number;
  }
> = {
  lyft: {
    label: 'Lyft',
    hourlyBias: [
      // 00  01  02  03  04  05  06  07  08  09  10  11
      1.3, 1.5, 1.8, 0.6, 0.3, 0.4, 0.7, 1.0, 1.2, 1.0, 0.9, 0.8,
      // 12  13  14  15  16  17  18  19  20  21  22  23
      0.8, 0.9, 1.0, 1.1, 1.4, 1.5, 1.3, 1.2, 1.2, 1.4, 1.6, 1.4,
    ],
    surgePropensity: 0.75,
  },
  doordash: {
    label: 'DoorDash',
    hourlyBias: [
      // 00  01  02  03  04  05  06  07  08  09  10  11
      0.6, 0.5, 0.4, 0.2, 0.1, 0.2, 0.4, 0.7, 0.9, 0.8, 0.9, 1.1,
      // 12  13  14  15  16  17  18  19  20  21  22  23
      1.3, 1.2, 1.1, 1.0, 1.0, 1.2, 1.5, 1.6, 1.4, 1.3, 1.2, 1.0,
    ],
    surgePropensity: 0.45,
  },
  skipthedishes: {
    label: 'SkipTheDishes',
    hourlyBias: [
      // 00  01  02  03  04  05  06  07  08  09  10  11
      0.5, 0.4, 0.3, 0.2, 0.1, 0.2, 0.4, 0.6, 0.8, 0.8, 1.0, 1.2,
      // 12  13  14  15  16  17  18  19  20  21  22  23
      1.4, 1.3, 1.1, 1.0, 1.0, 1.3, 1.6, 1.7, 1.5, 1.3, 1.1, 0.8,
    ],
    surgePropensity: 0.3,
  },
  hypra: {
    label: 'Hypra',
    hourlyBias: [
      // 00  01  02  03  04  05  06  07  08  09  10  11
      1.0, 1.2, 1.5, 0.5, 0.2, 0.3, 0.5, 0.8, 1.0, 1.0, 1.0, 0.9,
      // 12  13  14  15  16  17  18  19  20  21  22  23
      0.9, 1.0, 1.1, 1.2, 1.4, 1.5, 1.4, 1.3, 1.3, 1.5, 1.7, 1.3,
    ],
    surgePropensity: 0.6,
  },
};

const SUPPORTED_PLATFORMS = Object.keys(PLATFORM_PROFILES);

function clamp(val: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, val));
}

/**
 * Infers demand_level and surge_active for a platform from zone score + hour.
 * This is the "fallback" inference model — no AI required.
 */
function inferPlatformSignal(
  platform: string,
  zoneScore: number,
  hour: number,
  weatherScore = 0,
  eventActive = false
): {
  demand_level: number;
  surge_active: boolean;
  surge_multiplier: number | null;
} {
  const profile = PLATFORM_PROFILES[platform];
  if (!profile) throw new Error(`Unknown platform: ${platform}`);

  const bias = profile.hourlyBias[hour] ?? 1.0;
  // Normalise zone score 0–100 → 0–10 demand scale with platform bias
  const baseDemand = clamp((zoneScore / 100) * 10 * bias, 0, 10);
  // Weather boost (demandBoostPoints already normalised 0–20)
  const weatherBoost = clamp(weatherScore / 20, 0, 0.8);
  // Event boost
  const eventBoost = eventActive ? 0.7 : 0;

  const demand_level = clamp(
    Math.round((baseDemand + weatherBoost + eventBoost) * 10) / 10,
    0,
    10
  );

  // Surge active when demand is high enough and platform is surge-prone
  const surgeThreshold = 10 - profile.surgePropensity * 3; // 7.0–8.5 depending on platform
  const surge_active = demand_level >= surgeThreshold;
  const surge_multiplier = surge_active
    ? Math.round((1.0 + (demand_level - surgeThreshold) * 0.25) * 100) / 100
    : null;

  return { demand_level, surge_active, surge_multiplier };
}

interface StoreBody {
  action: 'store';
  zone_id: string;
  platform: string;
  demand_level: number;
  surge_active?: boolean;
  surge_multiplier?: number;
  estimated_wait_min?: number;
}

interface InferBody {
  action: 'infer';
  zone_id: string;
  zone_score: number;
  weather_score?: number;
  event_active?: boolean;
}

interface InferAllBody {
  action: 'infer_all';
  city_id: string;
}

interface ZoneRow {
  id: string;
  current_score: number;
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
    const hour = now.getHours();

    // ── GET: fetch recent signals for a zone ──────────────────────────────────
    if (req.method === 'GET') {
      const url = new URL(req.url);
      const zone_id = url.searchParams.get('zone_id');
      const lookback_min = parseInt(
        url.searchParams.get('lookback_min') ?? '30',
        10
      );

      if (!zone_id) {
        return new Response(JSON.stringify({ error: 'zone_id required' }), {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      const { data, error } = await supabase.rpc('get_best_platform_for_zone', {
        p_zone_id: zone_id,
        p_lookback: `${lookback_min} minutes`,
      });

      if (error) throw error;

      return new Response(JSON.stringify({ zone_id, platforms: data ?? [] }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const body = (await req.json()) as StoreBody | InferBody | InferAllBody;

    // ── POST action: store ─────────────────────────────────────────────────────
    if (body.action === 'store') {
      const {
        zone_id,
        platform,
        demand_level,
        surge_active,
        surge_multiplier,
        estimated_wait_min,
      } = body;

      if (!zone_id || !platform || demand_level == null) {
        return new Response(
          JSON.stringify({ error: 'zone_id, platform, demand_level required' }),
          {
            status: 400,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          }
        );
      }

      if (!SUPPORTED_PLATFORMS.includes(platform) && platform !== 'uber') {
        return new Response(
          JSON.stringify({ error: `Unsupported platform: ${platform}` }),
          {
            status: 400,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          }
        );
      }

      const { error } = await supabase.from('platform_signals').insert({
        zone_id,
        platform,
        demand_level: clamp(demand_level, 0, 10),
        surge_active: surge_active ?? false,
        surge_multiplier: surge_multiplier ?? null,
        estimated_wait_min: estimated_wait_min ?? null,
        source: 'manual',
        captured_at: now.toISOString(),
      });

      if (error) throw error;

      return new Response(JSON.stringify({ ok: true }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // ── POST action: infer ─────────────────────────────────────────────────────
    if (body.action === 'infer') {
      const {
        zone_id,
        zone_score,
        weather_score = 0,
        event_active = false,
      } = body;

      if (!zone_id || zone_score == null) {
        return new Response(
          JSON.stringify({ error: 'zone_id and zone_score required' }),
          {
            status: 400,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          }
        );
      }

      const rows = [];
      for (const platform of SUPPORTED_PLATFORMS) {
        const signal = inferPlatformSignal(
          platform,
          zone_score,
          hour,
          weather_score,
          event_active
        );
        rows.push({
          zone_id,
          platform,
          ...signal,
          source: 'inferred',
          captured_at: now.toISOString(),
        });
      }

      const { error } = await supabase.from('platform_signals').insert(rows);
      if (error) throw error;

      return new Response(
        JSON.stringify({ ok: true, zone_id, signals: rows }),
        {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        }
      );
    }

    // ── POST action: infer_all ─────────────────────────────────────────────────
    if (body.action === 'infer_all') {
      const { city_id } = body;

      if (!city_id) {
        return new Response(JSON.stringify({ error: 'city_id required' }), {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      const { data: zones, error: zonesErr } = await supabase
        .from('zones')
        .select('id, current_score')
        .eq('city_id', city_id)
        .not('current_score', 'is', null);

      if (zonesErr) throw zonesErr;
      if (!zones || zones.length === 0) {
        return new Response(JSON.stringify({ ok: true, processed: 0 }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      const allRows = [];
      for (const zone of zones as ZoneRow[]) {
        if (!zone.current_score) continue;
        for (const platform of SUPPORTED_PLATFORMS) {
          const signal = inferPlatformSignal(
            platform,
            zone.current_score,
            hour
          );
          allRows.push({
            zone_id: zone.id,
            platform,
            ...signal,
            source: 'inferred',
            captured_at: now.toISOString(),
          });
        }
      }

      // Batch insert in chunks of 500 to avoid payload limits
      const CHUNK = 500;
      for (let i = 0; i < allRows.length; i += CHUNK) {
        const { error } = await supabase
          .from('platform_signals')
          .insert(allRows.slice(i, i + CHUNK));
        if (error) throw error;
      }

      return new Response(
        JSON.stringify({ ok: true, city_id, processed: allRows.length }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    return new Response(
      JSON.stringify({
        error: 'Unknown action. Use: store | infer | infer_all',
      }),
      {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[platform-signal-collector]', message);
    return new Response(JSON.stringify({ ok: false, error: message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
