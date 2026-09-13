// Shared "zero-touch tail" that both BulkScreenshotUploader and
// MaxymoCsvImporter pass as `retrain` to runAutoPipeline (bulkImportPipeline.ts).
// Previously this only called score-calculator, which is why the Admin ·
// Apprentissage IA page's recalibration (weight_history) and AI score
// analysis stayed stale even as batches kept importing — nothing was ever
// invoking weight-calibrator or ai-score-analysis outside a manual button
// click. Each call is independent and best-effort: one failing must not
// skip the others or block the trips that already saved.
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

const LEARNING_FUNCTIONS = [
  { name: 'score-calculator', label: 'scores de zones' },
  { name: 'weight-calibrator', label: 'poids de scoring' },
  { name: 'ai-score-analysis', label: 'analyse IA' },
] as const;

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

  if (failed.length === 0) {
    toast.success('Apprentissage IA mis à jour', { id: toastId });
  } else if (failed.length < LEARNING_FUNCTIONS.length) {
    toast.error(`Échec partiel (${failed.join(', ')}), le reste est à jour`, { id: toastId });
  } else {
    toast.error('Apprentissage IA échoué (les courses restent sauvegardées)', { id: toastId });
  }
}
