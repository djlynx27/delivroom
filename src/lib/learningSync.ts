import type { TripWithZone } from '@/hooks/useTrips';
import { supabase } from '@/integrations/supabase/client';
import type { Database, TablesInsert } from '@/integrations/supabase/types';
import {
  deriveLearningInsights,
  derivePostShiftSummary,
} from '@/lib/learningEngine';
import { DEFAULT_WEIGHTS, type WeightConfig } from '@/lib/scoringEngine';
import { getTripHours, getTripRevenue } from '@/lib/tripAnalytics';

export interface LearningSyncResult {
  ok: boolean;
  sessionId?: number;
  syncedCounts: {
    emaPatterns: number;
    beliefs: number;
    predictions: number;
    demandPatterns: number;
    sessionZones: number;
  };
  message: string;
}

type EmaPatternInsert = TablesInsert<'ema_patterns'>;
type ZoneBeliefInsert = TablesInsert<'zone_beliefs'>;
type WeightHistoryInsert = TablesInsert<'weight_history'>;
type SessionInsert = TablesInsert<'sessions'>;
type SessionZoneInsert = TablesInsert<'session_zones'>;
type PredictionInsert = TablesInsert<'predictions'>;
type DemandPatternInsert = TablesInsert<'demand_patterns'>;
type UserPingInsert = TablesInsert<'user_pings'>;
type SimilarContextRpcArgs =
  Database['public']['Functions']['match_similar_contexts']['Args'];
type UserPingRpcArgs =
  Database['public']['Functions']['match_user_pings']['Args'];

type SimilarContextRpcRow = {
  id: number | string;
  zone_id: string;
  actual_earnings_per_hour: number | string | null;
  similarity: number | string | null;
  created_at: string;
};

type UserPingRpcRow = {
  id: string;
  zone_id: string;
  success_score: number | string | null;
  similarity: number | string | null;
  created_at: string;
};

export interface SimilarContextMatch {
  id: number;
  zoneId: string;
  actualEarningsPerHour: number;
  similarity: number;
  createdAt: string;
}

export interface SimilarContextsResult {
  ok: boolean;
  matches: SimilarContextMatch[];
  averageEarningsPerHour: number;
  averageSimilarity: number;
  message: string;
}

export interface UserPingContextInput extends ZoneContextInput {
  distanceKm?: number | null;
  lyftDemandLevel?: number | null;
  estimatedWaitMin?: number | null;
  conservativePresence?: boolean;
}

export interface UserPingMatch {
  id: string;
  zoneId: string;
  successScore: number;
  similarity: number;
  createdAt: string;
}

export interface UserPingMatchesResult {
  ok: boolean;
  matches: UserPingMatch[];
  averageSuccessScore: number;
  averageSimilarity: number;
  message: string;
}

export interface ZoneContextInput {
  zoneId: string;
  zoneType?: string | null;
  currentScore?: number | null;
  now: Date;
  trafficCongestion?: number;
  weatherDemandBoostPoints?: number;
}

function round(value: number, digits = 2) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function normalizeScoreFromEarnings(earningsPerHour: number) {
  return clamp(Math.round((earningsPerHour / 60) * 100), 0, 100);
}

function clamp01(value: number) {
  return clamp(value, 0, 1);
}

function serializeContextVector(vector: number[]) {
  return `[${vector.map((value) => round(value, 6).toString()).join(',')}]`;
}

function isWeekendDay(dayOfWeek: number) {
  return dayOfWeek === 0 || dayOfWeek === 6;
}

function isWinterMonth(month: number) {
  return month <= 3 || month === 12;
}

function safeVectorValue(vector: number[], index: number) {
  return vector[index] ?? 0;
}

function normalizeRatio(value: number | null | undefined, max: number) {
  return clamp01((value ?? 0) / max);
}

function getTripPredictedScore(trip: TripWithZone) {
  return clamp(
    Math.round(
      Number(
        (trip as { zone_score?: number | null }).zone_score ??
          trip.zones?.current_score ??
          50
      )
    ),
    0,
    100
  );
}

function isNightlifeLikeZone(zoneType?: string | null) {
  return zoneType === 'nightlife' || zoneType === 'événements' ? 1 : 0;
}

function createEmptySyncCounts(): LearningSyncResult['syncedCounts'] {
  return {
    emaPatterns: 0,
    beliefs: 0,
    predictions: 0,
    demandPatterns: 0,
    sessionZones: 0,
  };
}

const USER_PING_CACHE_KEY = 'delivroom_user_ping_cache';
const USER_PING_COOLDOWN_MS = 15 * 60 * 1000;

export function buildUserPingCacheKey(
  driverFingerprint: string,
  zoneId: string,
  source = 'unknown'
) {
  return `${driverFingerprint}:${zoneId}:${source}`;
}

export function shouldThrottleUserPing(
  lastRecordedAt: number | null,
  nowMs: number,
  cooldownMs = USER_PING_COOLDOWN_MS
) {
  return lastRecordedAt != null && nowMs - lastRecordedAt < cooldownMs;
}

function readUserPingCache() {
  if (typeof localStorage === 'undefined') return {} as Record<string, number>;

  try {
    const raw = localStorage.getItem(USER_PING_CACHE_KEY);
    if (!raw) return {} as Record<string, number>;

    const parsed = JSON.parse(raw) as Record<string, number>;
    return parsed ?? {};
  } catch {
    return {} as Record<string, number>;
  }
}

function writeUserPingCache(cache: Record<string, number>) {
  if (typeof localStorage === 'undefined') return;

  try {
    localStorage.setItem(USER_PING_CACHE_KEY, JSON.stringify(cache));
  } catch {
    // localStorage unavailable; cooldown cache is not persisted.
  }
}

function rememberUserPing(cacheKey: string, nowMs: number) {
  const cache = readUserPingCache();
  const prunedEntries = Object.entries(cache)
    .filter(([, value]) => nowMs - value < USER_PING_COOLDOWN_MS)
    .slice(-100);

  const nextCache = Object.fromEntries(prunedEntries);
  nextCache[cacheKey] = nowMs;
  writeUserPingCache(nextCache);
}

function getErrorMessage(error: unknown, fallback: string) {
  if (error instanceof Error && error.message) return error.message;
  return fallback;
}

function getLearningSyncFailureMessage(error: unknown, fallback: string) {
  if (
    typeof navigator !== 'undefined' &&
    'onLine' in navigator &&
    !navigator.onLine
  ) {
    return 'App hors ligne. Donnees locales sauvegardees, sync cloud en attente.';
  }

  const message = getErrorMessage(error, fallback);
  const normalizedMessage = message.toLowerCase();

  if (
    normalizedMessage.includes('jwt') ||
    normalizedMessage.includes('row-level security') ||
    normalizedMessage.includes('permission denied') ||
    normalizedMessage.includes('not authenticated') ||
    normalizedMessage.includes('401') ||
    normalizedMessage.includes('403')
  ) {
    return 'Connexion cloud absente ou expiree. Donnees locales sauvegardees.';
  }

  if (
    normalizedMessage.includes('failed to fetch') ||
    normalizedMessage.includes('network request failed')
  ) {
    return 'Reseau cloud temporairement indisponible. Donnees locales sauvegardees.';
  }

  return message;
}

export function buildSimilarContextRpcArgs(
  trip: TripWithZone,
  matchCount = 5
): SimilarContextRpcArgs | null {
  if (!trip.zone_id) return null;

  return {
    query_vector: serializeContextVector(encodeContextVector(trip)),
    query_zone_id: trip.zone_id,
    match_count: Math.max(1, Math.round(matchCount)),
  };
}

export function encodeZoneContextVector(input: ZoneContextInput): number[] {
  const hour = input.now.getHours();
  const dayOfWeek = input.now.getDay();
  const month = input.now.getMonth() + 1;
  const isWeekend = isWeekendDay(dayOfWeek) ? 1 : 0;
  const isWinter = isWinterMonth(month) ? 1 : 0;
  const normalizedTraffic = clamp01(input.trafficCongestion ?? 0);
  const normalizedWeather = clamp01((input.weatherDemandBoostPoints ?? 0) / 30);
  const normalizedScore = clamp01(Number(input.currentScore ?? 50) / 100);
  const nightlifeLike = isNightlifeLikeZone(input.zoneType);

  return [
    round(Math.sin((2 * Math.PI * hour) / 24), 6),
    round(Math.cos((2 * Math.PI * hour) / 24), 6),
    round(Math.sin((2 * Math.PI * dayOfWeek) / 7), 6),
    round(Math.cos((2 * Math.PI * dayOfWeek) / 7), 6),
    round(normalizedScore, 6),
    round(normalizedWeather, 6),
    round(normalizedTraffic, 6),
    0,
    0,
    0,
    0,
    isWeekend,
    month / 12,
    isWinter,
    nightlifeLike,
    round(normalizedScore, 6),
  ];
}

export function buildZoneSimilarContextRpcArgs(
  input: ZoneContextInput,
  matchCount = 5
): SimilarContextRpcArgs | null {
  if (!input.zoneId) return null;
  return {
    query_zone_id: input.zoneId,
    query_vector: serializeContextVector(encodeZoneContextVector(input)),
    match_count: Math.max(1, Math.round(matchCount)),
  };
}

export function encodeUserPingContextVector(
  input: UserPingContextInput
): number[] {
  const base = encodeZoneContextVector(input);
  const normalizedDistance = normalizeRatio(input.distanceKm, 20);
  const normalizedLyftDemand = normalizeRatio(input.lyftDemandLevel, 10);
  const normalizedWait = normalizeRatio(input.estimatedWaitMin, 20);

  return [
    safeVectorValue(base, 0),
    safeVectorValue(base, 1),
    safeVectorValue(base, 2),
    safeVectorValue(base, 3),
    safeVectorValue(base, 4),
    safeVectorValue(base, 5),
    safeVectorValue(base, 6),
    round(normalizedDistance, 6),
    round(normalizedLyftDemand, 6),
    round(normalizedWait, 6),
    1,
    input.conservativePresence ? 1 : 0,
    safeVectorValue(base, 11),
    safeVectorValue(base, 12),
    safeVectorValue(base, 13),
    safeVectorValue(base, 14),
  ];
}

export function buildUserPingMatchRpcArgs(
  driverFingerprint: string,
  input: UserPingContextInput,
  matchCount = 5
): UserPingRpcArgs | null {
  if (!driverFingerprint || !input.zoneId) return null;

  return {
    query_driver_fingerprint: driverFingerprint,
    query_platform: 'lyft',
    query_vector: serializeContextVector(encodeUserPingContextVector(input)),
    query_zone_id: input.zoneId,
    match_count: Math.max(1, Math.round(matchCount)),
  };
}

export function encodeContextVector(trip: TripWithZone): number[] {
  const startedAt = new Date(trip.started_at);
  const hour = startedAt.getHours();
  const dayOfWeek = startedAt.getDay();
  const month = startedAt.getMonth() + 1;
  const revenue = getTripRevenue(trip);
  const hours = getTripHours(trip);
  const earningsPerHour = hours > 0 ? revenue / hours : 0;
  const isWeekend = isWeekendDay(dayOfWeek) ? 1 : 0;
  const isWinter = isWinterMonth(month) ? 1 : 0;
  const predictedNightlifeLike = isNightlifeLikeZone(trip.zones?.type);

  return [
    round(Math.sin((2 * Math.PI * hour) / 24), 6),
    round(Math.cos((2 * Math.PI * hour) / 24), 6),
    round(Math.sin((2 * Math.PI * dayOfWeek) / 7), 6),
    round(Math.cos((2 * Math.PI * dayOfWeek) / 7), 6),
    round(clamp(earningsPerHour / 60, 0, 1), 6),
    round(clamp(revenue / 100, 0, 1), 6),
    round(clamp(Number(trip.distance_km ?? 0) / 40, 0, 1), 6),
    round(clamp(Number(trip.tips ?? 0) / 30, 0, 1), 6),
    trip.platform === 'uber' ? 1 : 0,
    trip.platform === 'lyft' ? 1 : 0,
    trip.platform === 'taxi' ? 1 : 0,
    isWeekend,
    month / 12,
    isWinter,
    predictedNightlifeLike,
    normalizeScoreFromEarnings(earningsPerHour) / 100,
  ];
}

type ShiftZoneAccumulator = {
  zoneId: string;
  zoneName: string;
  enteredAt: string;
  exitedAt: string;
  ridesCount: number;
  earnings: number;
  predictedScore: number;
  factorsSnapshot: Record<string, unknown>;
};

function isTripInShiftWindow(
  trip: TripWithZone,
  startedAt: Date,
  endedAt: Date
) {
  const started = new Date(trip.started_at);
  return started >= startedAt && started <= endedAt;
}

function createZoneAccumulator(
  trip: TripWithZone & { zone_id: string }
): ShiftZoneAccumulator {
  return {
    zoneId: trip.zone_id,
    zoneName: trip.zones?.name ?? 'Zone inconnue',
    enteredAt: trip.started_at,
    exitedAt: trip.ended_at ?? trip.started_at,
    ridesCount: 0,
    earnings: 0,
    predictedScore: 0,
    factorsSnapshot: {
      source: 'trip_sync',
      zone_type: trip.zones?.type ?? null,
    },
  };
}

function accumulateShiftZone(
  current: ShiftZoneAccumulator,
  trip: TripWithZone & { zone_id: string }
) {
  current.enteredAt =
    new Date(trip.started_at) < new Date(current.enteredAt)
      ? trip.started_at
      : current.enteredAt;
  current.exitedAt =
    new Date(trip.ended_at ?? trip.started_at) > new Date(current.exitedAt)
      ? (trip.ended_at ?? trip.started_at)
      : current.exitedAt;
  current.ridesCount += 1;
  current.earnings += getTripRevenue(trip);
  current.predictedScore += getTripPredictedScore(trip);

  return current;
}

function groupTripsByZone(shiftTrips: TripWithZone[]) {
  const groupedByZone = new Map<string, ShiftZoneAccumulator>();

  for (const trip of shiftTrips) {
    if (!trip.zone_id) continue;

    const zonedTrip = trip as TripWithZone & { zone_id: string };
    const current =
      groupedByZone.get(zonedTrip.zone_id) ?? createZoneAccumulator(zonedTrip);

    groupedByZone.set(
      zonedTrip.zone_id,
      accumulateShiftZone(current, zonedTrip)
    );
  }

  return groupedByZone;
}

function withZoneId(
  trip: TripWithZone
): trip is TripWithZone & { zone_id: string } {
  return Boolean(trip.zone_id);
}

function buildShiftPredictions(
  trips: Array<TripWithZone & { zone_id: string }>
) {
  return trips.flatMap<PredictionInsert>((trip) => {
    const hours = getTripHours(trip);
    if (hours <= 0) return [];

    const earningsPerHour = getTripRevenue(trip) / hours;
    const predictedScore = getTripPredictedScore(trip);
    const actualScore = normalizeScoreFromEarnings(earningsPerHour);

    return [
      {
        zone_id: trip.zone_id,
        predicted_at: trip.started_at,
        predicted_score: predictedScore,
        factors_snapshot: {
          source_trip_id: trip.id,
          platform: trip.platform ?? null,
        },
        actual_earnings_per_hour: round(earningsPerHour),
        prediction_error: round(actualScore - predictedScore, 4),
      },
    ];
  });
}

function buildShiftDemandPatterns(
  trips: Array<TripWithZone & { zone_id: string }>
) {
  return trips.flatMap<DemandPatternInsert>((trip) => {
    const hours = getTripHours(trip);
    if (hours <= 0) return [];

    return [
      {
        zone_id: trip.zone_id,
        context_vector: serializeContextVector(encodeContextVector(trip)),
        actual_earnings_per_hour: round(getTripRevenue(trip) / hours),
      },
    ];
  });
}

function buildSessionZoneRows(
  groupedByZone: Map<string, ShiftZoneAccumulator>
) {
  return [...groupedByZone.values()].map<Omit<SessionZoneInsert, 'session_id'>>(
    (zone) => ({
      zone_id: zone.zoneId,
      entered_at: zone.enteredAt,
      exited_at: zone.exitedAt,
      rides_count: zone.ridesCount,
      earnings: round(zone.earnings),
      predicted_score: round(
        zone.predictedScore / Math.max(zone.ridesCount, 1)
      ),
      factors_snapshot: zone.factorsSnapshot,
    })
  );
}

function buildSessionInsertPayload(
  summary: ReturnType<typeof derivePostShiftSummary>,
  startedAtIso: string,
  endedAtIso: string,
  startedAt: Date,
  endedAt: Date
): SessionInsert {
  return {
    started_at: startedAtIso,
    ended_at: endedAtIso,
    total_earnings: summary.revenue,
    total_rides: summary.tripCount,
    total_hours: round(
      Math.max((endedAt.getTime() - startedAt.getTime()) / 3_600_000, 0)
    ),
    notes: summary.suggestedFocus,
    weather_snapshot: {
      accuracy_percent: summary.accuracyPercent,
      mean_absolute_error: summary.meanAbsoluteError,
    },
  };
}

export function buildLearningPersistencePayload(
  trips: TripWithZone[],
  weights: WeightConfig = DEFAULT_WEIGHTS
) {
  const insights = deriveLearningInsights(trips, weights);
  const lastUpdated = new Date().toISOString();

  return {
    emaPatterns: insights.emaPatterns.map<EmaPatternInsert>((pattern) => ({
      zone_id: pattern.zoneId,
      day_of_week: pattern.dayOfWeek,
      hour_block: pattern.slotIndex,
      ema_earnings_per_hour: pattern.emaEarningsPerHour,
      ema_ride_count: pattern.emaRideCount,
      observation_count: pattern.observationCount,
      last_updated: lastUpdated,
    })),
    beliefs: insights.beliefs.map<ZoneBeliefInsert>((belief) => ({
      zone_id: belief.zoneId,
      day_of_week: belief.dayOfWeek,
      hour_block: belief.slotIndex,
      prior_mean: belief.posteriorMean,
      prior_variance: belief.posteriorVariance,
      observation_count: belief.observationCount,
      last_updated: lastUpdated,
    })),
    weightHistory: {
      weights: insights.suggestedWeights,
      prediction_mae: insights.meanAbsoluteError,
      triggered_by: 'manual_sync',
    } satisfies WeightHistoryInsert,
  };
}

export function buildShiftPersistencePayload(
  trips: TripWithZone[],
  startedAtIso: string,
  endedAtIso: string,
  weights: WeightConfig = DEFAULT_WEIGHTS
) {
  const startedAt = new Date(startedAtIso);
  const endedAt = new Date(endedAtIso);
  const shiftTrips = trips.filter((trip) =>
    isTripInShiftWindow(trip, startedAt, endedAt)
  );

  const summary = derivePostShiftSummary(
    shiftTrips,
    startedAtIso,
    endedAtIso,
    weights
  );

  const groupedByZone = groupTripsByZone(shiftTrips);
  const tripsWithZone = shiftTrips.filter(withZoneId);
  const predictions = buildShiftPredictions(tripsWithZone);
  const demandPatterns = buildShiftDemandPatterns(tripsWithZone);

  return {
    session: buildSessionInsertPayload(
      summary,
      startedAtIso,
      endedAtIso,
      startedAt,
      endedAt
    ),
    sessionZones: buildSessionZoneRows(groupedByZone),
    predictions,
    demandPatterns,
  };
}

function mapSimilarContextRow(row: SimilarContextRpcRow): SimilarContextMatch {
  return {
    id: Number(row.id),
    zoneId: row.zone_id,
    actualEarningsPerHour: round(Number(row.actual_earnings_per_hour ?? 0)),
    similarity: round(Number(row.similarity ?? 0), 4),
    createdAt: row.created_at,
  };
}

function getAverageFromMatches<T>(
  matches: T[],
  selector: (match: T) => number,
  digits = 2
) {
  if (matches.length === 0) return 0;
  return round(
    matches.reduce((sum, match) => sum + selector(match), 0) / matches.length,
    digits
  );
}

function hasMissingSimilarContextMigration(message: string) {
  const rawMessage = message.toLowerCase();
  return (
    rawMessage.includes('match_similar_contexts') ||
    rawMessage.includes('function') ||
    rawMessage.includes('schema cache') ||
    rawMessage.includes('demand_patterns')
  );
}

function buildInvalidSimilarContextResult(
  message: string
): SimilarContextsResult {
  return {
    ok: false,
    matches: [],
    averageEarningsPerHour: 0,
    averageSimilarity: 0,
    message,
  };
}

function buildSimilarContextSuccessResult(
  rows: SimilarContextRpcRow[] | null | undefined
): SimilarContextsResult {
  const matches = (rows ?? []).map(mapSimilarContextRow);
  return {
    ok: true,
    matches,
    averageEarningsPerHour: getAverageFromMatches(
      matches,
      (match) => match.actualEarningsPerHour
    ),
    averageSimilarity: getAverageFromMatches(
      matches,
      (match) => match.similarity,
      4
    ),
    message:
      matches.length > 0
        ? 'Contextes similaires récupérés.'
        : 'Aucun contexte similaire trouvé pour cette zone.',
  };
}

function buildSimilarContextErrorResult(error: unknown): SimilarContextsResult {
  const message = getErrorMessage(
    error,
    'Recherche de contextes similaires impossible.'
  );
  return buildInvalidSimilarContextResult(
    hasMissingSimilarContextMigration(message)
      ? 'La recherche de contextes similaires sera disponible après application de la migration Supabase.'
      : message
  );
}

function buildShiftSyncedCounts(
  aggregateCounts: LearningSyncResult['syncedCounts'],
  sessionZonesCount: number,
  predictionsCount: number,
  demandPatternsCount: number
) {
  return {
    emaPatterns: aggregateCounts.emaPatterns,
    beliefs: aggregateCounts.beliefs,
    predictions: predictionsCount,
    demandPatterns: demandPatternsCount,
    sessionZones: sessionZonesCount,
  };
}

async function cleanupFailedShiftSync(sessionId: number) {
  const { error: cleanupZonesError } = await supabase
    .from('session_zones')
    .delete()
    .eq('session_id', sessionId);

  if (cleanupZonesError) {
    console.warn(
      '[syncShiftLearning] Failed to cleanup session_zones after error:',
      cleanupZonesError
    );
  }

  const { error: cleanupSessionError } = await supabase
    .from('sessions')
    .delete()
    .eq('id', sessionId);

  if (cleanupSessionError) {
    console.warn(
      '[syncShiftLearning] Failed to cleanup session after error:',
      cleanupSessionError
    );
  }
}

async function insertOptionalRows<T>(
  tableName: 'session_zones' | 'predictions' | 'demand_patterns',
  rows: T[]
) {
  if (rows.length === 0) return;
  const { error } = await supabase.from(tableName).insert(rows);
  if (error) throw error;
}

export async function syncLearningAggregates(
  trips: TripWithZone[],
  weights: WeightConfig = DEFAULT_WEIGHTS
): Promise<LearningSyncResult> {
  const payload = buildLearningPersistencePayload(trips, weights);

  try {
    const { error: emaError } = await supabase
      .from('ema_patterns')
      .upsert(payload.emaPatterns, {
        onConflict: 'zone_id,day_of_week,hour_block',
      });
    if (emaError) throw emaError;

    const { error: beliefError } = await supabase
      .from('zone_beliefs')
      .upsert(payload.beliefs, {
        onConflict: 'zone_id,day_of_week,hour_block',
      });
    if (beliefError) throw beliefError;

    const { error: weightError } = await supabase
      .from('weight_history')
      .insert(payload.weightHistory);
    if (weightError) throw weightError;

    return {
      ok: true,
      syncedCounts: {
        emaPatterns: payload.emaPatterns.length,
        beliefs: payload.beliefs.length,
        predictions: 0,
        demandPatterns: 0,
        sessionZones: 0,
      },
      message: 'Patterns EMA, croyances et poids synchronisés.',
    };
  } catch (error: unknown) {
    return {
      ok: false,
      syncedCounts: createEmptySyncCounts(),
      message: getLearningSyncFailureMessage(
        error,
        'Sync Supabase impossible.'
      ),
    };
  }
}

export async function syncShiftLearning(
  trips: TripWithZone[],
  startedAtIso: string,
  endedAtIso: string,
  weights: WeightConfig = DEFAULT_WEIGHTS
): Promise<LearningSyncResult> {
  const aggregateResult = await syncLearningAggregates(trips, weights);
  if (!aggregateResult.ok) {
    return aggregateResult;
  }

  const payload = buildShiftPersistencePayload(
    trips,
    startedAtIso,
    endedAtIso,
    weights
  );
  let sessionId: number | null = null;

  try {
    const { data: sessionRow, error: sessionError } = await supabase
      .from('sessions')
      .insert(payload.session)
      .select('id')
      .single();
    if (sessionError) throw sessionError;

    sessionId = Number(sessionRow?.id);
    const sessionZones = payload.sessionZones.map((zone) => ({
      ...zone,
      session_id: sessionId,
    })) satisfies SessionZoneInsert[];

    await insertOptionalRows('session_zones', sessionZones);
    await insertOptionalRows('predictions', payload.predictions);
    await insertOptionalRows('demand_patterns', payload.demandPatterns);

    return {
      ok: true,
      sessionId,
      syncedCounts: buildShiftSyncedCounts(
        aggregateResult.syncedCounts,
        sessionZones.length,
        payload.predictions.length,
        payload.demandPatterns.length
      ),
      message: 'Shift, prédictions et patterns synchronisés vers Supabase.',
    };
  } catch (error: unknown) {
    if (sessionId !== null) {
      await cleanupFailedShiftSync(sessionId);
    }

    return {
      ok: false,
      syncedCounts: aggregateResult.syncedCounts,
      message: getLearningSyncFailureMessage(
        error,
        'Sync du shift impossible.'
      ),
    };
  }
}

export async function findSimilarContextsForTrip(
  trip: TripWithZone,
  matchCount = 5
): Promise<SimilarContextsResult> {
  const args = buildSimilarContextRpcArgs(trip, matchCount);
  if (!args) {
    return buildInvalidSimilarContextResult(
      'Cette course n’est liée à aucune zone exploitable.'
    );
  }

  try {
    const { data, error } = await supabase.rpc('match_similar_contexts', args);
    if (error) throw error;
    return buildSimilarContextSuccessResult(
      (data ?? []) as SimilarContextRpcRow[]
    );
  } catch (error: unknown) {
    return buildSimilarContextErrorResult(error);
  }
}

export async function findSimilarContextsForZoneContext(
  input: ZoneContextInput,
  matchCount = 5
): Promise<SimilarContextsResult> {
  const args = buildZoneSimilarContextRpcArgs(input, matchCount);
  if (!args) {
    return buildInvalidSimilarContextResult('Contexte de zone invalide.');
  }

  try {
    const { data, error } = await supabase.rpc('match_similar_contexts', args);
    if (error) throw error;
    return buildSimilarContextSuccessResult(
      (data ?? []) as SimilarContextRpcRow[]
    );
  } catch (error: unknown) {
    return buildSimilarContextErrorResult(error);
  }
}

export async function findSimilarUserPings(
  driverFingerprint: string,
  input: UserPingContextInput,
  matchCount = 5
): Promise<UserPingMatchesResult> {
  const args = buildUserPingMatchRpcArgs(driverFingerprint, input, matchCount);
  if (!args) {
    return {
      ok: false,
      matches: [],
      averageSuccessScore: 0,
      averageSimilarity: 0,
      message: 'Contexte utilisateur invalide.',
    };
  }

  try {
    const { data, error } = await supabase.rpc('match_user_pings', args);
    if (error) throw error;

    const matches: UserPingMatch[] = ((data ?? []) as UserPingRpcRow[]).map(
      (row) => ({
        id: row.id,
        zoneId: row.zone_id,
        successScore: round(Number(row.success_score ?? 0), 4),
        similarity: round(Number(row.similarity ?? 0), 4),
        createdAt: row.created_at,
      })
    );

    const averageSuccessScore =
      matches.length > 0
        ? round(
            matches.reduce((sum, match) => sum + match.successScore, 0) /
              matches.length,
            4
          )
        : 0;
    const averageSimilarity =
      matches.length > 0
        ? round(
            matches.reduce((sum, match) => sum + match.similarity, 0) /
              matches.length,
            4
          )
        : 0;

    return {
      ok: true,
      matches,
      averageSuccessScore,
      averageSimilarity,
      message:
        matches.length > 0
          ? 'Habitudes similaires récupérées.'
          : 'Aucune habitude similaire trouvée pour cette zone.',
    };
  } catch (error: unknown) {
    const message = getErrorMessage(
      error,
      'Recherche des habitudes utilisateur impossible.'
    );

    return {
      ok: false,
      matches: [],
      averageSuccessScore: 0,
      averageSimilarity: 0,
      message,
    };
  }
}

export async function recordUserPing(
  driverFingerprint: string,
  input: UserPingContextInput & {
    successScore?: number;
    metadata?: Record<string, unknown>;
  }
) {
  if (!driverFingerprint || !input.zoneId) {
    return { ok: false, message: 'Signal utilisateur incomplet.' };
  }

  const source =
    typeof input.metadata?.source === 'string'
      ? input.metadata.source
      : 'unknown';
  const cacheKey = buildUserPingCacheKey(
    driverFingerprint,
    input.zoneId,
    source
  );
  const nowMs = Date.now();
  const lastRecordedAt = readUserPingCache()[cacheKey] ?? null;

  if (shouldThrottleUserPing(lastRecordedAt, nowMs)) {
    return {
      ok: true,
      message: 'Ping utilisateur ignoré: doublon récent.',
    };
  }

  const payload: UserPingInsert = {
    driver_fingerprint: driverFingerprint,
    zone_id: input.zoneId,
    platform: 'lyft',
    context_vector: serializeContextVector(encodeUserPingContextVector(input)),
    success_score: round(clamp01(input.successScore ?? 1), 3),
    metadata: input.metadata ?? null,
  };

  const { error } = await supabase.from('user_pings').insert(payload);
  if (error) {
    return {
      ok: false,
      message: getErrorMessage(
        error,
        'Enregistrement du ping utilisateur impossible.'
      ),
    };
  }

  rememberUserPing(cacheKey, nowMs);

  return {
    ok: true,
    message: 'Ping utilisateur enregistré.',
  };
}
