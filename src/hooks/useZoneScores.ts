import { supabase } from '@/integrations/supabase/client';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';

export interface ZoneScore {
  id: string;
  zone_id: string;
  score: number | null;
  weather_boost: number | null;
  event_boost: number | null;
  final_score: number | null;
  calculated_at: string;
}

/**
 * Fetch the latest calculated scores for all zones in a city.
 * Subscribes to Realtime so the map updates live when the Edge Function
 * pushes new scores (no manual refresh needed).
 */
export function useZoneScores(cityIds: string | string[]) {
  const ids = Array.isArray(cityIds) ? cityIds : [cityIds];
  const queryClient = useQueryClient();

  // Realtime: invalidate cache whenever scores table changes.
  // This gives live map updates when the cron / Edge Function recalculates.
  useEffect(() => {
    if (ids.length === 0) return;

    const channel = supabase
      .channel(`scores-${ids.join('-')}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'scores' },
        () => {
          queryClient.invalidateQueries({ queryKey: ['zone-scores', ...ids] });
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ids.join('-'), queryClient]);

  return useQuery<ZoneScore[]>({
    queryKey: ['zone-scores', ...ids],
    queryFn: async () => {
      // Server-side dedup via get_latest_scores (DISTINCT ON, uses
      // idx_scores_zone_time) instead of pulling the full history table.
      // RPC is single-city; fan out across the nearby-city set and merge.
      const results = await Promise.all(
        ids.map((id) => supabase.rpc('get_latest_scores', { p_city_id: id }))
      );
      const error = results.find((r) => r.error)?.error;
      if (error) throw error;
      return results.flatMap((r) => (r.data ?? [])) as ZoneScore[];
    },
    // 30 s — Realtime usually beats us to the punch, but this catches the
    // case where the channel temporarily drops (e.g. WebView paused) and
    // ensures the "best zone right now" never goes stale by more than the
    // cron cadence (10 min) + this poll.
    staleTime: 30 * 1000,
    refetchInterval: 5 * 60 * 1000,
  });
}
