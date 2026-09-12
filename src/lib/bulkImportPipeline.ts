// Shared "what happens after a batch finishes" orchestration for the Maxymo
// bulk importer. Both the manual batch run and the background upload-retry
// queue need the exact same zero-touch tail (auto-save -> refresh every
// query the learning loop reads from -> retrain), so it lives here once
// instead of being duplicated — and duplicated wrong — at each call site.

export interface PipelineItem {
  status:
    | 'pending'
    | 'hashing'
    | 'duplicate'
    | 'uploading'
    | 'analyzing'
    | 'done'
    | 'failed'
    | 'skipped';
  tripSaved?: boolean;
  // When the underlying screenshot/record actually happened (e.g. the file's
  // lastModified) — only needed to corroborate a pre-accept offer card
  // against a later confirmed-ride screenshot, see isSavableAsTrip below.
  timestampMs?: number;
  analysis?: {
    is_fallback?: boolean;
    matched_zone_id?: string | null;
    extracted_data?: {
      earnings?: number | null;
      active_trip_payout?: number | null;
      hours_worked?: number | null;
      trips_count?: number | null;
      pickup_time_minutes?: number | null;
      ride_time_minutes?: number | null;
    } | null;
  } | null;
}

// A confirmed offer card and its corroborating "ride actually happened"
// screenshot (Maxymo Trip Tracking overlay, or a shift summary) come from the
// same real-world ride, taken minutes apart — never hours. Same pattern as
// MAX_GPS_ZONE_KM in tripSave.ts: a matching window needs an explicit cap so
// an unrelated ride in the same zone hours later can't false-positive it.
const OFFER_CONFIRM_WINDOW_MS = 20 * 60 * 1000;

function hasConfirmedSignal(a: NonNullable<PipelineItem['analysis']>): boolean {
  const d = a.extracted_data;
  return d?.active_trip_payout != null || d?.hours_worked != null || d?.trips_count != null;
}

// Mirrors autoSave.ts's hasAutoSaveConfidence reasoning: a bare Lyft
// ride-offer card carries the same pickup/ride time+distance decomposition
// rideDecision.ts's accept/skip agent reads (see ExtractedData), whether the
// driver went on to accept it or not. A shift summary / CSV import row never
// carries these fields, so this only ever flags an actual offer card.
function looksLikeOfferCard(a: NonNullable<PipelineItem['analysis']>): boolean {
  const d = a.extracted_data;
  return d?.pickup_time_minutes != null || d?.ride_time_minutes != null;
}

// Whether some other item in the batch confirms `it` (a bare offer card)
// actually became a real ride: same matched zone, a confirmed-activity
// signal of its own, within OFFER_CONFIRM_WINDOW_MS either direction.
function findCorroboratingScreenshot<T extends PipelineItem>(it: T, allItems: readonly T[]): boolean {
  const zoneId = it.analysis?.matched_zone_id;
  if (!zoneId || it.timestampMs == null) return false;
  return allItems.some((other) => isCorroboratingMatch(other, it, zoneId, it.timestampMs!));
}

function isCorroboratingMatch<T extends PipelineItem>(
  other: T,
  it: T,
  zoneId: string,
  timestampMs: number,
): boolean {
  if (other === it || other.timestampMs == null) return false;
  const oa = other.analysis;
  if (!oa || oa.matched_zone_id !== zoneId || !hasConfirmedSignal(oa)) return false;
  return Math.abs(other.timestampMs - timestampMs) <= OFFER_CONFIRM_WINDOW_MS;
}

// Status/dedup/fare prefilter, same for every item shape regardless of the
// offer-card corroboration question below.
function hasSavableBase(it: PipelineItem): boolean {
  if (it.status !== 'done' && it.status !== 'duplicate') return false;
  if (it.tripSaved) return false;
  const a = it.analysis;
  if (!a || a.is_fallback) return false;
  return (a.extracted_data?.earnings ?? 0) > 0;
}

/**
 * A screenshot is worth saving as a trip only if the AI actually read a fare
 * off it (heatmaps and fallbacks carry no earnings), it hasn't already been
 * saved in a prior run, AND — for a bare pre-accept offer card — a sibling
 * screenshot in the same batch confirms the ride actually happened (same
 * zone, within OFFER_CONFIRM_WINDOW_MS). Without that corroboration an offer
 * card is indistinguishable from one the driver declined seconds later.
 */
export function isSavableAsTrip<T extends PipelineItem>(
  it: T,
  allItems: readonly T[] = [it],
): boolean {
  if (!hasSavableBase(it)) return false;
  const a = it.analysis!;
  if (!looksLikeOfferCard(a) || hasConfirmedSignal(a)) return true;
  return findCorroboratingScreenshot(it, allItems);
}

// Every query the learning loop reads from: trips-feed/trip-history feed
// deriveLearningInsights (EMA + Bayesian, learningEngine.ts); zone-scores/
// zones feed scoringEngine's applyLearningAgents (TrendAgent + RushHourAgent,
// aiAgents.ts). All four must refresh together or the UI keeps showing
// pre-import scores/insights even after score-calculator has already
// recomputed them server-side.
export const LEARNING_REFRESH_QUERY_KEYS = [
  'trips-feed',
  'trip-history',
  'zone-scores',
  'zones',
] as const;

export interface AutoPipelineDeps<T extends PipelineItem> {
  /** Persists the candidates as `trips` rows, returns how many were actually saved. */
  saveTrips: (candidates: T[]) => Promise<number>;
  invalidate: (queryKey: string) => void;
  /** Server-side zone score recalculation; called with how many trips were just saved. */
  retrain: (savedCount: number) => Promise<void>;
}

export interface AutoPipelineResult {
  savedCount: number;
}

/**
 * Import terminé -> Auto-Save -> Auto-Sync -> Auto-Train, in that order, with
 * no click required. Retrain is keyed on how many trips were ACTUALLY saved
 * (not how many screenshots were uploaded) — a batch of pure duplicates with
 * nothing new to save must not trigger a wasted server recalculation, while
 * saving already-analyzed duplicates from a prior session must still retrain
 * even though no new upload happened this run.
 */
export async function runAutoPipeline<T extends PipelineItem>(
  items: T[],
  deps: AutoPipelineDeps<T>,
): Promise<AutoPipelineResult> {
  const candidates = items.filter((it) => isSavableAsTrip(it, items));
  let savedCount = 0;
  if (candidates.length) {
    savedCount = await deps.saveTrips(candidates);
  }
  for (const key of LEARNING_REFRESH_QUERY_KEYS) {
    deps.invalidate(key);
  }
  await deps.retrain(savedCount);
  return { savedCount };
}
