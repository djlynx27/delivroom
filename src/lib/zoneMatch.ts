import { haversineKm } from '@/hooks/useUserLocation';
import { MAX_GPS_ZONE_KM } from '@/lib/tripSave';

// Structural rather than the full generated `Zone` (Tables<'zones'>) type —
// lets callers pass either the full Zone row or a lighter REST projection
// (see shiftGeoWatcher.ts's LiteZone) without a cast.
export interface ZoneLike {
  latitude: number;
  longitude: number;
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
