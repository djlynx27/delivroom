/**
 * useSmartZones — arrival-time zone scoring
 *
 * Extracted from TodayScreen per SRP (ISO 25010 Maintainability).
 * Computes "smart zones": zones scored at ARRIVAL time, considering
 * travel time from driver's current position + Lyft demand signals.
 *
 * Returns the top-5 reachable zones with score ≥ 45 and distance ≤ 35 km.
 */
import { haversineKm } from '@/hooks/useUserLocation';
import { formatTime24h } from '@/lib/demandUtils';
import {
  computeSuccessProbabilityScore,
  type LyftMarketSignal,
} from '@/lib/lyftStrategy';
import { computeDemandScore, type WeatherCondition } from '@/lib/scoringEngine';
import { useEffect, useMemo, useRef } from 'react';

const AVG_SPEED_KMH = 30;
// 35 km covers Laval <-> downtown MTL / Vieux-Port -- score should arbitrate profitability,
// distance is just a reachability sanity cap, not a city-boundary filter.
const MAX_DISTANCE_KM = 35;
const MIN_ARRIVAL_SCORE = 45;
const MAX_RESULTS = 5;

interface Zone {
  id: string;
  name: string;
  type: string;
  score: number;
  latitude: number;
  longitude: number;
}

interface WeatherInput {
  weatherId: number;
  temp: number;
  demandBoostPoints: number;
}

export interface SmartZone extends Zone {
  distKm: number;
  travelMin: number;
  arrivalScore: number;
  arrivalTime: string;
}

interface UseSmartZonesParams {
  modeZones: Zone[];
  userLocation: { latitude: number; longitude: number } | null;
  weather: WeatherInput | null | undefined;
  lyftSignalByZone: Map<string, LyftMarketSignal>;
  now: Date;
}

/**
 * Returns memoized smart zones sorted by arrival score descending.
 * Also keeps a ref up-to-date for callback closures that need the latest value.
 */
export function useSmartZones({
  modeZones,
  userLocation,
  weather,
  lyftSignalByZone,
  now,
}: UseSmartZonesParams): {
  smartZones: SmartZone[];
  smartZonesRef: React.RefObject<SmartZone[]>;
} {
  const smartZonesRef = useRef<SmartZone[]>([]);

  const smartZones = useMemo<SmartZone[]>(() => {
    if (!userLocation) return [];

    const weatherCond: WeatherCondition | null = weather
      ? {
          weatherId: weather.weatherId,
          temp: weather.temp,
          demandBoostPoints: weather.demandBoostPoints,
        }
      : null;

    return modeZones
      .map((z) => {
        const distKm = haversineKm(
          userLocation.latitude,
          userLocation.longitude,
          z.latitude,
          z.longitude
        );
        const travelMin = Math.round((distKm / AVG_SPEED_KMH) * 60);
        const arrivalDate = new Date(now.getTime() + travelMin * 60_000);
        const { score: arrivalDemandScore } = computeDemandScore(
          z,
          arrivalDate,
          weatherCond
        );
        const lyft = lyftSignalByZone.get(z.id);
        const arrivalScore = computeSuccessProbabilityScore({
          demandContextScore: arrivalDemandScore,
          distanceKm: distKm,
          demandLevel: lyft?.demandLevel,
          estimatedWaitMin: lyft?.estimatedWaitMin,
          surgeActive: lyft?.surgeActive,
        }).score;

        return {
          ...z,
          distKm,
          travelMin,
          arrivalScore,
          arrivalTime: formatTime24h(arrivalDate),
        };
      })
      .filter(
        (z) =>
          z.distKm <= MAX_DISTANCE_KM && z.arrivalScore >= MIN_ARRIVAL_SCORE
      )
      .sort((a, b) => b.arrivalScore - a.arrivalScore)
      .slice(0, MAX_RESULTS);
  }, [lyftSignalByZone, modeZones, now, userLocation, weather]);

  // Keep ref in sync for callbacks that need latest value without triggering re-renders
  useEffect(() => {
    smartZonesRef.current = smartZones;
  }, [smartZones]);

  return { smartZones, smartZonesRef };
}
