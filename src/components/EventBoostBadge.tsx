import { cn } from '@/lib/utils';

export interface EventBoostBadgeProps {
  name: string;
  /** Event end time (ISO) — shown as the expected "sortie" (attendees leaving). */
  endAt: string;
  className?: string;
}

/**
 * "⚡ [Event] — Sortie prévue ~HH:mm" pill shown on a zone boosted by a
 * nearby event (see zoneEventBadge in useDemandScores.ts). Time is always
 * formatted in Montreal local time regardless of device timezone, same
 * reasoning as getMontrealDayStart.
 */
export function EventBoostBadge({ name, endAt, className }: EventBoostBadgeProps) {
  const time = new Date(endAt).toLocaleTimeString('fr-CA', {
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'America/Toronto',
  });

  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full bg-amber-500/15 text-amber-400 text-[12px] font-bold px-2.5 py-1 truncate max-w-full',
        className
      )}
    >
      ⚡ {name} — Sortie prévue ~{time}
    </span>
  );
}
