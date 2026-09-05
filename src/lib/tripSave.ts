// Shared trip-persistence helpers used by both the single ScreenshotAnalyzer
// and the bulk BulkScreenshotUploader. A saved trip MUST carry a zone_id and a
// sane started_at, otherwise buildTripHistory drops it from the learning loop.

import type { Zone } from '@/hooks/useSupabase';
import { haversineKm } from '@/hooks/useUserLocation';

export const MIN_TRIP_YEAR = 2025;
export const MAX_GPS_ZONE_KM = 25;

/**
 * Year guard: Gemini occasionally misreads the year on a trip screenshot
 * (e.g. "2020" seen in prod). If the extracted date is missing, unparseable,
 * or predates the app, fall back to now so the trip lands on a sane timestamp.
 */
export function normalizeStartedAt(
  dateStr: string | null | undefined,
  now: Date = new Date(),
): string {
  if (dateStr) {
    const parsed = new Date(dateStr);
    if (!Number.isNaN(parsed.getTime()) && parsed.getFullYear() >= MIN_TRIP_YEAR) {
      return parsed.toISOString();
    }
  }
  return now.toISOString();
}

/**
 * Nearest zone to a GPS fix, within a sane metro radius. Last-resort for the
 * single analyzer (driver is physically at the pickup). NOT used for bulk
 * historical imports, where the current position is irrelevant to an old
 * screenshot.
 */
export function nearestZoneId(lat: number, lng: number, zones: Zone[]): string | null {
  let bestId: string | null = null;
  let bestKm = Infinity;
  for (const z of zones) {
    if (z.latitude == null || z.longitude == null) continue;
    const km = haversineKm(lat, lng, z.latitude, z.longitude);
    if (km < bestKm) {
      bestKm = km;
      bestId = z.id;
    }
  }
  return bestKm <= MAX_GPS_ZONE_KM ? bestId : null;
}

export interface ActiveTripTracking {
  payout_cad: number | null;
  distance_remaining_km: number | null;
  distance_total_km: number | null;
  time_remaining_min: number | null;
  time_total_min: number | null;
}

/**
 * Real-time $/h and $/km from the Maxymo overlay's payout + elapsed portion
 * of the trip (total - remaining). Null once no time/distance has elapsed
 * yet (division by ~0 right after accepting) rather than a misleading spike.
 */
export function computeActiveTripRates(
  t: ActiveTripTracking,
): { dollarsPerHour: number | null; dollarsPerKm: number | null } {
  if (t.payout_cad == null) return { dollarsPerHour: null, dollarsPerKm: null };
  const elapsedMin =
    t.time_total_min != null && t.time_remaining_min != null
      ? t.time_total_min - t.time_remaining_min
      : null;
  const elapsedKm =
    t.distance_total_km != null && t.distance_remaining_km != null
      ? t.distance_total_km - t.distance_remaining_km
      : null;
  return {
    dollarsPerHour: elapsedMin != null && elapsedMin > 0.01 ? (t.payout_cad / elapsedMin) * 60 : null,
    dollarsPerKm: elapsedKm != null && elapsedKm > 0.01 ? t.payout_cad / elapsedKm : null,
  };
}

export interface AnalysisZoneFields {
  matched_zone_id?: string | null;
  extracted_data?: {
    pickup_zone_id?: string | null;
    dropoff_zone_id?: string | null;
  } | null;
}

/**
 * Resolve a trip's zone purely from the screenshot's own analysis:
 * AI-matched zone → pickup zone → dropoff zone. No GPS fallback — a batch of
 * historical screenshots can't be placed by the driver's current location.
 * Returns null when the screenshot carries no usable zone (caller skips it).
 */
export function resolveZoneIdFromAnalysis(
  analysis: AnalysisZoneFields,
): string | null {
  return (
    analysis.matched_zone_id ||
    analysis.extracted_data?.pickup_zone_id ||
    analysis.extracted_data?.dropoff_zone_id ||
    null
  );
}
