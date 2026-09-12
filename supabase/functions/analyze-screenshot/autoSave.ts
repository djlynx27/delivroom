// Pure helpers for analyze-screenshot's auto-save path, split out from
// index.ts so they're testable via `deno test` without binding index.ts's
// serve() listener (same pattern as ingest-lyft-screenshots/lyftSnapshot.ts).

import type { AnalysisResult, ExtractedData } from './index.ts';

export const MIN_TRIP_YEAR = 2025;

// Mirrors src/lib/tripSave.ts's normalizeStartedAt — duplicated rather than
// cross-imported since this Deno function can't pull in a Vite/browser TS
// module (different runtime/module resolution).
export function normalizeStartedAt(dateStr: string | null | undefined, now = new Date()): string {
  if (dateStr) {
    const parsed = new Date(dateStr);
    if (!Number.isNaN(parsed.getTime()) && parsed.getFullYear() >= MIN_TRIP_YEAR) {
      return parsed.toISOString();
    }
  }
  return now.toISOString();
}

export function resolveDurationMinutes(d: ExtractedData): number | null {
  if (d.pickup_time_minutes != null && d.ride_time_minutes != null) {
    return d.pickup_time_minutes + d.ride_time_minutes;
  }
  if (d.ride_time_minutes != null) return d.ride_time_minutes;
  if (d.hours_worked != null) return d.hours_worked * 60;
  return null;
}

export function computeEndedAt(startedAtIso: string, durationMinutes: number | null): string | null {
  if (durationMinutes == null || durationMinutes <= 0) return null;
  return new Date(new Date(startedAtIso).getTime() + durationMinutes * 60_000).toISOString();
}

// driver-screenshots objects are uploaded at `${userId}/${timestamp}-${filename}`
// (see BulkScreenshotUploader.tsx / ScreenshotAnalyzer.tsx) — the signed URL
// this function receives still carries that path, so the owning driver can be
// read straight off it without needing the caller's JWT.
export function extractUserIdFromStorageUrl(url: string): string | null {
  const match = url.match(/\/driver-screenshots\/([0-9a-f-]{36})\//i);
  return match?.[1] ?? null;
}

/**
 * Whether this analysis is confident enough to auto-save as a trip with no
 * human review: a catalog-verified zone (`matched_zone_id` — never the
 * city-level best-guess fallback used for pickup/dropoff resolution) AND a
 * revenue figure AND a signal that the ride actually happened, not just an
 * offer.
 *
 * A pre-accept Lyft offer card shows pickup_time/pickup_distance/ride_time/
 * ride_distance (see ExtractedData's ride-offer-decomposition fields, read by
 * rideDecision.ts's accept/skip agent) — and often the *offered* fare too,
 * which would otherwise satisfy an earnings>0 check even for a ride the
 * driver declined two seconds later. Requiring one of active_trip_payout
 * (Maxymo's live Trip Tracking overlay, only visible mid-ride),
 * hours_worked, or trips_count (shift/daily summary fields, never present on
 * a single offer card) rules that out without yet needing a full
 * offer/accepted/declined status column.
 */
export function hasAutoSaveConfidence(analysis: AnalysisResult): boolean {
  const d = analysis.extracted_data;
  if (!analysis.matched_zone_id || !d) return false;
  const hasRevenue = (d.earnings != null && d.earnings > 0) || (d.tips != null && d.tips > 0);
  if (!hasRevenue) return false;
  return d.active_trip_payout != null || d.hours_worked != null || d.trips_count != null;
}

/** Stable idempotency key for a screenshot, from its storage object path. */
export function autoSaveNotesTag(imageUrl: string): string {
  const objectPath = imageUrl.split('/driver-screenshots/')[1]?.split('?')[0] ?? imageUrl;
  return `Import auto — ${objectPath}`.slice(0, 500);
}

// Same test hasAutoSaveConfidence's docstring above uses to spot a bare
// pre-accept offer card: the pickup/ride time+distance decomposition
// rideDecision.ts's accept/skip agent reads, absent from shift summaries and
// from confirmed-ride screenshots (Maxymo Trip Tracking overlay).
function looksLikeOfferCard(d: ExtractedData): boolean {
  return d.pickup_time_minutes != null || d.ride_time_minutes != null;
}

export interface TripsRawOfferInsert {
  driver_id: string;
  platform: 'lyft';
  offer_status: 'unknown';
  started_at: string;
  zone_id: string;
  pickup_distance_km: number | null;
  pickup_time_min: number | null;
  trip_distance_km: number | null;
  drive_time_min: number | null;
  fare_cad: number | null;
  content_hash: string;
}

/**
 * A pre-accept offer card is real-time market intelligence (demand/pricing
 * signal in this zone, right now) whether the driver went on to accept it or
 * not — see trips_raw's existing offer_status column, so far only fed by the
 * Maxymo CSV importer (buildTripsRawInsert in maxymoCsvParsing.ts). This
 * mirrors that same "raw market history" concept for screenshot-sourced Lyft
 * offers: every offer card gets archived here as 'unknown' regardless of
 * hasAutoSaveConfidence, and the bulk-import correlation flips it to
 * 'accepted' client-side once a corroborating confirmed-ride screenshot shows
 * up in the same batch (see isSavableAsTrip in bulkImportPipeline.ts). Offers
 * that never get corroborated simply stay 'unknown' — never guessed as
 * 'rejected', since a screenshot alone can't distinguish a decline from a
 * ride confirmed in a separate, not-yet-scanned batch.
 *
 * Returns null when this isn't an offer card, or the caller didn't supply
 * enough to record one (no verified zone, no content hash to dedup on).
 */
export function buildOfferSignalInsert(
  analysis: AnalysisResult,
  contentHash: string | null | undefined,
  authUserId: string | null,
): TripsRawOfferInsert | null {
  const d = analysis.extracted_data;
  if (!authUserId || !contentHash || !analysis.matched_zone_id || !d) return null;
  if (!looksLikeOfferCard(d)) return null;
  return {
    driver_id: authUserId,
    platform: 'lyft',
    offer_status: 'unknown',
    started_at: normalizeStartedAt(d.date),
    zone_id: analysis.matched_zone_id,
    pickup_distance_km: d.pickup_distance_km ?? null,
    pickup_time_min: d.pickup_time_minutes ?? null,
    trip_distance_km: d.ride_distance_km ?? null,
    drive_time_min: d.ride_time_minutes ?? null,
    fare_cad: d.earnings ?? null,
    content_hash: contentHash,
  };
}
