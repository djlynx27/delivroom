import { supabase } from '@/integrations/supabase/client';
import { useQuery } from '@tanstack/react-query';

// ── Types ──────────────────────────────────────────────────────────────────────

export type Platform =
  | 'lyft'
  | 'doordash'
  | 'skipthedishes'
  | 'hypra'
  | 'imoove'
  | 'uber'
  | 'other';

export interface PlatformSignal {
  platform: Platform;
  avg_demand: number; // 0.0 – 10.0
  latest_surge: boolean;
  latest_multiplier: number | null;
  signal_count: number;
}

export interface PlatformRecommendation {
  best: PlatformSignal | null;
  all: PlatformSignal[];
  /** Arbitrage opportunity: demand gap between best and 2nd platform (0 = none) */
  arbitrageGap: number;
  /** True if the best platform has a significant advantage (gap ≥ 1.5) */
  strongRecommendation: boolean;
}

// ── Display helpers ────────────────────────────────────────────────────────────

export const PLATFORM_META: Record<
  Platform,
  { label: string; emoji: string; color: string }
> = {
  lyft: { label: 'Lyft', emoji: '🟣', color: 'text-purple-400' },
  doordash: { label: 'DoorDash', emoji: '🔴', color: 'text-red-400' },
  skipthedishes: {
    label: 'SkipTheDishes',
    emoji: '🟠',
    color: 'text-orange-400',
  },
  hypra: { label: 'Hypra Pro S', emoji: '🔵', color: 'text-blue-400' },
  imoove: { label: 'Imoove', emoji: '🟢', color: 'text-emerald-400' },
  uber: { label: 'Uber', emoji: '⚫', color: 'text-zinc-300' },
  other: { label: 'Autre', emoji: '⚪', color: 'text-muted-foreground' },
};

export function getPlatformMeta(platform: string) {
  return PLATFORM_META[platform as Platform] ?? PLATFORM_META.other;
}

// ── Hook ───────────────────────────────────────────────────────────────────────

/**
 * usePlatformSignals
 * Fetches and ranks platform signals for a single zone via `get_best_platform_for_zone`.
 * Refreshes every 5 minutes (data changes when signal-collector runs).
 *
 * @param zoneId  — Supabase zone id
 * @param lookbackMin — how many minutes back to look (default 30)
 */
export function usePlatformSignals(
  zoneId: string | null | undefined,
  lookbackMin = 30
): {
  data: PlatformRecommendation | null;
  isLoading: boolean;
  error: Error | null;
} {
  const {
    data: rawSignals = [],
    isLoading,
    error,
  } = useQuery<PlatformSignal[]>({
    queryKey: ['platform-signals', zoneId, lookbackMin],
    queryFn: async () => {
      if (!zoneId) return [];
      // Use type-safe REST call since generated types don't include this new RPC yet
      const { data, error } = await (
        supabase.rpc as unknown as (
          fn: string,
          args: Record<string, unknown>
        ) => Promise<{ data: unknown; error: unknown }>
      )('get_best_platform_for_zone', {
        p_zone_id: zoneId,
        p_lookback: `${lookbackMin} minutes`,
      });
      if (error) throw error;
      return (data ?? []) as PlatformSignal[];
    },
    enabled: !!zoneId,
    staleTime: 5 * 60 * 1000, // 5 min — matches signal-collector cron cadence
    gcTime: 10 * 60 * 1000,
    retry: 1,
  });

  if (!zoneId || rawSignals.length === 0) {
    return { data: null, isLoading, error: error as Error | null };
  }

  const sorted = [...rawSignals].sort((a, b) => b.avg_demand - a.avg_demand);
  const best = sorted[0] ?? null;
  const second = sorted[1] ?? null;
  const arbitrageGap = best && second ? best.avg_demand - second.avg_demand : 0;

  const recommendation: PlatformRecommendation = {
    best,
    all: sorted,
    arbitrageGap: Math.round(arbitrageGap * 10) / 10,
    strongRecommendation: arbitrageGap >= 1.5,
  };

  return { data: recommendation, isLoading, error: error as Error | null };
}

// ── Zustand-free inferred signals (client-side fallback) ──────────────────────
// When no DB signals exist (no screenshots taken yet), infer from zone score.
// Matches the inference logic in platform-signal-collector/index.ts.

const HOURLY_BIAS: Record<Platform, number[]> = {
  lyft: [
    1.3, 1.5, 1.8, 0.6, 0.3, 0.4, 0.7, 1.0, 1.2, 1.0, 0.9, 0.8, 0.8, 0.9, 1.0,
    1.1, 1.4, 1.5, 1.3, 1.2, 1.2, 1.4, 1.6, 1.4,
  ],
  doordash: [
    0.6, 0.5, 0.4, 0.2, 0.1, 0.2, 0.4, 0.7, 0.9, 0.8, 0.9, 1.1, 1.3, 1.2, 1.1,
    1.0, 1.0, 1.2, 1.5, 1.6, 1.4, 1.3, 1.2, 1.0,
  ],
  skipthedishes: [
    0.5, 0.4, 0.3, 0.2, 0.1, 0.2, 0.4, 0.6, 0.8, 0.8, 1.0, 1.2, 1.4, 1.3, 1.1,
    1.0, 1.0, 1.3, 1.6, 1.7, 1.5, 1.3, 1.1, 0.8,
  ],
  hypra: [
    1.0, 1.2, 1.5, 0.5, 0.2, 0.3, 0.5, 0.8, 1.0, 1.0, 1.0, 0.9, 0.9, 1.0, 1.1,
    1.2, 1.4, 1.5, 1.4, 1.3, 1.3, 1.5, 1.7, 1.3,
  ],
  // No measured Imoove data yet -- cloned from hypra (same traditional taxi
  // dispatch pattern), mirrors platform-signal-collector/index.ts's server
  // side fallback. Revisit once real signals accumulate.
  imoove: [
    1.0, 1.2, 1.5, 0.5, 0.2, 0.3, 0.5, 0.8, 1.0, 1.0, 1.0, 0.9, 0.9, 1.0, 1.1,
    1.2, 1.4, 1.5, 1.4, 1.3, 1.3, 1.5, 1.7, 1.3,
  ],
  uber: [
    1.1, 1.3, 1.5, 0.5, 0.2, 0.3, 0.6, 0.9, 1.1, 1.0, 1.0, 0.9, 0.9, 1.0, 1.0,
    1.1, 1.3, 1.4, 1.3, 1.2, 1.2, 1.3, 1.5, 1.3,
  ],
  other: [
    1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0,
    1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0,
  ],
};

const SURGE_THRESHOLD: Record<Platform, number> = {
  lyft: 7.75,
  doordash: 8.65,
  skipthedishes: 8.95,
  hypra: 8.18,
  imoove: 8.18,
  uber: 8.0,
  other: 9.0,
};

export function inferPlatformSignalsClientSide(
  zoneScore: number,
  nowHour: number
): PlatformSignal[] {
  const platforms: Platform[] = [
    'lyft',
    'doordash',
    'skipthedishes',
    'hypra',
    'imoove',
  ];
  return platforms
    .map((platform) => {
      const bias = (HOURLY_BIAS[platform] ?? [])[nowHour] ?? 1.0;
      const demand = Math.max(0, Math.min(10, (zoneScore / 100) * 10 * bias));
      const threshold = SURGE_THRESHOLD[platform] ?? 9.0;
      const surge_active = demand >= threshold;
      const surge_multiplier = surge_active
        ? Math.round((1.0 + (demand - threshold) * 0.25) * 100) / 100
        : null;
      return {
        platform,
        avg_demand: Math.round(demand * 10) / 10,
        latest_surge: surge_active,
        latest_multiplier: surge_multiplier,
        signal_count: 0, // inferred, no DB records
      };
    })
    .sort((a, b) => b.avg_demand - a.avg_demand);
}
