// supabase/functions/score-calculator/eventBoost.ts
//
// Event-boost distance decay for score-calculator. Gaussian falloff
// (sigma = boost_radius_km / 2) replaces the previous binary
// inside-radius-or-nothing cutoff — ~13.5% of the max boost remains at
// dist = boost_radius_km instead of dropping to zero. The client copy of
// this same formula lives in src/lib/scoringEngine.ts's
// computeEventBoostPoints; haversineKm is duplicated across the Vite/Deno
// boundary the same way src/scripts/lib/geo.ts's haversineMeters already
// is elsewhere in this codebase.

export function haversineKm(
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

export function gaussianDecay(distKm: number, boostRadiusKm: number): number {
  const sigma = boostRadiusKm / 2;
  if (sigma <= 0) return distKm === 0 ? 1 : 0;
  return Math.exp(-(distKm ** 2) / (2 * sigma ** 2));
}

export interface EventBoostInput {
  latitude: number;
  longitude: number;
  boost_multiplier: number;
  boost_radius_km: number;
}

export function computeEventBoost(
  zone: { latitude: number; longitude: number },
  activeEvents: EventBoostInput[]
): number {
  let boost = 0;
  for (const event of activeEvents) {
    const distKm = haversineKm(zone.latitude, zone.longitude, event.latitude, event.longitude);
    const maxBoostPoints = Math.min((event.boost_multiplier - 1) * 15, 20);
    boost += maxBoostPoints * gaussianDecay(distKm, event.boost_radius_km ?? 3);
  }
  return Math.min(boost, 25);
}
