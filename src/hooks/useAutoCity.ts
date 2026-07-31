/**
 * Auto-detects the nearest city (mtl / lvl / lng) from the user's GPS position
 * and updates cityId when the detected city materially changes.
 *
 * Approximate city centroids (WGS-84):
 *   Montréal  45.508, -73.587
 *   Laval     45.608, -73.747
 *   Longueuil 45.531, -73.518
 */
import { haversineKm } from '@/hooks/useUserLocation';
import { useEffect, useRef } from 'react';

const CITY_REFERENCE_POINTS: {
  id: string;
  points: Array<{ lat: number; lng: number }>;
}[] = [
  {
    id: 'mtl',
    points: [
      { lat: 45.5017, lng: -73.5673 },
      { lat: 45.5874, lng: -73.595 },
      { lat: 45.5207, lng: -73.6156 },
      { lat: 45.4706, lng: -73.7408 },
    ],
  },
  {
    id: 'lvl',
    points: [
      { lat: 45.608, lng: -73.747 },
      { lat: 45.5607, lng: -73.7497 },
      { lat: 45.5775, lng: -73.6921 },
    ],
  },
  {
    id: 'lng',
    points: [
      { lat: 45.531, lng: -73.518 },
      { lat: 45.5369, lng: -73.5107 },
      { lat: 45.5179, lng: -73.4659 },
    ],
  },
  { id: 'bsb', points: [{ lat: 45.62, lng: -73.843 }] },
  { id: 'sth', points: [{ lat: 45.642, lng: -73.829 }] },
  { id: 'blv', points: [{ lat: 45.675, lng: -73.878 }] },
  { id: 'rsm', points: [{ lat: 45.638, lng: -73.799 }] },
  { id: 'trb', points: [{ lat: 45.702, lng: -73.645 }] },
];

const IMMEDIATE_SWITCH_MARGIN_KM = 3;
const CONFIRMED_SWITCH_SAMPLES = 2;

function getNearestCityDetection(lat: number, lng: number) {
  const rankedCities = CITY_REFERENCE_POINTS.map((city) => ({
    id: city.id,
    distanceKm: Math.min(
      ...city.points.map((point) => haversineKm(lat, lng, point.lat, point.lng))
    ),
  })).sort((a, b) => a.distanceKm - b.distanceKm);

  const bestMatch = rankedCities[0] ?? { id: 'mtl', distanceKm: Infinity };
  const secondBestDistance = rankedCities[1]?.distanceKm ?? Infinity;

  return {
    cityId: bestMatch.id,
    distanceKm: bestMatch.distanceKm,
    marginKm: secondBestDistance - bestMatch.distanceKm,
  };
}

export function nearestCityId(lat: number, lng: number): string {
  return getNearestCityDetection(lat, lng).cityId;
}

/**
 * Keeps cityId aligned with the detected city, while avoiding repeated writes for
 * the same detection so a manual override can still stick until GPS resolves to
 * a different city.
 */
/**
 * Ajoute refreshKey pour forcer la détection même si la position n'a pas changé.
 */
export function useAutoCity(
  currentCityId: string,
  setCityId: (id: string) => void,
  userLat: number | null | undefined,
  userLng: number | null | undefined,
  refreshKey?: any
) {
  const lastAutoCityRef = useRef<string | null>(null);
  const pendingCityRef = useRef<{ id: string; confirmations: number } | null>(
    null
  );

  useEffect(() => {
    if (userLat == null || userLng == null) return;

    const detectedCity = getNearestCityDetection(userLat, userLng);
    const detectedCityId = detectedCity.cityId;

    if (detectedCityId === currentCityId) {
      lastAutoCityRef.current = detectedCityId;
      pendingCityRef.current = null;
      return;
    }

    if (detectedCityId === lastAutoCityRef.current) {
      return;
    }

    const requiresConfirmation =
      detectedCity.marginKm < IMMEDIATE_SWITCH_MARGIN_KM;

    if (requiresConfirmation) {
      if (pendingCityRef.current?.id === detectedCityId) {
        pendingCityRef.current = {
          id: detectedCityId,
          confirmations: pendingCityRef.current.confirmations + 1,
        };
      } else {
        pendingCityRef.current = { id: detectedCityId, confirmations: 1 };
      }

      if (
        (pendingCityRef.current?.confirmations ?? 0) < CONFIRMED_SWITCH_SAMPLES
      ) {
        return;
      }
    } else {
      pendingCityRef.current = null;
    }

    lastAutoCityRef.current = detectedCityId;
    pendingCityRef.current = null;
    setCityId(detectedCityId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentCityId, userLat, userLng, setCityId, refreshKey]);
}
