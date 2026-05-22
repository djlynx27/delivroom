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
export function useZoneScores(cityId: string) {
  const queryClient = useQueryClient();

  // Realtime: invalidate cache whenever scores table changes.
  // This gives live map updates when the cron / Edge Function recalculates.
  useEffect(() => {
    if (!cityId) return;

    const channel = supabase
      .channel(`scores-${cityId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'scores' },
        () => {
          queryClient.invalidateQueries({ queryKey: ['zone-scores', cityId] });
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [cityId, queryClient]);

  return useQuery<ZoneScore[]>({
    queryKey: ['zone-scores', cityId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('scores')
        .select('*, zones!inner(city_id)')
        .eq('zones.city_id', cityId)
        .order('calculated_at', { ascending: false });

      if (error) throw error;

      // Deduplicate after fetching the full city slice; limiting rows here can
      // hide some zones if a few zones have many recent historical scores.
      const latest = new Map<string, ZoneScore>();
      for (const row of data ?? []) {
        if (!latest.has(row.zone_id)) {
          latest.set(row.zone_id, row as unknown as ZoneScore);
        }
      }
      return Array.from(latest.values());
    },
    // 30 s — Realtime usually beats us to the punch, but this catches the
    // case where the channel temporarily drops (e.g. WebView paused) and
    // ensures the "best zone right now" never goes stale by more than the
    // cron cadence (10 min) + this poll.
    staleTime: 30 * 1000,
    refetchInterval: 5 * 60 * 1000,
  });
}
