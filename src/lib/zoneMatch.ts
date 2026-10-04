import { haversineKm } from '@/hooks/useUserLocation';
import { MAX_GPS_ZONE_KM } from '@/lib/tripSave';

// Structural rather than the full generated `Zone` (Tables<'zones'>) type —
// lets callers pass either the full Zone row or a lighter REST projection
// (see shiftGeoWatcher.ts's LiteZone) without a cast.
export interface ZoneLike {
  latitude: number;
  longitude: number;
  type?: string | null;
}

// Shared by both foreground code (useNotifications.ts) and the background
// geolocation isolate (shiftGeoWatcher.ts) — kept dependency-free (no React)
// so it can be imported from a plugin callback context.
//
// No cap == a mis-geocoded event (or one genuinely outside the Delivroom
// territory) would still resolve to whatever zone is technically closest,
// and a "positionne-toi près de X" push notification would send a driver
// toward a zone that's actually 100+ km away. Same MAX_GPS_ZONE_KM sanity
// radius tripSave.ts already uses for GPS-fix zone matching.
export function findNearestZone<T extends ZoneLike>(lat: number, lng: number, zones: T[]): T | null {
  let best: T | null = null;
  let bestDist = Infinity;
  for (const z of zones) {
    const d = haversineKm(lat, lng, z.latitude, z.longitude);
    if (d < bestDist) {
      bestDist = d;
      best = z;
    }
  }
  return bestDist <= MAX_GPS_ZONE_KM ? best : null;
}

// Stricter than findNearestZone's 25km (a much narrower "is this worth an
// actionable drive right now" cap, not "is this technically in-territory")
// AND score-aware with a real distance penalty rather than a pure cutoff.
// Recurred on-device 2026-09-16: from Saint-Léonard/L'Acadie, Station
// Montmorency (Laval) and Terminus Longueuil (11.7km) both won on raw score
// alone despite much closer Montreal zones existing, because the only
// distance handling at the time was an outer 15km cutoff with the score
// otherwise untouched inside it.
export const MAX_HERO_ZONE_DISTANCE_KM = 7;
// Points subtracted per km from a zone's ranking score (the zone's own
// displayed `score` is never touched — this only affects ranking order).
export const DISTANCE_PENALTY_PER_KM = 3;

// Lab-only taxi bias (display ranking order only — never the learning model,
// never the displayed score). Real `zones.type` values are French; hubs =
// transit, airport, medical/hospital and event venues. [À VÉRIFIER contre la
// DB live: valeurs déduites du seed/tests, Supabase MCP non authentifié.]
export const TAXI_HUB_ZONE_TYPES: readonly string[] = ['métro', 'transport', 'aéroport', 'médical', 'événements'];
// ESTIMATED_LAB_BIAS: To be calibrated via nav_events
export const TAXI_HUB_LAB_MULTIPLIER = 1.1;
// ESTIMATED_LAB_BIAS: To be calibrated via nav_events
// Approaches past this distance get their score scaled down (stricter than
// learningEngine's DEADHEAD_PENALTY_FACTOR 0.85, which is left untouched).
export const DEADHEAD_LAB_THRESHOLD_KM = 4;
export const DEADHEAD_LAB_FACTOR = 0.75;

function labAdjustedScore(score: number, type: string | null | undefined, distKm: number): number {
  let adjusted = score;
  if (type && TAXI_HUB_ZONE_TYPES.includes(type)) adjusted *= TAXI_HUB_LAB_MULTIPLIER;
  if (distKm > DEADHEAD_LAB_THRESHOLD_KM) adjusted *= DEADHEAD_LAB_FACTOR;
  return adjusted;
}

export type ScoredZone<T> = T & { score: number };
export type DistanceRankedZone<T> = ScoredZone<T> & { distKm: number };

/**
 * Filters zones to `maxDistanceKm` of the origin, then ranks them by
 * `score - distKm * penaltyPerKm` (ties broken by distance) rather than raw
 * score — so a farther zone needs a real demand edge, not a marginal one,
 * to outrank a closer one. `labTaxiBias` (Lab build only) additionally boosts
 * taxi hub types and scales down far approaches — see constants above.
 */
export function rankByProximityPenalizedScore<T extends ZoneLike>(
  originLat: number,
  originLng: number,
  zones: ScoredZone<T>[],
  maxDistanceKm: number = MAX_HERO_ZONE_DISTANCE_KM,
  penaltyPerKm: number = DISTANCE_PENALTY_PER_KM,
  labTaxiBias: boolean = false
): DistanceRankedZone<T>[] {
  const rankOf = (z: DistanceRankedZone<T>) =>
    (labTaxiBias ? labAdjustedScore(z.score, z.type, z.distKm) : z.score) - z.distKm * penaltyPerKm;
  return zones
    .map((z) => ({
      ...z,
      distKm: haversineKm(originLat, originLng, z.latitude, z.longitude),
    }))
    .filter((z) => z.distKm <= maxDistanceKm)
    .sort((a, b) => {
      return rankOf(b) - rankOf(a) || a.distKm - b.distKm;
    });
}
