// supabase/functions/ai-score-analysis/index.ts
// ──────────────────────────────────────────────────────────────────────────────
// Edge Function: AI-powered zone analysis and recommendations.
//
// Called by:
//   - AdminScreen: full analysis of all zones → returns { recommendations[] }
//   - TripLogger: after a trip → rescores the specific zone
//   - UniversalFileAnalyzer: after processing a shift screenshot
//
// Body (optional):
//   { zone_id: string }  → partial rescore for one zone
//   {}                   → full analysis of all zones
//
// Response:
//   { recommendations: AIRecommendation[], scored: number }
//
// AIRecommendation shape (matches AdminScreen interface):
//   { zone_id, zone_name, new_score, peak_hours, best_days, trend, tip }
// ──────────────────────────────────────────────────────────────────────────────

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { captureEdgeException } from '../_shared/sentry.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type',
};

interface Zone {
  id: string;
  name: string;
  type: string;
  territory: string | null;
  latitude: number;
  longitude: number;
  base_score: number | null;
  current_score: number | null;
}

interface Trip {
  zone_id: string | null;
  started_at: string;
  earnings: number | null;
  tips: number | null;
  distance_km: number | null;
  platform: string | null;
}

interface AIRecommendation {
  zone_id: string;
  zone_name: string;
  new_score: number;
  peak_hours: string;
  best_days: string;
  trend: 'up' | 'down' | 'stable';
  tip: string;
}

// eslint-disable-next-line complexity
function buildFallbackRecommendation(
  zone: Zone,
  stats:
    | { count: number; totalEarnings: number; hours: Set<number> }
    | undefined
): AIRecommendation {
  const currentScore = zone.current_score ?? zone.base_score ?? 50;
  const avgEarnings =
    stats && stats.count > 0 ? stats.totalEarnings / stats.count : 0;
  const earningsFactor = Math.min(1.2, 0.8 + (avgEarnings / 30) * 0.4);
  const newScore = Math.min(
    100,
    Math.max(0, Math.round(currentScore * earningsFactor))
  );

  return {
    zone_id: zone.id,
    zone_name: zone.name,
    new_score: newScore,
    peak_hours:
      zone.type === 'nightlife'
        ? '22h–3h'
        : zone.type === 'aéroport'
          ? '6h–9h, 16h–19h'
          : '17h–20h',
    best_days:
      zone.type === 'nightlife' || zone.type === 'événements'
        ? 'Vendredi-Samedi'
        : 'Lundi-Vendredi',
    trend:
      newScore > currentScore
        ? 'up'
        : newScore < currentScore
          ? 'down'
          : 'stable',
    tip:
      stats && stats.count > 0
        ? `${stats.count} courses en 30j — revenu moy. $${(stats.totalEarnings / stats.count).toFixed(0)}/course`
        : 'Aucune course enregistrée dans cette zone.',
  };
}

// eslint-disable-next-line complexity
serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    );

    let zoneId: string | null = null;
    try {
      const body = await req.json();
      zoneId = body?.zone_id ?? null;
    } catch {
      // no body
    }

    // 1. Fetch zones
    let zonesQuery = supabase
      .from('zones')
      .select(
        'id, name, type, territory, latitude, longitude, base_score, current_score'
      );
    if (zoneId) zonesQuery = zonesQuery.eq('id', zoneId);
    const { data: zones, error: zonesError } = await zonesQuery;
    if (zonesError) throw new Error(zonesError.message);
    if (!zones || zones.length === 0) {
      return new Response(JSON.stringify({ recommendations: [], scored: 0 }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // 2. Fetch recent trip history (last 30 days) for context
    const since = new Date(Date.now() - 30 * 86400000).toISOString();
    const zoneIdFilter = zoneId ? [zoneId] : (zones as Zone[]).map((z) => z.id);
    const { data: trips, error: tripsError } = await supabase
      .from('trips')
      .select('zone_id, started_at, earnings, tips, distance_km, platform')
      .in('zone_id', zoneIdFilter)
      .gte('started_at', since)
      .order('started_at', { ascending: false });

    if (tripsError) {
      throw new Error(`AI score trips lookup failed: ${tripsError.message}`);
    }

    // 3. Compute per-zone trip stats
    const statsMap = new Map<
      string,
      { count: number; totalEarnings: number; hours: Set<number> }
    >();
    for (const trip of (trips ?? []) as Trip[]) {
      if (!trip.zone_id) continue;
      const s = statsMap.get(trip.zone_id) ?? {
        count: 0,
        totalEarnings: 0,
        hours: new Set<number>(),
      };
      s.count++;
      s.totalEarnings +=
        (Number(trip.earnings) || 0) + (Number(trip.tips) || 0);
      s.hours.add(new Date(trip.started_at).getHours());
      statsMap.set(trip.zone_id, s);
    }

    // 4. If Gemini available → batch AI analysis; otherwise deterministic fallback
    const apiKey = Deno.env.get('GEMINI_API_KEY');
    const now = new Date();
    const hour = (now.getUTCHours() + 19) % 24; // ~America/Toronto

    let recommendations: AIRecommendation[];

    if (apiKey) {
      const zoneList = (zones as Zone[])
        .map((z) => {
          const stats = statsMap.get(z.id);
          return `zone_id=${z.id}, nom="${z.name}", type=${z.type}, territory=${z.territory ?? '?'}, score_actuel=${z.current_score ?? z.base_score ?? 50}, trips_30j=${stats?.count ?? 0}, revenus_30j=${stats?.totalEarnings.toFixed(0) ?? 0}CAD`;
        })
        .join('\n');

      const prompt = `Tu es un expert en optimisation de positionnement pour chauffeurs Lyft/taxi à Montréal. Il est ${hour}h.

Zones à analyser:
${zoneList}

Pour chaque zone, fournis:
1. Un nouveau score de demande (0–100)
2. Les heures de pointe typiques (ex: "17h–20h, 23h–2h")
3. Les meilleurs jours (ex: "Vendredi-Samedi", "Lundi-Vendredi")
4. La tendance vs score actuel ("up", "down" ou "stable")
5. Un conseil actionnable court en français (max 120 caractères)

Réponds UNIQUEMENT avec un JSON valide sans markdown:
{"zones": [{"zone_id": "...", "new_score": 75, "peak_hours": "17h–20h", "best_days": "Vendredi-Samedi", "trend": "up", "tip": "Conseil court"}]}`;

      const geminiRes = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [{ parts: [{ text: prompt }] }],
            generationConfig: {
              temperature: 0.3,
              maxOutputTokens: 4096,
              responseMimeType: 'application/json',
            },
          }),
        }
      );

      if (!geminiRes.ok) throw new Error(`Gemini error: ${geminiRes.status}`);
      const geminiData = await geminiRes.json();
      const text =
        geminiData?.candidates?.[0]?.content?.parts?.[0]?.text ?? '{}';
      const parsed: {
        zones: {
          zone_id: string;
          new_score: number;
          peak_hours: string;
          best_days: string;
          trend: 'up' | 'down' | 'stable';
          tip: string;
        }[];
      } = JSON.parse(text);

      const zoneMap = new Map((zones as Zone[]).map((z) => [z.id, z]));
      recommendations = (parsed.zones ?? []).map((r) => ({
        zone_id: r.zone_id,
        zone_name: zoneMap.get(r.zone_id)?.name ?? r.zone_id,
        new_score: Math.min(100, Math.max(0, r.new_score)),
        peak_hours: r.peak_hours,
        best_days: r.best_days,
        trend: r.trend,
        tip: r.tip,
      }));
    } else {
      // Deterministic fallback: use existing score + trip data
      recommendations = (zones as Zone[]).map((z) =>
        buildFallbackRecommendation(z, statsMap.get(z.id))
      );
    }

    // 5. Update zone scores in DB (partial or full)
    await Promise.all(
      recommendations.map(async ({ zone_id, new_score }) => {
        const { error: zoneUpdateError } = await supabase
          .from('zones')
          .update({
            current_score: new_score,
            updated_at: new Date().toISOString(),
          })
          .eq('id', zone_id);

        if (zoneUpdateError) {
          throw new Error(
            `AI score zone update failed for ${zone_id}: ${zoneUpdateError.message}`
          );
        }
      })
    );

    // Also insert into scores table for history
    const { error: scoreInsertError } = await supabase.from('scores').insert(
      recommendations.map(({ zone_id, new_score }) => ({
        zone_id,
        score: new_score,
        weather_boost: 0,
        event_boost: 0,
        final_score: new_score,
        calculated_at: new Date().toISOString(),
      }))
    );

    if (scoreInsertError) {
      throw new Error(
        `AI score history insert failed: ${scoreInsertError.message}`
      );
    }

    return new Response(
      JSON.stringify({ recommendations, scored: recommendations.length }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200,
      }
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('ai-score-analysis error:', message);
    captureEdgeException(err, 'ai-score-analysis', { url: req.url, method: req.method });
    return new Response(JSON.stringify({ error: message }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 500,
    });
  }
});
