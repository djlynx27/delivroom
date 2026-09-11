import { useOnlineStatus } from '@/hooks/useOnlineStatus';
import { cn } from '@/lib/utils';

export interface OfflineBadgeProps {
  className?: string;
}

/**
 * Persistent pill shown whenever the device is offline, so a stale scoring
 * screen never reads as "live" — see useZoneScores' Realtime channel, which
 * goes silent with no visual cue if the connection drops mid-shift.
 */
export function OfflineBadge({ className }: OfflineBadgeProps) {
  const isOnline = useOnlineStatus();
  if (isOnline) return null;

  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full bg-alert-amber/15 text-alert-amber text-[12px] font-bold px-2.5 py-1',
        className
      )}
    >
      📡 Hors ligne — données en cache
    </span>
  );
}
