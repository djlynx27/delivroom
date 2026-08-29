import type { TripWithZone } from '@/hooks/useTrips';
import { DEFAULT_WEIGHTS, type WeightConfig } from '@/lib/scoringEngine';
import { getTripHours, getTripRevenue } from '@/lib/tripAnalytics';

export interface EmaPattern {
  zoneId: string;
  zoneName: string;
  dayOfWeek: number;
  slotIndex: number;
  emaEarningsPerHour: number;
  emaRideCount: number;
  observationCount: number;
}

export interface ZoneBelief {
  zoneId: string;
  zoneName: string;
  dayOfWeek: number;
  slotIndex: number;
  posteriorMean: number;
  posteriorVariance: number;
  observationCount: number;
}

export interface PredictionRecord {
  tripId: string;
  zoneId: string;
  zoneName: string;
  predictedScore: number;
  actualScore: number;
  actualEarningsPerHour: number;
  error: number;
  startedAt: string;
}

export interface WeightAdjustmentSuggestion {
  key: keyof WeightConfig;
  currentWeight: number;
  suggestedWeight: number;
  delta: number;
  reason: string;
}

export interface LearningInsights {
  emaPatterns: EmaPattern[];
  beliefs: ZoneBelief[];
  predictions: PredictionRecord[];
  meanAbsoluteError: number;
  accuracyPercent: number;
  suggestedWeights: WeightConfig;
  suggestions: WeightAdjustmentSuggestion[];
  weightAdjustmentSuggestions: WeightAdjustmentSuggestion[];
  topLearnedZones: Array<{
    zoneId: string;
    zoneName: string;
    emaEarningsPerHour: number;
    observationCount: number;
  }>;
}

export interface PostShiftSummary {
  tripCount: number;
  revenue: number;
  revenuePerHour: number;
  accuracyPercent: number;
  meanAbsoluteError: number;
  bestZone: string | null;
  suggestedFocus: string;
}

const MAX_EXPECTED_EARNINGS_PER_HOUR = 60;
const DEFAULT_PRIOR_MEAN = 25;
const DEFAULT_PRIOR_VARIANCE = 100;
const OBSERVATION_VARIANCE = 36;
// Synthetic trips (seedSyntheticTrips.ts) seed a baseline before real data
// exists. A wider variance = less confidence, so the Bayesian posterior
// mean naturally swings toward real observations as soon as a few arrive
// -- no separate "weight" mechanism needed, see CLAUDE.md data-bootstrap plan.
const SYNTHETIC_OBSERVATION_VARIANCE = 150;

function getObservationVariance(source: TripWithZone['source']) {
  return source === 'synthetic'
    ? SYNTHETIC_OBSERVATION_VARIANCE
    : OBSERVATION_VARIANCE;
}

function round(value: number, digits = 2) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function getSlotIndex(date: Date) {
  return date.getHours() * 4 + Math.floor(date.getMinutes() / 15);
}

function normalizeScoreFromEarnings(earningsPerHour: number) {
  return clamp(
    Math.round((earningsPerHour / MAX_EXPECTED_EARNINGS_PER_HOUR) * 100),
    0,
    100
  );
}

function updateEma(current: number, observation: number, alpha = 0.3) {
  return alpha * observation + (1 - alpha) * current;
}

function updateBayesianBelief(
  priorMean: number,
  priorVariance: number,
  observation: number,
  observationVariance = OBSERVATION_VARIANCE
) {
  const posteriorVariance = 1 / (1 / priorVariance + 1 / observationVariance);
  const posteriorMean =
    posteriorVariance *
    (priorMean / priorVariance + observation / observationVariance);

  return {
    posteriorMean,
    posteriorVariance,
  };
}

function normalizeWeights(weights: WeightConfig): WeightConfig {
  const entries = Object.entries(weights) as Array<
    [keyof WeightConfig, number]
  >;
  const sum = entries.reduce((total, [, value]) => total + Math.abs(value), 0);
  if (sum <= 0) return DEFAULT_WEIGHTS;

  return entries.reduce((acc, [key, value]) => {
    acc[key] = Math.abs(value) / sum;
    return acc;
  }, {} as WeightConfig);
}

function getSortedTrips(trips: TripWithZone[]) {
  return [...trips]
    .filter((trip) => trip.started_at && getTripHours(trip) > 0)
    .sort(
      (left, right) =>
        new Date(left.started_at).getTime() -
        new Date(right.started_at).getTime()
    );
}

function getTripLearningContext(trip: TripWithZone) {
  const startedAt = new Date(trip.started_at);
  const hours = getTripHours(trip);
  const earningsPerHour = getTripRevenue(trip) / hours;
  const predictedScoreSource =
    (trip as { zone_score?: number | null }).zone_score ??
    trip.zones?.current_score;

  return {
    startedAt,
    hours,
    earningsPerHour,
    actualScore: normalizeScoreFromEarnings(earningsPerHour),
    predictedScoreSource,
    zoneId: trip.zone_id ?? 'unknown',
    zoneName: trip.zones?.name ?? 'Zone inconnue',
    dayOfWeek: startedAt.getDay(),
    slotIndex: getSlotIndex(startedAt),
    source: trip.source ?? 'real',
  };
}

function buildEmaPattern(
  previousEma: EmaPattern | undefined,
  context: ReturnType<typeof getTripLearningContext>
): EmaPattern {
  const nextEmaValue = updateEma(
    previousEma?.emaEarningsPerHour ?? context.earningsPerHour,
    context.earningsPerHour
  );

  return {
    zoneId: context.zoneId,
    zoneName: context.zoneName,
    dayOfWeek: context.dayOfWeek,
    slotIndex: context.slotIndex,
    emaEarningsPerHour: round(nextEmaValue),
    emaRideCount: round(updateEma(previousEma?.emaRideCount ?? 1, 1), 2),
    observationCount: (previousEma?.observationCount ?? 0) + 1,
  };
}

function buildZoneBelief(
  previousBelief: ZoneBelief | undefined,
  context: ReturnType<typeof getTripLearningContext>
): ZoneBelief {
  const nextBelief = updateBayesianBelief(
    previousBelief?.posteriorMean ?? DEFAULT_PRIOR_MEAN,
    previousBelief?.posteriorVariance ?? DEFAULT_PRIOR_VARIANCE,
    context.earningsPerHour,
    getObservationVariance(context.source)
  );

  return {
    zoneId: context.zoneId,
    zoneName: context.zoneName,
    dayOfWeek: context.dayOfWeek,
    slotIndex: context.slotIndex,
    posteriorMean: round(nextBelief.posteriorMean),
    posteriorVariance: round(nextBelief.posteriorVariance, 4),
    observationCount: (previousBelief?.observationCount ?? 0) + 1,
  };
}

function updateMapsWithTrip(
  emaMap: Map<string, EmaPattern>,
  beliefMap: Map<string, ZoneBelief>,
  context: ReturnType<typeof getTripLearningContext>
) {
  const key = `${context.zoneId}:${context.dayOfWeek}:${context.slotIndex}`;

  const previousEma = emaMap.get(key);
  emaMap.set(key, buildEmaPattern(previousEma, context));

  const previousBelief = beliefMap.get(key);
  beliefMap.set(key, buildZoneBelief(previousBelief, context));

  return key;
}

function buildPredictionRecord(
  trip: TripWithZone,
  context: ReturnType<typeof getTripLearningContext>
): PredictionRecord | null {
  // Synthetic trips have no real prediction to score against -- the
  // prediction-accuracy stats (MAE, recentBias) must stay real-data-only.
  if (context.source === 'synthetic') {
    return null;
  }

  if (
    context.predictedScoreSource === null ||
    context.predictedScoreSource === undefined
  ) {
    return null;
  }

  const predictedScore = clamp(
    Math.round(Number(context.predictedScoreSource)),
    0,
    100
  );

  return {
    tripId: trip.id,
    zoneId: context.zoneId,
    zoneName: context.zoneName,
    predictedScore,
    actualScore: context.actualScore,
    actualEarningsPerHour: round(context.earningsPerHour),
    error: round(context.actualScore - predictedScore),
    startedAt: trip.started_at,
  };
}

function getPredictionStats(predictions: PredictionRecord[]) {
  if (predictions.length === 0) {
    return {
      meanAbsoluteError: 0,
      accuracyPercent: 0,
      sampleCount: 0,
      recentBias: 0,
    };
  }

  const meanAbsoluteError = round(
    predictions.reduce(
      (sum, prediction) => sum + Math.abs(prediction.error),
      0
    ) / predictions.length
  );
  const accuratePredictions = predictions.filter(
    (prediction) => Math.abs(prediction.error) <= 15
  ).length;
  const accuracyPercent = round(
    (accuratePredictions / predictions.length) * 100
  );
  const recentBias = predictions
    .slice(-20)
    .reduce((sum, prediction) => sum + prediction.error, 0);

  return {
    meanAbsoluteError,
    accuracyPercent,
    sampleCount: predictions.length,
    recentBias,
  };
}

function applyBiasAdjustments(
  weights: WeightConfig,
  sampleCount: number,
  recentBias: number
) {
  const adjustedWeights: WeightConfig = { ...weights };

  if (sampleCount >= 8) {
    adjustedWeights.historicalEarnings += 0.04;
    adjustedWeights.timeOfDay -= 0.02;
    adjustedWeights.dayOfWeek -= 0.02;
  }

  if (recentBias > 12) {
    adjustedWeights.events += 0.02;
    adjustedWeights.weather += 0.01;
    adjustedWeights.timeOfDay -= 0.015;
    adjustedWeights.dayOfWeek -= 0.015;
  }

  if (recentBias < -12) {
    adjustedWeights.historicalEarnings += 0.02;
    adjustedWeights.events -= 0.01;
    adjustedWeights.weather -= 0.01;
  }

  return adjustedWeights;
}

function getSuggestionReason(
  key: keyof WeightConfig,
  sampleCount: number,
  recentBias: number
) {
  if (key === 'historicalEarnings' && sampleCount >= 8) {
    return 'L’historique réel devient fiable et mérite plus de poids.';
  }

  if ((key === 'events' || key === 'weather') && recentBias > 25) {
    return 'Les prédictions sous-estiment des contextes dynamiques récents.';
  }

  if ((key === 'timeOfDay' || key === 'dayOfWeek') && sampleCount >= 8) {
    return 'Le moteur peut moins dépendre des heuristiques fixes.';
  }

  return 'Ajustement neutre basé sur l’erreur moyenne récente.';
}

function buildSuggestions(
  weights: WeightConfig,
  suggestedWeights: WeightConfig,
  sampleCount: number,
  recentBias: number
) {
  return (Object.keys(suggestedWeights) as Array<keyof WeightConfig>)
    .map((key) => {
      const currentWeight = round(weights[key], 3);
      const nextWeight = round(suggestedWeights[key], 3);
      const delta = round(nextWeight - currentWeight, 3);

      return {
        key,
        currentWeight,
        suggestedWeight: nextWeight,
        delta,
        reason: getSuggestionReason(key, sampleCount, recentBias),
      };
    })
    .filter((suggestion) => Math.abs(suggestion.delta) >= 0.005)
    .sort((left, right) => Math.abs(right.delta) - Math.abs(left.delta));
}

function buildTopLearnedZones(emaMap: Map<string, EmaPattern>) {
  return [...emaMap.values()]
    .sort((left, right) => right.emaEarningsPerHour - left.emaEarningsPerHour)
    .slice(0, 5)
    .map((entry) => ({
      zoneId: entry.zoneId,
      zoneName: entry.zoneName,
      emaEarningsPerHour: entry.emaEarningsPerHour,
      observationCount: entry.observationCount,
    }));
}

function sortPredictionsByRecency(predictions: PredictionRecord[]) {
  return [...predictions].sort(
    (left, right) =>
      new Date(right.startedAt).getTime() - new Date(left.startedAt).getTime()
  );
}

export function deriveLearningInsights(
  trips: TripWithZone[],
  weights: WeightConfig = DEFAULT_WEIGHTS
): LearningInsights {
  const sortedTrips = getSortedTrips(trips);

  const emaMap = new Map<string, EmaPattern>();
  const beliefMap = new Map<string, ZoneBelief>();
  const predictions: PredictionRecord[] = [];

  for (const trip of sortedTrips) {
    const context = getTripLearningContext(trip);
    if (context.hours <= 0) {
      continue;
    }

    updateMapsWithTrip(emaMap, beliefMap, context);

    const prediction = buildPredictionRecord(trip, context);
    if (prediction) {
      predictions.push(prediction);
    }
  }

  const { meanAbsoluteError, accuracyPercent, sampleCount, recentBias } =
    getPredictionStats(predictions);

  // Use the bounded recent-window sum (last 20 trips) for all bias-driven
  // adjustments. The raw cumulative `bias` over ALL trips grows linearly with
  // trip count and makes the threshold (25 / -25) permanently exceeded after
  // ~50 trips with even a tiny systematic error, producing stale suggestions.
  const suggestedWeights = normalizeWeights(
    applyBiasAdjustments(weights, sampleCount, recentBias)
  );
  const suggestions = buildSuggestions(
    weights,
    suggestedWeights,
    sampleCount,
    recentBias
  );
  const topLearnedZones = buildTopLearnedZones(emaMap);

  return {
    emaPatterns: [...emaMap.values()],
    beliefs: [...beliefMap.values()],
    predictions: sortPredictionsByRecency(predictions),
    meanAbsoluteError,
    accuracyPercent,
    suggestedWeights,
    suggestions,
    weightAdjustmentSuggestions: suggestions,
    topLearnedZones,
  };
}

export function derivePostShiftSummary(
  trips: TripWithZone[],
  startedAtIso: string,
  endedAtIso: string,
  weights: WeightConfig = DEFAULT_WEIGHTS
): PostShiftSummary {
  const startedAt = new Date(startedAtIso);
  const endedAt = new Date(endedAtIso);
  const shiftTrips = trips.filter((trip) => {
    const tripDate = new Date(trip.started_at);
    return tripDate >= startedAt && tripDate <= endedAt;
  });

  const insights = deriveLearningInsights(shiftTrips, weights);
  const revenue = round(
    shiftTrips.reduce((sum, trip) => sum + getTripRevenue(trip), 0)
  );
  const hours = shiftTrips.reduce((sum, trip) => sum + getTripHours(trip), 0);
  const bestZone = insights.topLearnedZones[0]?.zoneName ?? null;
  const primarySuggestion = insights.suggestions[0];

  return {
    tripCount: shiftTrips.length,
    revenue,
    revenuePerHour: hours > 0 ? round(revenue / hours) : 0,
    accuracyPercent: insights.accuracyPercent,
    meanAbsoluteError: insights.meanAbsoluteError,
    bestZone,
    suggestedFocus: primarySuggestion
      ? `${primarySuggestion.key}: ${primarySuggestion.reason}`
      : 'Continuer à accumuler des courses pour raffiner les poids.',
  };
}
