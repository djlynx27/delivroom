// Emerging hotspots: GPS positions where ingest-lyft-screenshots saw high
// Lyft demand but the driver was too far from every known zone to attach a
// zone_id — logged into zone_discoveries (context='other') instead of a new
// table, reusing the same occurrence_count/promotion workflow the "Zones
// découvertes" admin screen already has for pickup/dropoff addresses.

import { supabase } from '@/integrations/supabase/client';
import { haversineKm } from '@/hooks/useUserLocation';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';

export interface EmergingHotspot {
  id: string;
  address: string;
  latitude: number;
  longitude: number;
  occurrenceCount: number;
  lastSeenAt: string;
  notes: string | null;
}

/** Live (Realtime-backed) list of pending emerging hotspots, most-seen first. */
export function useEmergingHotspots(limit = 10) {
  const queryClient = useQueryClient();

  useEffect(() => {
    const channel = supabase
      .channel('emerging-hotspots')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'zone_discoveries' },
        () => {
          queryClient.invalidateQueries({ queryKey: ['emerging-hotspots'] });
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [queryClient]);

  return useQuery<EmergingHotspot[]>({
    queryKey: ['emerging-hotspots', limit],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('zone_discoveries')
        .select('id, address, latitude, longitude, count, last_seen_at, notes')
        .eq('context', 'other')
        .eq('status', 'pending')
        .not('latitude', 'is', null)
        .not('longitude', 'is', null)
        .order('count', { ascending: false })
        .order('last_seen_at', { ascending: false })
        .limit(limit);
      if (error) throw error;

      return (data ?? [])
        .filter((row) => row.latitude !== null && row.longitude !== null)
        .map((row) => ({
          id: row.id,
          address: row.address,
          latitude: row.latitude as number,
          longitude: row.longitude as number,
          occurrenceCount: row.count,
          lastSeenAt: row.last_seen_at,
          notes: row.notes,
        }));
    },
    staleTime: 60 * 1000,
    refetchInterval: 5 * 60 * 1000,
  });
}

/** Closest hotspot to a given position, or null if none is within `maxDistanceKm`. */
export function nearestEmergingHotspot(
  lat: number,
  lng: number,
  hotspots: EmergingHotspot[],
  maxDistanceKm = 10
): (EmergingHotspot & { distanceKm: number }) | null {
  let best: (EmergingHotspot & { distanceKm: number }) | null = null;
  for (const hotspot of hotspots) {
    const distanceKm = haversineKm(lat, lng, hotspot.latitude, hotspot.longitude);
    if (distanceKm <= maxDistanceKm && (!best || distanceKm < best.distanceKm)) {
      best = { ...hotspot, distanceKm };
    }
  }
  return best;
}
