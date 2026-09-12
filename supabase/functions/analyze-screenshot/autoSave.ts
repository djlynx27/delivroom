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
