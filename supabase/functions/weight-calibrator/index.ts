import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { captureEdgeException } from '../_shared/sentry.ts';

/**
 * weight-calibrator — Edge Function Delivroom
 *
 * Analyse les `trip_predictions` récentes pour dériver des poids de scoring
 * optimisés via gradient descent simplifié sur l'erreur MAE.
 *
 * Routes :
 *
 *   POST /weight-calibrator
 *     { days?: number (default 14), min_trips?: number (default 10) }
 *     → Calcule les nouveaux poids, les stocke dans weight_history,
 *       met à jour zone_context_vectors (update_outcome) pour les trips concernés.
 *       Retourne les nouveaux poids + delta vs précédents.
 *
 *   GET /weight-calibrator
 *     → Retourne les poids actuels (dernier snapshot weight_history).
 *
 * Algorithme :
 *   1. Récupère trips avec predictions sur les N derniers jours
 *   2. Calcule MAE + accuracy% (predictions within 15 pts of actual)
 *   3. Décompose l'erreur par facteur (time, day, weather, events, history)
 *      via correlation analysis sur les colonnes disponibles
 *   4. Applique un gradient descent simplifié (lr=0.05) pour réduire MAE
 *   5. Normalise les poids pour qu'ils somment à 1.0
 *   6. Persist dans weight_history
 */

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type',
};

// ── Default weights (mirrors DEFAULT_WEIGHTS in scoringEngine.ts) ─────────────
const DEFAULT_WEIGHTS = {
  timeOfDay: 0.25,
  dayOfWeek: 0.15,
  weather: 0.15,
  events: 0.15,
  historicalEarnings: 0.1,
  transitDisruption: 0.08,
  trafficCongestion: 0.07,
  winterConditions: 0.05,
};

// Maximum allow shift per calibration to avoid wild oscillations
const MAX_WEIGHT_DELTA = 0.08;
const LEARNING_RATE = 0.05;

interface WeightConfig {
  timeOfDay: number;
  dayOfWeek: number;
  weather: number;
  events: number;
  historicalEarnings: number;
  transitDisruption: number;
  trafficCongestion: number;
  winterConditions: number;
}

interface TripPredictionRow {
  zone_score_at_start: number | null;
  actual_earnings_per_h: number | null;
  predicted_earnings_per_h: number | null;
  abs_error: number | null;
  error: number | null;
  hour_of_day: number | null;
  day_of_week: number | null;
  shift_date: string | null;
}

interface WeightHistoryRow {
  w_time: number;
  w_day: number;
  w_weather: number;
  w_events: number;
  w_historical: number;
}

function clamp(v: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, v));
}

function toPositiveInteger(value: unknown, fallback: number) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  const rounded = Math.floor(parsed);
  return rounded > 0 ? rounded : fallback;
}

function normalizeWeights(w: WeightConfig): WeightConfig {
  // Sum only the calibratable subset (5 main factors)
  // transit, traffic, winter kept stable — only tuned via manual override
  const calibratable: Array<keyof WeightConfig> = [
    'timeOfDay',
    'dayOfWeek',
    'weather',
    'events',
    'historicalEarnings',
  ];
  const stable: Array<keyof WeightConfig> = [
    'transitDisruption',
    'trafficCongestion',
    'winterConditions',
  ];

  const stableSum = stable.reduce((s, k) => s + w[k], 0);
  const targetForCalibrated = 1.0 - stableSum;
  const calibratedSum = calibratable.reduce((s, k) => s + w[k], 0);

  if (calibratedSum <= 0) return DEFAULT_WEIGHTS;

  const out = { ...w };
  for (const k of calibratable) {
    out[k] = (w[k] / calibratedSum) * targetForCalibrated;
  }
  return out;
}

/**
 * Derives gradient direction for each weight based on error patterns.
 * Uses a simple heuristic:
 *   - High error in night hours → increase timeOfDay weight
 *   - High error on weekends → increase dayOfWeek weight
 *   - High error when zone_score is high → increase historicalEarnings weight
 *   - Low error overall → no adjustment
 */
// eslint-disable-next-line complexity
function deriveGradients(
  predictions: TripPredictionRow[]
): Partial<Record<keyof WeightConfig, number>> {
  if (predictions.length === 0) return {};

  const overallMae =
    predictions.reduce((s, p) => s + (p.abs_error ?? 0), 0) /
    predictions.length;

  // Segment: night (22h–05h) vs. rest
  const nightPreds = predictions.filter(
    (p) => p.hour_of_day != null && (p.hour_of_day >= 22 || p.hour_of_day < 6)
  );
  const nightMae =
    nightPreds.length > 0
      ? nightPreds.reduce((s, p) => s + (p.abs_error ?? 0), 0) /
        nightPreds.length
      : overallMae;

  // Segment: weekend (0=Sun, 6=Sat) vs. weekday
  const weekendPreds = predictions.filter(
    (p) => p.day_of_week === 0 || p.day_of_week === 6
  );
  const weekendMae =
    weekendPreds.length > 0
      ? weekendPreds.reduce((s, p) => s + (p.abs_error ?? 0), 0) /
        weekendPreds.length
      : overallMae;

  // Segment: high zone score (>=70) vs. low
  const highScorePreds = predictions.filter(
    (p) => p.zone_score_at_start != null && p.zone_score_at_start >= 70
  );
  const highScoreMae =
    highScorePreds.length > 0
      ? highScorePreds.reduce((s, p) => s + (p.abs_error ?? 0), 0) /
        highScorePreds.length
      : overallMae;

  // Signed error patterns — positive means model underestimates (increase weight)
  const nightSignedError =
    nightPreds.length > 0
      ? nightPreds.reduce((s, p) => s + (p.error ?? 0), 0) / nightPreds.length
      : 0;
  const weekendSignedError =
    weekendPreds.length > 0
      ? weekendPreds.reduce((s, p) => s + (p.error ?? 0), 0) /
        weekendPreds.length
      : 0;
  const highScoreSignedError =
    highScorePreds.length > 0
      ? highScorePreds.reduce((s, p) => s + (p.error ?? 0), 0) /
        highScorePreds.length
      : 0;

  const MAX_ERROR_EXPECTED = 30; // $/h — beyond this, gradient is capped

  const gradients: Partial<Record<keyof WeightConfig, number>> = {};

  // timeOfDay: push up if night predictions are worse than average
  if (nightMae > overallMae * 1.15) {
    // High night error — model underweights time patterns
    gradients.timeOfDay =
      LEARNING_RATE * clamp(nightSignedError / MAX_ERROR_EXPECTED, -1, 1);
  }

  // dayOfWeek: push up if weekend predictions worse
  if (weekendMae > overallMae * 1.1) {
    gradients.dayOfWeek =
      LEARNING_RATE * clamp(weekendSignedError / MAX_ERROR_EXPECTED, -1, 1);
  }

  // historicalEarnings: push up if high-score zones have large unexpected errors
  if (highScoreMae > overallMae * 1.2) {
    gradients.historicalEarnings =
      LEARNING_RATE * clamp(highScoreSignedError / MAX_ERROR_EXPECTED, -1, 1);
  }

  return gradients;
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

    // ── GET: return current weights + history ─────────────────────────────────
    if (req.method === 'GET') {
      const { data, error } = await supabase.rpc('get_latest_weights');
      if (error) throw error;

      const rows =
        (data as
          | (WeightHistoryRow & {
              mae: number | null;
              accuracy_pct: number | null;
              trip_count: number | null;
              source: string | null;
              created_at: string | null;
            })[]
          | null) ?? [];

      const row = rows[0] ?? null;

      const flat = row
        ? {
            w_time: Number(row.w_time),
            w_day: Number(row.w_day),
            w_weather: Number(row.w_weather),
            w_events: Number(row.w_events),
            w_historical: Number(row.w_historical),
            mae: row.mae,
            accuracy_pct: row.accuracy_pct,
            trip_count: row.trip_count,
            source: row.source ?? 'db',
            created_at: row.created_at,
          }
        : {
            w_time: DEFAULT_WEIGHTS.timeOfDay,
            w_day: DEFAULT_WEIGHTS.dayOfWeek,
            w_weather: DEFAULT_WEIGHTS.weather,
            w_events: DEFAULT_WEIGHTS.events,
            w_historical: DEFAULT_WEIGHTS.historicalEarnings,
            mae: null,
            accuracy_pct: null,
            trip_count: null,
            source: 'default',
            created_at: null,
          };

      // Fetch calibration history (last 5)
      const { data: histData, error: historyError } = await supabase
        .from('weight_history')
        .select(
          'w_time, w_day, w_weather, w_events, w_historical, mae, accuracy_pct, trip_count, source, created_at'
        )
        .order('created_at', { ascending: false })
        .limit(5);

      if (historyError) throw historyError;

      return new Response(
        JSON.stringify({ ...flat, history: histData ?? [] }),
        {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        }
      );
    }

    // ── POST: calibrate weights ───────────────────────────────────────────────
    const body = (await req.json().catch(() => ({}))) as {
      days?: number;
      min_trips?: number;
    };
    const days = toPositiveInteger(body.days, 14);
    const minTrips = toPositiveInteger(body.min_trips, 10);

    const since = new Date(
      Date.now() - days * 24 * 60 * 60 * 1000
    ).toISOString();

    // 1. Fetch recent trip predictions
    const { data: predictions, error: predErr } = await supabase
      .from('trip_predictions')
      .select(
        'zone_score_at_start, actual_earnings_per_h, predicted_earnings_per_h, abs_error, error, hour_of_day, day_of_week, shift_date'
      )
      .gte('created_at', since)
      .not('actual_earnings_per_h', 'is', null)
      .not('predicted_earnings_per_h', 'is', null);

    if (predErr) throw predErr;

    if (!predictions || predictions.length < minTrips) {
      return new Response(
        JSON.stringify({
          ok: false,
          reason: `Not enough data: ${predictions?.length ?? 0} predictions (min ${minTrips}). Drive more and run again!`,
          current_weights: DEFAULT_WEIGHTS,
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // 2. Fetch current weights
    const { data: currentWeightRows, error: currentWeightsError } =
      await supabase.rpc('get_latest_weights');

    if (currentWeightsError) throw currentWeightsError;

    const currentRow = (currentWeightRows as WeightHistoryRow[] | null)?.[0];

    const currentWeights: WeightConfig = currentRow
      ? {
          timeOfDay: Number(currentRow.w_time),
          dayOfWeek: Number(currentRow.w_day),
          weather: Number(currentRow.w_weather),
          events: Number(currentRow.w_events),
          historicalEarnings: Number(currentRow.w_historical),
          transitDisruption: DEFAULT_WEIGHTS.transitDisruption,
          trafficCongestion: DEFAULT_WEIGHTS.trafficCongestion,
          winterConditions: DEFAULT_WEIGHTS.winterConditions,
        }
      : { ...DEFAULT_WEIGHTS };

    // 3. Compute MAE + accuracy
    const rows = predictions as TripPredictionRow[];
    if (rows.length === 0) {
      return new Response(
        JSON.stringify({
          ok: false,
          reason: 'Not enough data: 0 predictions after filtering.',
          current_weights: currentWeights,
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const mae = rows.reduce((s, p) => s + (p.abs_error ?? 0), 0) / rows.length;

    const accurate = rows.filter((p) => (p.abs_error ?? 999) <= 15).length;
    const accuracyPct = (accurate / rows.length) * 100;

    // 4. Derive gradients + apply
    const gradients = deriveGradients(rows);
    const newWeights: WeightConfig = { ...currentWeights };

    for (const [key, delta] of Object.entries(gradients) as Array<
      [keyof WeightConfig, number]
    >) {
      const shift = clamp(delta, -MAX_WEIGHT_DELTA, MAX_WEIGHT_DELTA);
      newWeights[key] = clamp(currentWeights[key] + shift, 0.03, 0.45);
    }

    // 5. Normalize calibratable subset
    const normalized = normalizeWeights(newWeights);

    // 6. Persist
    const { error: insertErr } = await supabase.from('weight_history').insert({
      w_time: normalized.timeOfDay,
      w_day: normalized.dayOfWeek,
      w_weather: normalized.weather,
      w_events: normalized.events,
      w_historical: normalized.historicalEarnings,
      trip_count: rows.length,
      mae: Math.round(mae * 1000) / 1000,
      accuracy_pct: Math.round(accuracyPct * 100) / 100,
      source: 'auto',
      note: `Auto-calibrated from ${rows.length} trips over ${days} days`,
    });

    if (insertErr) throw insertErr;

    // 7. Compute deltas vs previous
    const deltas: Record<string, number> = {};
    for (const key of Object.keys(normalized) as Array<keyof WeightConfig>) {
      deltas[key] =
        Math.round((normalized[key] - currentWeights[key]) * 10000) / 10000;
    }

    return new Response(
      JSON.stringify({
        ok: true,
        trip_count: rows.length,
        trips_analyzed: rows.length,
        mae: Math.round(mae * 100) / 100,
        accuracy_pct: Math.round(accuracyPct * 10) / 10,
        previous_weights: currentWeights,
        new_weights: {
          w_time: normalized.timeOfDay,
          w_day: normalized.dayOfWeek,
          w_weather: normalized.weather,
          w_events: normalized.events,
          w_historical: normalized.historicalEarnings,
          mae: Math.round(mae * 100) / 100,
          accuracy_pct: Math.round(accuracyPct * 10) / 10,
        },
        deltas: {
          w_time: deltas['timeOfDay'] ?? 0,
          w_day: deltas['dayOfWeek'] ?? 0,
          w_weather: deltas['weather'] ?? 0,
          w_events: deltas['events'] ?? 0,
          w_historical: deltas['historicalEarnings'] ?? 0,
        },
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[weight-calibrator]', message);
    captureEdgeException(err, 'weight-calibrator', { url: req.url, method: req.method });
    return new Response(JSON.stringify({ ok: false, error: message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
