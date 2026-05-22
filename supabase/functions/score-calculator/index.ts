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
  city_id: string | null;
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
  /** Visibility in metres — low visibility (fog, heavy snow) reduces driving alternatives */
  visibility: number;
  /** Snow depth in cm — accumulated snow on the ground */
  snowDepth: number;
  /** Gust speed in km/h — extreme winds correlate with storm advisories */
  windGust: number;
  /** Apparent / feels-like temperature in °C */
  feelsLike: number;
  /** Relative humidity 0-100 — drives the heat humidex perception */
  humidity: number;
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

// Aggressive Montreal-tuned weather → demand boost. Calibrated against
// the qualitative observation that bad weather drives ride volume up
// sharply (people stop walking + biking + waiting at bus stops).
function computeWeatherBoost(weather: Weather): number {
  let boost = 0;
  const code = weather.weatherCode;

  // Severe / dangerous — biggest signal
  if (code >= 95) boost += 25;                  // thunderstorm
  else if (code >= 85 && code <= 86) boost += 30; // wet snow showers (worst case)
  else if (code >= 71 && code <= 77) boost += 25; // snow
  else if (code >= 80 && code <= 82) boost += 15; // rain showers
  else if (code >= 61 && code <= 67) boost += 12; // sustained rain
  else if (code >= 51 && code <= 57) boost += 6;  // drizzle
  else if (code >= 45 && code <= 48) boost += 4;  // fog

  // Stacked precip intensity (orthogonal to the code-based bucket above)
  if (weather.precip > 10) boost += 8;
  else if (weather.precip > 5) boost += 5;
  else if (weather.precip > 1) boost += 2;

  // Snow accumulation on the ground — boosts demand even AFTER it stops
  // falling because sidewalks stay treacherous. 10cm+ is a storm day.
  if (weather.snowDepth >= 20) boost += 12;
  else if (weather.snowDepth >= 10) boost += 8;
  else if (weather.snowDepth >= 5) boost += 4;

  // Reduced visibility (heavy snow / dense fog) — people stop driving
  if (weather.visibility < 500) boost += 10;
  else if (weather.visibility < 2000) boost += 5;

  // Wind gusts >60 km/h indicate severe weather advisories
  if (weather.windGust > 80) boost += 8;
  else if (weather.windGust > 60) boost += 4;

  // Temperature extremes — use feels-like for accuracy (wind chill matters)
  const feels = weather.feelsLike;
  if (feels < -25) boost += 18;
  else if (feels < -15) boost += 12;
  else if (feels < -5) boost += 6;
  else if (feels > 34) boost += 8;  // dangerous humidex
  else if (feels > 30) boost += 4;

  // Cap total weather contribution
  return Math.min(boost, 50);
}

/**
 * Type-aware multiplier applied AFTER the base weather boost. Captures the
 * fact that not every zone reacts to weather identically:
 * - Airports spike when flights are delayed (snow / thunderstorm).
 * - Transit hubs spike in snow (people abandon biking / scooters for transit
 *   and then taxi the last mile).
 * - University zones LOSE traffic in extreme heat (students leave campus).
 * - Nightlife zones spike in rain (less walking between bars).
 */
function computeWeatherZoneMultiplier(weather: Weather, zoneType: string | null): number {
  if (!zoneType) return 1.0;
  const code = weather.weatherCode;
  const isSnow = code >= 71 && code <= 77 || code >= 85 && code <= 86;
  const isStorm = code >= 95 || weather.windGust > 60;
  const isRain = code >= 51 && code <= 67 || code >= 80 && code <= 82;

  // Airport: flight delays multiply demand
  if (zoneType === 'aéroport') {
    if (isSnow || isStorm) return 1.35;
    if (isRain) return 1.15;
  }

  // Transport / métro: snow abandons bikes/scooters → taxi to last mile
  if (zoneType === 'transport' || zoneType === 'métro') {
    if (isSnow) return 1.20;
    if (isRain) return 1.08;
  }

  // Nightlife: rain = less walking between venues
  if (zoneType === 'nightlife' && (isRain || isSnow)) return 1.15;

  // University: extreme heat empties campuses
  if (zoneType === 'université' && weather.feelsLike > 32) return 0.92;

  // Hospital / medical: snow boosts non-emergency rides
  if (zoneType === 'médical' && isSnow) return 1.10;

  return 1.0;
}

// ── External data fetchers ─────────────────────────────────────────────────────

function fallbackWeather(): Weather {
  return {
    temp: 5, precip: 0, weatherCode: 0, description: 'Inconnu',
    visibility: 20000, snowDepth: 0, windGust: 0, feelsLike: 5, humidity: 50,
  };
}

/**
 * Lookup of city_id → (lat, lon) used to fetch per-city weather. Coordinates
 * picked from the geographic centroid of each city so the weather feed
 * matches the bulk of zones served from that city.
 */
const CITY_CENTROIDS: Record<string, { lat: number; lon: number }> = {
  mtl: { lat: 45.5017, lon: -73.5673 },   // downtown Montréal
  lvl: { lat: 45.5559, lon: -73.7217 },   // central Laval
  lng: { lat: 45.5311, lon: -73.5181 },   // central Longueuil
  trb: { lat: 45.6995, lon: -73.6447 },   // Terrebonne
  sth: { lat: 45.6398, lon: -73.8499 },   // Sainte-Thérèse
  blv: { lat: 45.6726, lon: -73.8780 },   // Blainville
  bsb: { lat: 45.6173, lon: -73.8350 },   // Boisbriand
  rsm: { lat: 45.6321, lon: -73.7892 },   // Rosemère
  bdf: { lat: 45.6695, lon: -73.7506 },   // Bois-des-Filion
};

async function fetchWeatherForCities(zones: Zone[]): Promise<Map<string, Weather>> {
  const cityIds = new Set<string>();
  for (const z of zones) {
    if (z.city_id && CITY_CENTROIDS[z.city_id]) cityIds.add(z.city_id);
  }
  const entries = await Promise.all(
    Array.from(cityIds).map(async (cityId) => {
      const c = CITY_CENTROIDS[cityId];
      const w = await fetchWeather(c.lat, c.lon);
      return [cityId, w] as const;
    }),
  );
  return new Map(entries);
}

async function fetchWeather(lat: number, lon: number): Promise<Weather> {
  // Pull a richer signal set than the v1: visibility (fog detection),
  // snow depth (accumulation matters beyond hourly precip), wind gusts
  // (storm advisory proxy), apparent_temperature (humidex / wind chill),
  // and relative humidity (heat discomfort multiplier).
  const url =
    `https://api.open-meteo.com/v1/forecast` +
    `?latitude=${lat}&longitude=${lon}` +
    `&current=temperature_2m,apparent_temperature,relative_humidity_2m,` +
    `precipitation,weather_code,visibility,snow_depth,wind_gusts_10m` +
    `&timezone=America%2FToronto`;

  const res = await fetch(url);
  if (!res.ok) return fallbackWeather();
  const data = await res.json();
  const current = data?.current ?? {};
  return {
    temp: current.temperature_2m ?? 5,
    feelsLike: current.apparent_temperature ?? current.temperature_2m ?? 5,
    humidity: current.relative_humidity_2m ?? 50,
    precip: current.precipitation ?? 0,
    weatherCode: current.weather_code ?? 0,
    description: weatherCodeToDescription(current.weather_code ?? 0),
    visibility: current.visibility ?? 20000,
    snowDepth: (current.snow_depth ?? 0) * 100, // m → cm
    windGust: current.wind_gusts_10m ?? 0,
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

    // 1. Fetch zones (with city_id so we can attach city-specific weather)
    let zonesQuery = supabase
      .from('zones')
      .select(
        'id, name, type, territory, latitude, longitude, base_score, current_score, city_id'
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

    // 2. Fetch weather PER CITY in parallel. The territory spans Montréal +
    //    Laval + Rive-Sud + Couronne Nord — close enough that the weather is
    //    usually correlated, but a Laval snowstorm with clear MTL is a real
    //    pattern (lake effect / corridor). Per-city fetch costs one extra
    //    HTTP call each, all under the Open-Meteo free tier.
    const weatherByCity = await fetchWeatherForCities(zones as Zone[]);
    // Fallback to MTL centre weather when a zone has no city_id
    const fallbackCityWeather = weatherByCity.get('mtl')
      ?? (await fetchWeather(45.5017, -73.5673));

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

    // 4. Compute baseline scores for all zones. Each zone uses ITS city's
    //    weather, scaled by a zone-type-aware multiplier (airport spikes
    //    in storms, university dips in extreme heat, etc.).
    const { timeFactor, dayFactor } = getTimeDayFactors(now);

    const computedScores = new Map<string, number>();
    const scoreRows: ScoreRow[] = [];

    for (const zone of zones as Zone[]) {
      const zoneWeather =
        (zone.city_id && weatherByCity.get(zone.city_id)) || fallbackCityWeather;
      const baseWeatherBoost = computeWeatherBoost(zoneWeather);
      const typeMultiplier = computeWeatherZoneMultiplier(zoneWeather, zone.type);
      const weatherBoostVal = Math.round(baseWeatherBoost * typeMultiplier);

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
      fallbackCityWeather,
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
          temp: fallbackCityWeather.temp,
          precip: fallbackCityWeather.precip,
          description: fallbackCityWeather.description,
          perCity: Object.fromEntries(
            Array.from(weatherByCity.entries()).map(([cityId, w]) => [
              cityId,
              { temp: w.temp, code: w.weatherCode, snow: w.snowDepth },
            ]),
          ),
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
