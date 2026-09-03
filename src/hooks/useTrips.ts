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
// includeSynthetic pulls in the seedSyntheticTrips.ts data-bootstrap prior
// (see learningEngine.ts) -- only the learning-insights views want it mixed
// in; every revenue/history display must stay real-only.
export function useTrips({
  limit = 500,
  cityId,
  enabled = true,
  includeSynthetic = false,
}: {
  limit?: number;
  cityId?: string;
  enabled?: boolean;
  includeSynthetic?: boolean;
} = {}) {
  return useQuery<TripWithZone[]>({
    queryKey: cityId
      ? ['trips-feed', limit, cityId, includeSynthetic]
      : ['trips-feed', limit, includeSynthetic],
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
      if (!includeSynthetic) {
        query = query.eq('source', 'real');
      }
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
      // trips_user_isolation (RLS) requires auth.uid() = user_id on INSERT --
      // without this the WITH CHECK silently rejects every save.
      const { data: userData, error: userError } =
        await supabase.auth.getUser();
      if (userError || !userData.user) {
        throw new Error(
          'Session introuvable — reconnecte-toi avant d’enregistrer la course.'
        );
      }

      const { data, error } = await supabase
        .from('trips')
        .insert({ ...trip, user_id: userData.user.id })
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
