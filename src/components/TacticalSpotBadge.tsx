import { bearingToCompassLabel, type MicroSpot } from '@/lib/spotter';
import { cn } from '@/lib/utils';

export interface TacticalSpotBadgeProps {
  spot: MicroSpot;
  className?: string;
}

/**
 * "🎯 Spot d'interception — 100m S-O · 1 concurrent évité" pill shown next
 * to the hero zone's standard distance/score once an Inverse Proximity
 * Spotter offset is available. Renders nothing when the spot has no actual
 * offset (quietest cell was the center one -- see computeMicroSpot), since
 * "0m, nowhere" isn't information worth a badge.
 */
export function TacticalSpotBadge({ spot, className }: TacticalSpotBadgeProps) {
  if (spot.offsetMeters === 0) return null;

  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full bg-amber-500/15 text-amber-400 text-[12px] font-bold px-2.5 py-1 truncate max-w-full',
        className
      )}
    >
      🎯 Spot d'interception — {Math.round(spot.offsetMeters)}m {bearingToCompassLabel(spot.bearingDeg)}
      {' · '}
      {spot.driverCountInQuadrant} concurrent{spot.driverCountInQuadrant === 1 ? '' : 's'} évité
      {spot.driverCountInQuadrant === 1 ? '' : 's'}
    </span>
  );
}
