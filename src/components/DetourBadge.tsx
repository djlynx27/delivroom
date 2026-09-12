import type { DetourBadgeInfo } from '@/lib/gasRanking';
import { TrendingDown, TrendingUp } from 'lucide-react';

export interface DetourBadgeProps {
  badge: DetourBadgeInfo;
}

/** Green/red pill on a gas station card: whether the price gap there is
 * worth the round-trip fuel cost vs. the driver's default pick (see
 * computeDetourBadge / calculateGasDetourProfitability in gasRanking.ts). */
export function DetourBadge({ badge }: DetourBadgeProps) {
  const Icon = badge.isProfitable ? TrendingUp : TrendingDown;
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium ${
        badge.isProfitable
          ? 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400'
          : 'bg-destructive/15 text-destructive'
      }`}
    >
      <Icon className="w-3 h-3" />
      {badge.label}
    </span>
  );
}
