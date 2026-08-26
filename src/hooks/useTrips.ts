import {
  type FeedbackContext,
  usePostTripFeedback,
} from '@/hooks/usePostTripFeedback';
import { supabase } from '@/integrations/supabase/client';
import type { Database } from '@/integrations/supabase/types';
import {
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import { toast } from 'sonner';

type TripRow = Database['public']['Tables']['trips']['Row'];

export type TripWithZone = TripRow & {
  platform?: string | null;
  zone_score?: number | null;
  zones?: {
    name?: string | null;
    type?: string | null;
    current_score?: number | null;
  } | null;
};

// cityId filters to trips whose zone belongs to that city (used by the
// demand-scoring ML feedback loop); omit it for the unfiltered global feed.
// enabled lets a city-scoped caller skip fetching until cityId is known.
export function useTrips(limit = 500, cityId?: string, enabled = true) {
  return useQuery<TripWithZone[]>({
    queryKey: cityId ? ['trips-feed', limit, cityId] : ['trips-feed', limit],
    enabled,
    queryFn: async () => {
      let query = supabase
        .from('trips')
        .select(
          cityId
            ? '*, zones!inner(name, type, current_score, city_id)'
            : '*, zones(name, type, current_score)'
        )
        .order('started_at', { ascending: false })
        .limit(limit);
      if (cityId) {
        query = query.eq('zones.city_id', cityId);
      }
      const { data, error } = await query;
      if (error) throw error;
      return (data ?? []) as TripWithZone[];
    },
    staleTime: 5 * 60 * 1000,
  });
}

export function useAddTrip() {
  const qc = useQueryClient();
  const { submitFeedback } = usePostTripFeedback();

  return useMutation({
    mutationFn: async ({
      trip,
      feedback,
    }: {
      trip: {
        zone_id: string;
        started_at: string;
        ended_at: string;
        earnings: number;
        tips: number;
        distance_km: number;
        notes: string;
        platform: string | null;
        experiment?: boolean;
        zone_score?: number | null;
      };
      feedback: FeedbackContext;
    }) => {
      const { data, error } = await supabase
        .from('trips')
        .insert(trip)
        .select('*, zones(name, type, current_score)')
        .single();
      if (error) throw error;

      const insertedTrip = data as TripWithZone;
      await submitFeedback(insertedTrip, feedback);
      return insertedTrip.zone_id;
    },
    onSuccess: async (zoneId) => {
      qc.invalidateQueries({ queryKey: ['trips-feed'] });
      toast.success('Course enregistrée');

      // Trigger partial AI rescore for this zone only
      try {
        const { error } = await supabase.functions.invoke('ai-score-analysis', {
          body: { zone_id: zoneId },
        });
        if (!error) {
          qc.invalidateQueries({ queryKey: ['zone-scores'] });
          toast.info('Score de zone mis à jour via IA');
        }
      } catch {
        // Non-blocking: don't fail if AI rescore fails
      }
    },
  });
}
