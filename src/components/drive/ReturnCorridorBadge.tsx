import { cn } from '@/lib/utils';
import type { ReturnCorridorStep } from '@/lib/scoringEngine';

export interface ReturnCorridorBadgeProps {
  steps: ReturnCorridorStep[];
  hubName: string;
  className?: string;
}

/**
 * "🔄 Corridor de retour actif (Étape 1/2 → [hub])" — shown when the driver
 * is in a dead zone far enough from the recommended hub that
 * getReturnCorridor (scoringEngine.ts) broke the trip into intermediate
 * prospection stops instead of one long deadhead leg.
 */
export function ReturnCorridorBadge({
  steps,
  hubName,
  className,
}: ReturnCorridorBadgeProps) {
  if (steps.length === 0) return null;
  const nextStep = steps[0]!;

  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full bg-sky-500/15 text-sky-400 text-[12px] font-bold px-2.5 py-1 truncate max-w-full',
        className
      )}
    >
      🔄 Corridor de retour actif — Étape 1/{steps.length} : {nextStep.name} → {hubName}
    </span>
  );
}
