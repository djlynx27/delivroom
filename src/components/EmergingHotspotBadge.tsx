import { cn } from '@/lib/utils';

export interface EmergingHotspotBadgeProps {
  distanceKm: number;
  occurrenceCount: number;
  className?: string;
}

/**
 * "🆕 Hotspot émergent — 2.3 km · vu 3×" pill for a GPS position outside the
 * known zone catalog where ingest-lyft-screenshots repeatedly saw high Lyft
 * demand (see EMERGING_HOTSPOT_* in supabase/functions/ingest-lyft-screenshots).
 */
export function EmergingHotspotBadge({
  distanceKm,
  occurrenceCount,
  className,
}: EmergingHotspotBadgeProps) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full bg-primary/15 text-primary text-[12px] font-bold px-2.5 py-1 truncate max-w-full',
        className
      )}
    >
      🆕 Hotspot émergent — {distanceKm.toFixed(1)} km · vu {occurrenceCount}×
    </span>
  );
}
