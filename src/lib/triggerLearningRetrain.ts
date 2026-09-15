// Shared "zero-touch tail" that both BulkScreenshotUploader and
// MaxymoCsvImporter pass as `retrain` to runAutoPipeline (bulkImportPipeline.ts).
// Previously this only called score-calculator, which is why the Admin ·
// Apprentissage IA page's recalibration (weight_history) and AI score
// analysis stayed stale even as batches kept importing — nothing was ever
// invoking weight-calibrator or ai-score-analysis outside a manual button
// click. Each call is independent and best-effort: one failing must not
// skip the others or block the trips that already saved.
//
// syncLearningAggregates (the LearningInsightsPanel's "Sync Supabase"
// button) was the same story — it writes ema_patterns/zone_beliefs/
// weight_history from the current trips list, but nothing called it outside
// that manual click either. Folded in here so a batch import populates
// those tables the same zero-touch way.
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import type { TripWithZone } from '@/hooks/useTrips';
import { syncLearningAggregates } from '@/lib/learningSync';
import { DEFAULT_WEIGHTS } from '@/lib/scoringEngine';

const LEARNING_FUNCTIONS = [
  { name: 'score-calculator', label: 'scores de zones' },
  { name: 'weight-calibrator', label: 'poids de scoring' },
  { name: 'ai-score-analysis', label: 'analyse IA' },
] as const;

const RECENT_TRIPS_LIMIT = 500;

// Real trips only (not the synthetic bootstrap data some UI views mix in) —
// the learned aggregates must reflect actual driving, not seed data.
async function fetchRecentRealTrips(): Promise<TripWithZone[]> {
  const { data, error } = await supabase
    .from('trips')
    .select('*, zones(name, type, current_score)')
    .eq('source', 'real')
    .order('started_at', { ascending: false })
    .limit(RECENT_TRIPS_LIMIT);
  if (error) throw error;
  return (data ?? []) as TripWithZone[];
}

export async function triggerLearningRetrain(savedCount: number): Promise<void> {
  if (savedCount <= 0) return;
  const toastId = toast.loading(`Apprentissage IA (${savedCount} nouvelle(s) course(s))…`);

  const failed: string[] = [];
  for (const fn of LEARNING_FUNCTIONS) {
    try {
      await supabase.functions.invoke(fn.name);
    } catch (err) {
      console.error(`[retrain] ${fn.name} failed:`, err);
      failed.push(fn.label);
    }
  }

  try {
    const trips = await fetchRecentRealTrips();
    const syncResult = await syncLearningAggregates(trips, DEFAULT_WEIGHTS);
    if (!syncResult.ok) failed.push('EMA/croyances');
  } catch (err) {
    console.error('[retrain] syncLearningAggregates failed:', err);
    failed.push('EMA/croyances');
  }

  const totalSteps = LEARNING_FUNCTIONS.length + 1;
  if (failed.length === 0) {
    toast.success('Apprentissage IA mis à jour', { id: toastId });
  } else if (failed.length < totalSteps) {
    toast.error(`Échec partiel (${failed.join(', ')}), le reste est à jour`, { id: toastId });
  } else {
    toast.error('Apprentissage IA échoué (les courses restent sauvegardées)', { id: toastId });
  }
}
