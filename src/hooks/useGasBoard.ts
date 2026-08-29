/**
 * Assemble l'onglet Essence : prix EQC + horaires d'ouverture + classement.
 *
 * Deux requêtes distinctes parce que leurs durées de vie diffèrent : les prix
 * bougent toutes les heures, les horaires quasiment jamais. On ne demande les
 * horaires que des stations réellement candidates à un slot (une quarantaine),
 * jamais des 2400 stations du Québec.
 */
import { supabase } from '@/integrations/supabase/client';
import { getOpenStatus, type OpenHours, type OpenStatus } from '@/lib/gasHours';
import {
  buildGasBoard,
  candidatesNeedingHours,
  toRankedStations,
  type FuelKind,
  type GasBoard,
  type GasStation,
  type RankedStation,
} from '@/lib/gasRanking';
import { useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';

interface GasPricesResponse {
  stations: GasStation[];
  updated_at: string;
  source: string;
}

interface GasHoursResponse {
  hours: Record<string, OpenHours | null>;
  resolved: number;
  cached: number;
  mapbox_configured: boolean;
}

const PRICES_STALE_MS = 15 * 60 * 1000;
const HOURS_STALE_MS = 6 * 60 * 60 * 1000;
/** Les statuts sont recalculés à chaque rendu, mais l'horloge n'avance que par palier. */
const CLOCK_TICK_MS = 60 * 1000;

export interface UseGasBoardResult {
  board: GasBoard | null;
  updatedAt: string | null;
  isLoading: boolean;
  isFetching: boolean;
  error: Error | null;
  hoursUnavailable: boolean;
  refetch: () => Promise<void>;
}

export function useGasBoard(
  fuel: FuelKind,
  location: { latitude: number; longitude: number } | null,
  now: Date
): UseGasBoardResult {
  const prices = useQuery<GasPricesResponse>({
    queryKey: ['gas-prices'],
    queryFn: async () => {
      const { data, error } = await supabase.functions.invoke<GasPricesResponse>(
        'gas-prices',
        { method: 'GET' }
      );
      if (error) throw error;
      if (!data) throw new Error('Réponse vide de gas-prices');
      return data;
    },
    staleTime: PRICES_STALE_MS,
    // A shift can keep this tab open for hours — staleTime alone only marks
    // the query stale for the *next* mount/refetch, it never refetches in
    // the background on its own. Without this, prices silently go stale for
    // the entire shift instead of the intended 15 min ceiling.
    refetchInterval: PRICES_STALE_MS,
    refetchOnWindowFocus: false,
  });

  const ranked = useMemo<RankedStation[]>(() => {
    if (!prices.data || !location) return [];
    return toRankedStations(
      prices.data.stations,
      location.latitude,
      location.longitude,
      fuel
    );
  }, [prices.data, location, fuel]);

  const candidates = useMemo<RankedStation[]>(() => {
    if (ranked.length === 0 || !location) return [];
    return candidatesNeedingHours(ranked, location.latitude, location.longitude);
  }, [ranked, location]);

  // La clé ne dépend que des stations demandées : changer de carburant ou
  // bouger de quelques mètres ne relance pas la résolution d'horaires.
  const candidateKeys = useMemo(
    () => candidates.map((c) => c.key).sort(),
    [candidates]
  );

  const hours = useQuery<GasHoursResponse>({
    queryKey: ['gas-hours', candidateKeys],
    enabled: candidates.length > 0,
    queryFn: async () => {
      const { data, error } = await supabase.functions.invoke<GasHoursResponse>(
        'gas-hours',
        {
          body: {
            stations: candidates.map((c) => ({
              lat: c.lat,
              lng: c.lng,
              address: c.address,
              brand: c.brand,
              city: c.city,
            })),
          },
        }
      );
      if (error) throw error;
      if (!data) throw new Error('Réponse vide de gas-hours');
      return data;
    },
    staleTime: HOURS_STALE_MS,
    refetchOnWindowFocus: false,
  });

  // On fige l'horloge à la minute pour éviter de reconstruire le classement
  // à chaque rendu — le statut d'ouverture n'a pas besoin d'être à la seconde.
  const clock = Math.floor(now.getTime() / CLOCK_TICK_MS);

  const board = useMemo<GasBoard | null>(() => {
    if (ranked.length === 0 || !location) return null;
    const table = hours.data?.hours ?? {};
    const cache = new Map<string, OpenStatus>();
    const evaluatedAt = new Date(clock * CLOCK_TICK_MS);

    const statusOf = (station: RankedStation): OpenStatus => {
      const hit = cache.get(station.key);
      if (hit) return hit;
      const status = getOpenStatus(table[station.key], evaluatedAt);
      cache.set(station.key, status);
      return status;
    };

    return buildGasBoard({
      stations: ranked,
      userLat: location.latitude,
      userLng: location.longitude,
      statusOf,
    });
    // `clock` pilote volontairement le recalcul horaire.
  }, [ranked, location, hours.data, clock]);

  const refetch = async () => {
    await Promise.all([prices.refetch(), hours.refetch()]);
  };

  return {
    board,
    updatedAt: prices.data?.updated_at ?? null,
    isLoading: prices.isLoading,
    isFetching: prices.isFetching || hours.isFetching,
    error: (prices.error as Error | null) ?? null,
    hoursUnavailable: Boolean(hours.error) || hours.data?.mapbox_configured === false,
    refetch,
  };
}
