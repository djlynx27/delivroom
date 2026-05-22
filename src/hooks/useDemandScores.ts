import {
  getActiveEvents,
  getEndingSoonEvents,
  getStartingSoonEvents,
  useEvents,
} from '@/hooks/useEvents';
import { useStmTransit } from '@/hooks/useStmTransit';
import type { Zone } from '@/hooks/useSupabase';
import { useZones } from '@/hooks/useSupabase';
import {
  getRelevantTmEvents,
  useTicketmasterEvents,
} from '@/hooks/useTicketmaster';
import {
  getAverageTrafficCongestion,
  useTomTomTraffic,
} from '@/hooks/useTomTomTraffic';
import type { TripWithZone } from '@/hooks/useTrips';
import { haversineKm } from '@/hooks/useUserLocation';
import { useWeather } from '@/hooks/useWeather';
import { useZoneScores } from '@/hooks/useZoneScores';
import { supabase } from '@/integrations/supabase/client';
import { type ZoneHistory } from '@/lib/aiAgents';
import { getDriverFingerprint } from '@/lib/driverPreferences';
import {
  findSimilarContextsForZoneContext,
  findSimilarUserPings,
} from '@/lib/learningSync';
import {
  applyHabitBoost,
  computeSuccessProbabilityScore,
} from '@/lib/lyftStrategy';
import { getObservedZoneScore } from '@/lib/observedScore';
import {
  scoreAllZonesWithLearning,
  type ActiveEventBoost,
  type WeatherCondition,
} from '@/lib/scoringEngine';
import {
  buildSurgeContext,
  computeSurge,
  type SurgeResult,
} from '@/lib/surgeEngine';
import { getTripHours } from '@/lib/tripAnalytics';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

export interface ScoreFactors {
  hasWeatherBoost: boolean;
  hasEventBoost: boolean;
  weatherBoostPoints: number;
  eventBoostPoints: number;
  learningBoostPoints?: number;
  learningSimilarity?: number;
  learningAvgEarningsPerHour?: number;
  driverSupplyEstimate?: number;
  proximityFactor?: number;
  successProbability?: number;
  lyftDemandLevel?: number;
  habitBoostPercent?: number;
  habitSimilarity?: number;
  habitSuccessRate?: number;
  realityCapPoints?: number;
}

interface UseDemandScoresOptions {
  currentLat?: number | null;
  currentLng?: number | null;
  conservativePresence?: boolean;
}

interface OvernightRealityCapInput {
  score: number;
  zoneType: string;
  now: Date;
  hasRelevantEvent: boolean;
  weatherBoostPoints?: number;
  lyftDemandLevel?: number | null;
  estimatedWaitMin?: number | null;
  surgeActive?: boolean | null;
}

function logScoreCalculatorIssue(...args: unknown[]) {
  if (import.meta.env.DEV) {
    console.warn(...args);
  }
}

export function applyOvernightRealityCap({
  score,
  zoneType,
  now,
  hasRelevantEvent,
  weatherBoostPoints = 0,
  lyftDemandLevel,
  estimatedWaitMin,
  surgeActive,
}: OvernightRealityCapInput) {
  const hour = now.getHours();
  const isOvernight = hour >= 1 && hour < 5;

  if (!isOvernight) return score;

  const hasStrongLyftSignal =
    surgeActive === true ||
    (lyftDemandLevel ?? 0) >= 8 ||
    (estimatedWaitMin != null && estimatedWaitMin <= 4);

  if (hasRelevantEvent || weatherBoostPoints >= 10 || hasStrongLyftSignal) {
    return score;
  }

  const overnightCaps: Record<string, number> = {
    nightlife: 88,
    événements: 82,
    aéroport: 78,
    transport: 74,
    métro: 68,
    commercial: 60,
    tourisme: 58,
    résidentiel: 56,
    médical: 54,
    université: 50,
  };

  return Math.min(score, overnightCaps[zoneType] ?? 65);
}

export function buildTripHistory(
  tripLogs: TripWithZone[],
  zones: Zone[]
): ZoneHistory[] {
  if (tripLogs.length === 0 || zones.length === 0) return [];

  const zonesById = new Map(zones.map((zone) => [zone.id, zone]));

  return tripLogs
    .flatMap((trip) => {
      if (!trip.zone_id || !trip.started_at) return [];

      const zone = zonesById.get(trip.zone_id);
      if (!zone) return [];

      const startedAtMs = new Date(trip.started_at).getTime();
      if (!Number.isFinite(startedAtMs)) return [];

      const durationHours = getTripHours(trip);
      if (durationHours <= 0) return [];

      const observedScore = getObservedZoneScore(trip);
      const expectedScore = Number(
        trip.zone_score ?? (zone.current_score || 50)
      );

      return [
        {
          zoneId: zone.id,
          observedScore,
          expectedScore,
          timestamp: trip.started_at,
        },
      ];
    })
    .filter((entry): entry is ZoneHistory => entry !== null);
}

/**
 * Hook that provides demand scores for all zones in a city.
 * Primary source: DB scores (calculated by edge function every 30min).
 * Fallback: client-side calculation using weather + events.
 */
export function useDemandScores(
  cityId: string,
  options: UseDemandScoresOptions = {}
) {
  const queryClient = useQueryClient();
  const { data: zones = [] } = useZones(cityId);
  const { data: weather } = useWeather(cityId);
  const { data: events = [] } = useEvents(cityId);
  const { data: tmEvents = [] } = useTicketmasterEvents(cityId);
  const { data: dbScores = [] } = useZoneScores(cityId);
  const { data: trafficSnapshots = [] } = useTomTomTraffic(cityId, zones);
  const { data: stmStatus } = useStmTransit();
  const { data: tripLogs = [] } = useQuery({
    queryKey: ['trip-history', cityId],
    queryFn: async (): Promise<TripWithZone[]> => {
      if (!cityId) return [];

      const { data, error } = await supabase
        .from('trips')
        .select('*, zones!inner(name, type, current_score, city_id)')
        .eq('zones.city_id', cityId)
        .order('started_at', { ascending: false })
        .limit(200);
      if (error) throw error;
      return (data ?? []) as TripWithZone[];
    },
    staleTime: 5 * 60 * 1000,
  });
  const [now, setNow] = useState(new Date());

  // Tick every 15 s so the "best zone right now" recomputes promptly while
  // the driver is sitting at a red light. Each tick is dirt cheap — just a
  // setState that triggers memo recalcs. Battery impact is negligible.
  useEffect(() => {
    const interval = setInterval(() => setNow(new Date()), 15_000);
    return () => clearInterval(interval);
  }, []);

  // Trigger Edge Function when DB scores are absent or older than 10 minutes.
  // The SQL cron refreshes every 10 min; the Edge Function adds weather + AI.
  // Was 35 min — too stale for a "best zone right now" claim.
  const refreshedRef = useRef<Record<string, string>>({});
  useEffect(() => {
    if (!cityId) return;

    const latestCalculatedAt = dbScores.reduce((latest, score) => {
      const calculatedAt = new Date(score.calculated_at).getTime();
      return Number.isFinite(calculatedAt) && calculatedAt > latest
        ? calculatedAt
        : latest;
    }, 0);
    const refreshKey = `${dbScores.length}:${latestCalculatedAt}`;

    const scoresAreStale =
      dbScores.length === 0 ||
      dbScores.some((s) => {
        const ageMs = now.getTime() - new Date(s.calculated_at).getTime();
        return ageMs > 10 * 60 * 1000;
      });

    if (!scoresAreStale) {
      delete refreshedRef.current[cityId];
      return;
    }

    if (refreshedRef.current[cityId] === refreshKey) return;

    const refreshCityId = cityId;
    refreshedRef.current[cityId] = refreshKey;
    supabase.functions
      .invoke('score-calculator')
      .then(({ error }) => {
        if (error) {
          logScoreCalculatorIssue(
            'score-calculator edge function error:',
            error
          );
          return;
        }
        // Invalidate zone-scores cache so the map re-renders with fresh data
        queryClient.invalidateQueries({
          queryKey: ['zone-scores', refreshCityId],
        });
        queryClient.invalidateQueries({ queryKey: ['zones', refreshCityId] });
      })
      .catch((err) => {
        logScoreCalculatorIssue('score-calculator invocation failed:', err);
      });
  }, [cityId, dbScores, now, queryClient]);

  const weatherCondition: WeatherCondition | null = useMemo(() => {
    if (!weather) return null;
    return {
      weatherId: weather.weatherId,
      temp: weather.temp,
      demandBoostPoints: weather.demandBoostPoints,
    };
  }, [weather]);

  const tripHistory: ZoneHistory[] = useMemo(() => {
    return buildTripHistory(tripLogs, zones);
  }, [tripLogs, zones]);

  const activeEvents = useMemo(
    () => getActiveEvents(events, now),
    [events, now]
  );
  const endingSoon = useMemo(
    () => getEndingSoonEvents(events, now, 60),
    [events, now]
  );
  const startingSoon = useMemo(
    () => getStartingSoonEvents(events, now, 90),
    [events, now]
  );
  const relevantTmEvents = useMemo(
    () => getRelevantTmEvents(tmEvents, now, 3),
    [tmEvents, now]
  );

  const relevantEventCoverageByZone = useMemo(() => {
    const coverage = new Map<string, boolean>();

    for (const zone of zones) {
      const hasRelevantEvent = activeEvents.some((event) => {
        const boostAppliesToZoneType =
          event.boost_zone_types.length === 0 ||
          event.boost_zone_types.includes(zone.type);

        if (!boostAppliesToZoneType) return false;

        return (
          haversineKm(
            zone.latitude,
            zone.longitude,
            event.latitude,
            event.longitude
          ) <= event.boost_radius_km
        );
      });

      coverage.set(zone.id, hasRelevantEvent);
    }

    return coverage;
  }, [zones, activeEvents]);

  const eventBoosts: ActiveEventBoost[] = useMemo(() => {
    const dbBoosts: ActiveEventBoost[] = activeEvents.map((e) => ({
      latitude: e.latitude,
      longitude: e.longitude,
      boost_multiplier: e.boost_multiplier,
      boost_radius_km: e.boost_radius_km,
      boost_zone_types: e.boost_zone_types,
    }));

    const tmBoosts: ActiveEventBoost[] = relevantTmEvents.map((e) => ({
      latitude: e.latitude,
      longitude: e.longitude,
      boost_multiplier: 1 + e.boostPoints / 50,
      boost_radius_km: 2,
      boost_zone_types: [],
    }));

    return [...dbBoosts, ...tmBoosts];
  }, [activeEvents, relevantTmEvents]);

  const trafficByZone = useMemo(() => {
    return new Map(
      trafficSnapshots.map((snapshot) => [snapshot.zoneId, snapshot.congestion])
    );
  }, [trafficSnapshots]);

  const averageTrafficCongestion = useMemo(
    () => getAverageTrafficCongestion(trafficSnapshots),
    [trafficSnapshots]
  );
  const driverFingerprint = useMemo(() => getDriverFingerprint(), []);

  const { data: lyftSignals = [] } = useQuery({
    queryKey: [
      'lyft-platform-signals',
      cityId,
      zones.map((zone) => zone.id).join('|'),
    ],
    queryFn: async () => {
      if (!cityId || zones.length === 0) return [];

      const lookbackStart = new Date(
        now.getTime() - 30 * 60 * 1000
      ).toISOString();
      const { data, error } = await supabase
        .from('platform_signals')
        .select(
          'zone_id, demand_level, surge_active, estimated_wait_min, captured_at'
        )
        .eq('platform', 'lyft')
        .in(
          'zone_id',
          zones.map((zone) => zone.id)
        )
        .gte('captured_at', lookbackStart)
        .order('captured_at', { ascending: false });
      if (error) throw error;

      const latestByZone = new Map<string, (typeof data)[number]>();
      for (const row of data ?? []) {
        if (!latestByZone.has(row.zone_id)) {
          latestByZone.set(row.zone_id, row);
        }
      }

      return [...latestByZone.values()];
    },
    enabled: !!cityId && zones.length > 0,
    staleTime: 60_000,
  });

  const lyftSignalByZone = useMemo(() => {
    return new Map(
      lyftSignals.map((signal) => [
        signal.zone_id,
        {
          demandLevel: Number(signal.demand_level ?? 0),
          estimatedWaitMin:
            signal.estimated_wait_min == null
              ? null
              : Number(signal.estimated_wait_min),
          surgeActive: signal.surge_active,
        },
      ])
    );
  }, [lyftSignals]);

  const candidateZonesForSimilarity = useMemo(() => {
    return [...zones]
      .sort(
        (left, right) =>
          Number(right.current_score ?? 0) - Number(left.current_score ?? 0)
      )
      .slice(0, 12);
  }, [zones]);

  const { data: similarContextSignals = [] } = useQuery({
    queryKey: [
      'similar-context-signals',
      cityId,
      now.getDay(),
      now.getHours(),
      now.getMinutes() < 30 ? 0 : 1,
      candidateZonesForSimilarity.map((zone) => zone.id).join('|'),
      weatherCondition?.demandBoostPoints ?? 0,
    ],
    queryFn: async () => {
      if (candidateZonesForSimilarity.length === 0) return [];

      const results = await Promise.all(
        candidateZonesForSimilarity.map(async (zone) => {
          const result = await findSimilarContextsForZoneContext(
            {
              zoneId: zone.id,
              zoneType: zone.type,
              currentScore: Number(zone.current_score ?? 50),
              now,
              trafficCongestion:
                trafficByZone.get(zone.id) ?? averageTrafficCongestion,
              weatherDemandBoostPoints: weatherCondition?.demandBoostPoints,
            },
            5
          );

          return {
            zoneId: zone.id,
            result,
          };
        })
      );

      return results;
    },
    enabled: !!cityId && candidateZonesForSimilarity.length > 0,
    staleTime: 5 * 60 * 1000,
    retry: false,
  });

  const { data: userPingSignals = [] } = useQuery({
    queryKey: [
      'user-ping-signals',
      cityId,
      driverFingerprint,
      now.getDay(),
      now.getHours(),
      options.conservativePresence ? 'conservative' : 'standard',
      candidateZonesForSimilarity.map((zone) => zone.id).join('|'),
      options.currentLat == null ? 'na' : options.currentLat.toFixed(3),
      options.currentLng == null ? 'na' : options.currentLng.toFixed(3),
    ],
    queryFn: async () => {
      if (candidateZonesForSimilarity.length === 0) return [];

      const results = await Promise.all(
        candidateZonesForSimilarity.map(async (zone) => {
          const distanceKm =
            options.currentLat == null || options.currentLng == null
              ? null
              : haversineKm(
                  options.currentLat,
                  options.currentLng,
                  zone.latitude,
                  zone.longitude
                );

          const result = await findSimilarUserPings(
            driverFingerprint,
            {
              zoneId: zone.id,
              zoneType: zone.type,
              currentScore: Number(zone.current_score ?? 50),
              now,
              trafficCongestion:
                trafficByZone.get(zone.id) ?? averageTrafficCongestion,
              weatherDemandBoostPoints: weatherCondition?.demandBoostPoints,
              distanceKm,
              lyftDemandLevel: lyftSignalByZone.get(zone.id)?.demandLevel,
              estimatedWaitMin:
                lyftSignalByZone.get(zone.id)?.estimatedWaitMin ?? null,
              conservativePresence: options.conservativePresence,
            },
            5
          );

          return {
            zoneId: zone.id,
            result,
          };
        })
      );

      return results;
    },
    enabled: !!cityId && candidateZonesForSimilarity.length > 0,
    staleTime: 5 * 60 * 1000,
    retry: false,
  });

  const learningSignalByZone = useMemo(() => {
    const byZone = new Map<
      string,
      {
        boostPoints: number;
        similarity: number;
        avgEarningsPerHour: number;
      }
    >();

    for (const signal of similarContextSignals) {
      if (!signal.result.ok || signal.result.matches.length === 0) continue;

      const normalizedEarnings = Math.max(
        0,
        Math.min(1, (signal.result.averageEarningsPerHour - 18) / 42)
      );
      const confidence = Math.max(
        0,
        Math.min(
          1,
          signal.result.averageSimilarity *
            Math.min(1, signal.result.matches.length / 5)
        )
      );
      const boostPoints = Math.round(normalizedEarnings * confidence * 8);

      if (boostPoints > 0) {
        byZone.set(signal.zoneId, {
          boostPoints,
          similarity: signal.result.averageSimilarity,
          avgEarningsPerHour: signal.result.averageEarningsPerHour,
        });
      }
    }

    return byZone;
  }, [similarContextSignals]);

  const userPingSignalByZone = useMemo(() => {
    const byZone = new Map<
      string,
      {
        averageSimilarity: number;
        averageSuccessScore: number;
        successfulMatches: number;
      }
    >();

    for (const signal of userPingSignals) {
      if (!signal.result.ok || signal.result.matches.length === 0) continue;

      const successfulMatches = signal.result.matches.filter(
        (match) => match.successScore >= 0.7
      ).length;

      if (successfulMatches === 0) continue;

      byZone.set(signal.zoneId, {
        averageSimilarity: signal.result.averageSimilarity,
        averageSuccessScore: signal.result.averageSuccessScore,
        successfulMatches,
      });
    }

    return byZone;
  }, [userPingSignals]);

  // Build score maps: prefer DB scores, fallback to client-side
  const { scores, factors } = useMemo(() => {
    // DB scores indexed by zone_id
    const dbScoreMap = new Map(dbScores.map((s) => [s.zone_id, s]));

    let baseScores = new Map<string, number>();
    let baseFactors = new Map<string, ScoreFactors>();

    if (dbScoreMap.size > 0) {
      const scores = new Map<string, number>();
      const factors = new Map<string, ScoreFactors>();

      for (const zone of zones) {
        const dbRow = dbScoreMap.get(zone.id);
        if (dbRow) {
          const finalScore = dbRow.final_score ?? zone.current_score ?? 50;
          const weatherBoost = dbRow.weather_boost ?? 0;
          const eventBoost = dbRow.event_boost ?? 0;
          scores.set(zone.id, finalScore);
          factors.set(zone.id, {
            hasWeatherBoost: weatherBoost > 0,
            hasEventBoost: eventBoost > 0,
            weatherBoostPoints: weatherBoost,
            eventBoostPoints: eventBoost,
          });
        } else {
          // Zone has no DB score yet, use current_score from zone
          scores.set(zone.id, zone.current_score ?? 50);
          factors.set(zone.id, {
            hasWeatherBoost: false,
            hasEventBoost: false,
            weatherBoostPoints: 0,
            eventBoostPoints: 0,
          });
        }
      }
      baseScores = scores;
      baseFactors = factors;
    } else {
      const fallback = scoreAllZonesWithLearning(
        zones,
        now,
        weatherCondition,
        eventBoosts,
        tripHistory,
        (zone) => ({
          trafficCongestion:
            trafficByZone.get(zone.id) ?? averageTrafficCongestion,
          transitDisruption: stmStatus?.disruptionScore ?? 0,
        })
      );

      baseScores = new Map(fallback.scores);
      baseFactors = new Map(fallback.factors);
    }

    const boostedScores = new Map(baseScores);
    const boostedFactors = new Map(baseFactors);

    for (const [zoneId, signal] of learningSignalByZone) {
      const currentScore = boostedScores.get(zoneId);
      if (currentScore == null) continue;

      boostedScores.set(
        zoneId,
        Math.min(100, currentScore + signal.boostPoints)
      );

      const currentFactors = boostedFactors.get(zoneId);
      if (currentFactors) {
        boostedFactors.set(zoneId, {
          ...currentFactors,
          learningBoostPoints: signal.boostPoints,
          learningSimilarity: signal.similarity,
          learningAvgEarningsPerHour: signal.avgEarningsPerHour,
        });
      }
    }

    for (const zone of zones) {
      const demandContextScore = boostedScores.get(zone.id) ?? 50;
      const lyftSignal = lyftSignalByZone.get(zone.id);
      const distanceKm =
        options.currentLat == null || options.currentLng == null
          ? null
          : haversineKm(
              options.currentLat,
              options.currentLng,
              zone.latitude,
              zone.longitude
            );
      const successScore = computeSuccessProbabilityScore({
        demandContextScore,
        distanceKm,
        demandLevel: lyftSignal?.demandLevel,
        estimatedWaitMin: lyftSignal?.estimatedWaitMin,
        surgeActive: lyftSignal?.surgeActive,
      });
      const habitSignal = userPingSignalByZone.get(zone.id);
      const habitBoost = applyHabitBoost({
        score: successScore.score,
        similarity: habitSignal?.averageSimilarity,
        successfulMatches: habitSignal?.successfulMatches,
      });

      const realityCheckedScore = applyOvernightRealityCap({
        score: habitBoost.score,
        zoneType: zone.type,
        now,
        hasRelevantEvent: relevantEventCoverageByZone.get(zone.id) ?? false,
        weatherBoostPoints:
          boostedFactors.get(zone.id)?.weatherBoostPoints ?? 0,
        lyftDemandLevel: lyftSignal?.demandLevel,
        estimatedWaitMin: lyftSignal?.estimatedWaitMin,
        surgeActive: lyftSignal?.surgeActive,
      });

      boostedScores.set(zone.id, realityCheckedScore);
      boostedFactors.set(zone.id, {
        ...(boostedFactors.get(zone.id) ?? {
          hasWeatherBoost: false,
          hasEventBoost: false,
          weatherBoostPoints: 0,
          eventBoostPoints: 0,
        }),
        driverSupplyEstimate: successScore.driverSupply,
        proximityFactor: successScore.proximityFactor,
        successProbability: successScore.successProbability,
        lyftDemandLevel: lyftSignal?.demandLevel,
        habitBoostPercent: habitBoost.boostPercent,
        habitSimilarity: habitSignal?.averageSimilarity,
        habitSuccessRate: habitSignal?.averageSuccessScore,
        realityCapPoints: Math.max(0, habitBoost.score - realityCheckedScore),
      });
    }

    return { scores: boostedScores, factors: boostedFactors };
  }, [
    zones,
    dbScores,
    now,
    weatherCondition,
    eventBoosts,
    tripHistory,
    trafficByZone,
    averageTrafficCongestion,
    learningSignalByZone,
    lyftSignalByZone,
    relevantEventCoverageByZone,
    userPingSignalByZone,
    options.currentLat,
    options.currentLng,
    stmStatus,
  ]);

  // ── Surge computation per zone ──────────────────────────────────────────
  // Computed client-side from surgeEngine; baseline = current_score from DB
  // (a 4-week baseline via get_surge_baseline() is available from context-embeddings EF)
  const surgeMap = useMemo(() => {
    const map = new Map<string, SurgeResult>();
    for (const zone of zones) {
      const currentScore =
        scores.get(zone.id) ??
        ((zone as Record<string, unknown>).current_score as number) ??
        50;
      const baselineScore =
        ((zone as Record<string, unknown>).base_score as number) ??
        ((zone as Record<string, unknown>).current_score as number) ??
        currentScore;
      const ctx = buildSurgeContext({
        now,
        currentScore,
        baselineScore: baselineScore > 0 ? baselineScore : 50,
        // demandBoostPoints is 0–30 (capped by calcWeatherBoost in useWeather);
        // surgeEngine expects weatherScore on a 0–100 scale and only activates
        // its weather boost when weatherScore > 50. Mapping 0–30 → 0–100 ensures
        // blizzard (30) → 100 and heavy rain (25) → 83, crossing the threshold.
        weatherScore: Math.round(
          ((weatherCondition?.demandBoostPoints ?? 0) / 30) * 100
        ),
        eventProximity: factors.get(zone.id)?.eventBoostPoints ?? 0,
        trafficIndex: trafficByZone.get(zone.id) ?? 0,
        deadheadKm: 5, // conservative default; TodayScreen overrides with GPS
      });
      map.set(zone.id, computeSurge(ctx));
    }
    return map;
  }, [zones, scores, now, weatherCondition, factors, trafficByZone]);

  // Store surge vectors after each recalculation (fire-and-forget)
  const storeSurgeVectors = useCallback(() => {
    for (const zone of zones) {
      const surge = surgeMap.get(zone.id);
      if (!surge) continue;
      // Skip normal-class with no trips to avoid cluttering the DB
      if (surge.surgeClass === 'normal') continue;
      supabase.functions
        .invoke('context-embeddings', {
          body: {
            zone_id: zone.id,
            context_vector: Array.from(surge.contextVector),
            surge_multiplier: surge.surgeMultiplier,
            surge_class: surge.surgeClass,
          },
        })
        .catch(() => {
          // non-blocking — vector storage is best-effort
        });
    }
  }, [zones, surgeMap]);

  // Trigger vector storage once per score refresh
  const lastStoreRef = useRef<number>(0);
  useEffect(() => {
    if (surgeMap.size === 0) return;
    const now = Date.now();
    if (now - lastStoreRef.current < 30 * 60 * 1000) return; // max once per 30 min
    lastStoreRef.current = now;
    storeSurgeVectors();
  }, [surgeMap, storeSurgeVectors]);

  return {
    scores,
    factors,
    zones,
    weather,
    now,
    activeEvents,
    endingSoon,
    startingSoon,
    relevantTmEvents,
    trafficSnapshots,
    averageTrafficCongestion,
    similarContextSignals,
    lyftSignalByZone,
    stmStatus,
    surgeMap,
  };
}
