// supabase/functions/score-calculator/index.ts
// ──────────────────────────────────────────────────────────────────────────────
// Edge Function: AI-enhanced zone demand scoring for Delivroom.
//
// Triggered by:
//   - GitHub Actions on deploy (supabase functions deploy score-calculator)
//   - pg_cron via the SQL recalculate_zone_scores() function (SQL baseline)
//   - Manual call from frontend: supabase.functions.invoke('score-calculator')
//   - App startup refresh
//
// Flow:
//   1. Fetch all active zones from DB
//   2. Fetch current weather from Open-Meteo (free, no key required)
//   3. Fetch active events from DB
//   4. Score each zone: base_score × time × day + event_boost + weather_boost
//   5. If GEMINI_API_KEY present → enhance with a single batched Gemini call
//   6. Upsert into public.scores table
//   7. Update zone.current_score for fast reads
//
// Secrets required (set via `supabase secrets set`):
//   GEMINI_API_KEY  — optional, enables AI scoring enhancement
// Auto-injected by Supabase runtime:
//   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
// ──────────────────────────────────────────────────────────────────────────────

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { captureEdgeException } from '../_shared/sentry.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type',
};

// ── Types ─────────────────────────────────────────────────────────────────────

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

interface Event {
  id: string;
  name: string;
  latitude: number;
  longitude: number;
  boost_multiplier: number;
  boost_radius_km: number;
  start_at: string;
  end_at: string;
}

interface Weather {
  temp: number;
  precip: number;
  weatherCode: number;
  description: string;
}

interface ScoreRow {
  zone_id: string;
  score: number;
  weather_boost: number;
  event_boost: number;
  final_score: number;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function haversineKm(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number
): number {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function weatherCodeToDescription(code: number): string {
  if (code === 0) return 'Ciel clair';
  if (code <= 3) return 'Partiellement nuageux';
  if (code <= 49) return 'Brouillard';
  if (code <= 67) return 'Pluie';
  if (code <= 77) return 'Neige';
  if (code <= 82) return 'Averses';
  return 'Orage';
}

function getTimeDayFactors(now: Date): {
  timeFactor: number;
  dayFactor: number;
} {
  // Convert to Montreal local time
  const montrealOffset = -5; // EST (adjust for DST if needed: -4 in summer)
  const localHour = (now.getUTCHours() + 24 + montrealOffset) % 24;
  const localDow = now.getUTCDay(); // close enough for day-of-week

  const timeFactor =
    localHour <= 2
      ? 1.2
      : localHour <= 5
        ? 0.6
        : localHour <= 8
          ? 1.1
          : localHour <= 10
            ? 0.9
            : localHour <= 13
              ? 1.0
              : localHour <= 16
                ? 0.85
                : localHour <= 19
                  ? 1.3
                  : 1.15;

  const dayFactors = [0.85, 0.9, 0.9, 0.95, 1.0, 1.3, 1.25];
  const dayFactor = dayFactors[localDow] ?? 1.0;

  return { timeFactor, dayFactor };
}

function computeEventBoost(zone: Zone, activeEvents: Event[]): number {
  let boost = 0;
  for (const event of activeEvents) {
    const distKm = haversineKm(
      zone.latitude,
      zone.longitude,
      event.latitude,
      event.longitude
    );
    if (distKm <= (event.boost_radius_km ?? 3)) {
      boost += Math.min((event.boost_multiplier - 1) * 15, 20);
    }
  }
  return Math.min(boost, 25);
}

function computeWeatherBoost(weather: Weather): number {
  if (weather.precip > 10) return 10;
  if (weather.precip > 5) return 8;
  if (weather.precip > 1) return 4;
  if (weather.temp < -15) return -3;
  return 0;
}

// ── External data fetchers ─────────────────────────────────────────────────────

async function fetchWeather(lat: number, lon: number): Promise<Weather> {
  const url =
    `https://api.open-meteo.com/v1/forecast` +
    `?latitude=${lat}&longitude=${lon}` +
    `&current=temperature_2m,precipitation,weather_code` +
    `&timezone=America%2FToronto`;

  const res = await fetch(url);
  if (!res.ok) {
    return { temp: 5, precip: 0, weatherCode: 0, description: 'Inconnu' };
  }
  const data = await res.json();
  const current = data?.current ?? {};
  return {
    temp: current.temperature_2m ?? 5,
    precip: current.precipitation ?? 0,
    weatherCode: current.weather_code ?? 0,
    description: weatherCodeToDescription(current.weather_code ?? 0),
  };
}

// ── Optional Gemini enhancement ───────────────────────────────────────────────
// Sends all zones in a single batched prompt to minimize API cost.
// Returns a map of zone_id → adjusted score (0–100) or null if unavailable.

// eslint-disable-next-line complexity
async function geminiEnhanceScores(
  zones: Zone[],
  weather: Weather,
  now: Date,
  computedScores: Map<string, number>
): Promise<Map<string, number> | null> {
  const apiKey = Deno.env.get('GEMINI_API_KEY');
  if (!apiKey) return null;

  const hour = (now.getUTCHours() + 19) % 24; // UTC-5 approx
  const dayNames = [
    'Dimanche',
    'Lundi',
    'Mardi',
    'Mercredi',
    'Jeudi',
    'Vendredi',
    'Samedi',
  ];
  const dayName = dayNames[now.getUTCDay()];

  const zoneList = zones
    .map(
      (z) =>
        `- id=${z.id}, nom="${z.name}", type=${z.type}, territory=${z.territory ?? '?'}, score_actuel=${computedScores.get(z.id) ?? 50}`
    )
    .join('\n');

  const prompt = `Tu es un expert en optimisation de positionnement pour chauffeurs Lyft/taxi à Montréal.

Heure: ${hour}h (${dayName})
Météo: ${weather.description}, ${weather.temp}°C, précipitations=${weather.precip}mm

Zones à scorer (40 zones):
${zoneList}

Pour CHAQUE zone, ajuste le score en tenant compte de:
- L'heure actuelle et le type de zone (nightlife → actif la nuit, métro → rush morning/evening, etc.)
- La météo (pluie/neige augmente la demande, froid extrême diminue légèrement)
- Le quartier et son territoire

Réponds UNIQUEMENT avec un JSON valide sans markdown, format exact:
{"scores": [{"id": "zone_id", "score": 75.5}, ...]}`;

  try {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: {
            temperature: 0.2,
            maxOutputTokens: 2048,
            responseMimeType: 'application/json',
          },
        }),
      }
    );

    if (!res.ok) {
      console.warn(`Gemini API error: ${res.status}`);
      return null;
    }

    const data = await res.json();
    const text = data?.candidates?.[0]?.content?.parts?.[0]?.text ?? '';
    const parsed: { scores: { id: string; score: number }[] } =
      JSON.parse(text);

    const result = new Map<string, number>();
    for (const entry of parsed.scores ?? []) {
      if (entry.id && typeof entry.score === 'number') {
        result.set(entry.id, Math.min(100, Math.max(0, entry.score)));
      }
    }
    return result;
  } catch (err) {
    console.warn('Gemini enhancement failed, using computed scores:', err);
    return null;
  }
}

// ── Main handler ──────────────────────────────────────────────────────────────

// eslint-disable-next-line complexity
serve(async (req) => {
  // CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    );

    // Parse optional request body
    let zoneIds: string[] | null = null;
    try {
      const body = await req.json();
      if (Array.isArray(body?.zone_ids) && body.zone_ids.length > 0) {
        zoneIds = body.zone_ids;
      }
    } catch {
      // No body or invalid JSON — score all zones
    }

    // 1. Fetch zones
    let zonesQuery = supabase
      .from('zones')
      .select(
        'id, name, type, territory, latitude, longitude, base_score, current_score'
      );
    if (zoneIds) {
      zonesQuery = zonesQuery.in('id', zoneIds);
    }
    const { data: zones, error: zonesError } = await zonesQuery;
    if (zonesError)
      throw new Error(`Zones fetch failed: ${zonesError.message}`);
    if (!zones || zones.length === 0) {
      return new Response(
        JSON.stringify({ success: true, scored: 0, message: 'No zones found' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // 2. Fetch weather for Montreal (centre)
    const weather = await fetchWeather(45.5017, -73.5673);

    // 3. Fetch active events from DB
    const now = new Date();
    const { data: activeEvents } = await supabase
      .from('events')
      .select(
        'id, name, latitude, longitude, boost_multiplier, boost_radius_km, start_at, end_at'
      )
      .lte('start_at', now.toISOString())
      .gte('end_at', now.toISOString());

    const events: Event[] = (activeEvents ?? []) as Event[];

    // 4. Compute baseline scores for all zones
    const { timeFactor, dayFactor } = getTimeDayFactors(now);
    const weatherBoostVal = computeWeatherBoost(weather);

    const computedScores = new Map<string, number>();
    const scoreRows: ScoreRow[] = [];

    for (const zone of zones as Zone[]) {
      const baseScore = zone.base_score ?? 50;
      const rawScore = baseScore * timeFactor * dayFactor;
      const clampedScore = Math.min(
        100,
        Math.max(0, Math.round(rawScore * 100) / 100)
      );
      const eventBoostVal = computeEventBoost(zone, events);
      const finalScore = Math.min(
        100,
        Math.max(0, Math.round(rawScore + eventBoostVal + weatherBoostVal))
      );
      computedScores.set(zone.id, finalScore);
      scoreRows.push({
        zone_id: zone.id,
        score: clampedScore,
        weather_boost: weatherBoostVal,
        event_boost: Math.round(eventBoostVal * 100) / 100,
        final_score: finalScore,
      });
    }

    // 5. Optional Gemini enhancement with Hallucination Firewall validation
    // WHY: Gemini sometimes hallucinates extreme scores. The firewall caps any
    // suggestion that deviates more than FIREWALL_MAX_DRIFT from the computed
    // baseline, preserving the AI's direction while bounding its magnitude.
    const FIREWALL_MAX_DRIFT = 35; // max score units of deviation allowed

    const geminiScores = await geminiEnhanceScores(
      zones as Zone[],
      weather,
      now,
      computedScores
    );

    let firewallAccepted = 0;
    let firewallClamped = 0;
    let firewallInvalid = 0;
    let totalDrift = 0;

    if (geminiScores) {
      for (const row of scoreRows) {
        const geminiVal = geminiScores.get(row.zone_id);
        if (geminiVal === undefined) continue;

        // Constraint 1: must be a finite number in [0, 100]
        if (!isFinite(geminiVal) || geminiVal < 0 || geminiVal > 100) {
          firewallInvalid++;
          continue; // keep baseline final_score
        }

        const drift = Math.abs(geminiVal - row.score);
        totalDrift += drift;

        // Constraint 2: drift must not exceed firewall threshold
        if (drift > FIREWALL_MAX_DRIFT) {
          // Cap: preserve direction but bound magnitude
          const cappedScore =
            geminiVal > row.score
              ? Math.min(geminiVal, row.score + FIREWALL_MAX_DRIFT)
              : Math.max(geminiVal, row.score - FIREWALL_MAX_DRIFT);
          row.final_score = Math.round(cappedScore * 100) / 100;
          firewallClamped++;
        } else {
          row.final_score = geminiVal;
          firewallAccepted++;
        }
      }
    }

    const firewallStats = geminiScores
      ? {
          accepted: firewallAccepted,
          clamped: firewallClamped,
          invalid: firewallInvalid,
          avgDrift:
            firewallAccepted + firewallClamped > 0
              ? Math.round(
                  (totalDrift / (firewallAccepted + firewallClamped)) * 10
                ) / 10
              : 0,
        }
      : null;

    // 6. Upsert scores into public.scores (insert new rows for history)
    const insertRows = scoreRows.map((r) => ({
      ...r,
      calculated_at: now.toISOString(),
    }));

    const { error: insertError } = await supabase
      .from('scores')
      .insert(insertRows);

    if (insertError) {
      throw new Error(`Score insert failed: ${insertError.message}`);
    }

    // 7. Update zone.current_score for fast reads
    await Promise.all(
      scoreRows.map(async ({ zone_id, final_score }) => {
        const { error: zoneUpdateError } = await supabase
          .from('zones')
          .update({
            current_score: Math.round(final_score),
            updated_at: now.toISOString(),
          })
          .eq('id', zone_id);

        if (zoneUpdateError) {
          throw new Error(
            `Zone score update failed for ${zone_id}: ${zoneUpdateError.message}`
          );
        }
      })
    );

    // 8. Purge history older than 24h
    await supabase
      .from('scores')
      .delete()
      .lt('calculated_at', new Date(now.getTime() - 86400000).toISOString());

    return new Response(
      JSON.stringify({
        success: true,
        scored: scoreRows.length,
        aiEnhanced: geminiScores !== null,
        firewall: firewallStats,
        weather: {
          temp: weather.temp,
          precip: weather.precip,
          description: weather.description,
        },
        activeEvents: events.length,
      }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200,
      }
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('score-calculator error:', message);
    captureEdgeException(err, 'score-calculator', { url: req.url, method: req.method });
    return new Response(JSON.stringify({ error: message }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 500,
    });
  }
});
