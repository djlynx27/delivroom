import type { AntiDeadheadSuggestion } from '@/hooks/useAntiDeadhead';
import type { ReturnCorridorResult } from '@/lib/scoringEngine';
import { Button } from '@/components/ui/button';
import { ReturnCorridorBadge } from '@/components/drive/ReturnCorridorBadge';
import { Navigation } from 'lucide-react';

export interface AntiDeadheadCardProps {
  suggestion: AntiDeadheadSuggestion;
  corridor: ReturnCorridorResult | null;
  onNavigate: () => void;
}

/**
 * Shown when the driver is parked in a "dead zone" (useAntiDeadhead) --
 * surfaces the reposition suggestion and, if the hub is far enough away,
 * the multi-step return corridor (getReturnCorridor) instead of one long
 * deadhead leg.
 */
export function AntiDeadheadCard({
  suggestion,
  corridor,
  onNavigate,
}: AntiDeadheadCardProps) {
  const urgencyClass =
    suggestion.urgency === 'high'
      ? 'border-red-500/40'
      : suggestion.urgency === 'medium'
        ? 'border-amber-500/40'
        : 'border-border';

  return (
    <div className={`bg-card rounded-xl border px-4 py-3 space-y-2 ${urgencyClass}`}>
      <p className="text-[13px] font-body text-foreground">{suggestion.reason}</p>

      {corridor?.active && corridor.steps.length > 0 && (
        <ReturnCorridorBadge steps={corridor.steps} hubName={suggestion.zone.name} />
      )}

      {suggestion.strategy === 'reposition' && (
        <Button
          onClick={onNavigate}
          size="sm"
          className="w-full gap-2 font-display font-bold"
        >
          <Navigation className="w-4 h-4" />
          Naviguer
        </Button>
      )}
    </div>
  );
}
