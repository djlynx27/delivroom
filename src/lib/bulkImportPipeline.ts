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
  analysis?: {
    is_fallback?: boolean;
    extracted_data?: { earnings?: number | null } | null;
  } | null;
}

/**
 * A screenshot is worth saving as a trip only if the AI actually read a fare
 * off it (heatmaps and fallbacks carry no earnings) and it hasn't already
 * been saved in a prior run.
 */
export function isSavableAsTrip(it: PipelineItem): boolean {
  if (it.status !== 'done' && it.status !== 'duplicate') return false;
  if (it.tripSaved) return false;
  const a = it.analysis;
  if (!a || a.is_fallback) return false;
  return (a.extracted_data?.earnings ?? 0) > 0;
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
  const candidates = items.filter(isSavableAsTrip);
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
