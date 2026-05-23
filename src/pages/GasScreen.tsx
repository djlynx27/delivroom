import { useUserLocation, haversineKm } from '@/hooks/useUserLocation';
import { useI18n } from '@/contexts/I18nContext';
import { supabase } from '@/integrations/supabase/client';
import { useQuery } from '@tanstack/react-query';
import { Fuel, MapPin, Navigation, RefreshCw } from 'lucide-react';
import { useMemo, useState } from 'react';

type FuelKind = 'regular' | 'super' | 'diesel';

interface GasStation {
  name: string;
  brand: string;
  address: string;
  lat: number;
  lng: number;
  regular: number | null;
  super: number | null;
  diesel: number | null;
}

interface GasPricesResponse {
  stations: GasStation[];
  updated_at: string;
  source: string;
}

interface RankedStation extends GasStation {
  price: number;
  distance_km: number;
  /** weighted score — lower is better. Combines price ($/L) + driving cost
   * estimated at ~$0.18/L extra fuel burn per km of detour. */
  cost_score: number;
}

const DETOUR_FUEL_COST_PER_KM = 0.18;
const SEARCH_RADIUS_KM = 15;

function buildDirectionsUrl(lat: number, lng: number): string {
  return `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}&travelmode=driving`;
}

function rankStations(
  stations: GasStation[],
  lat: number,
  lng: number,
  fuel: FuelKind
): RankedStation[] {
  return stations
    .map<RankedStation | null>((s) => {
      const price = s[fuel];
      if (price == null) return null;
      const distance_km = haversineKm(lat, lng, s.lat, s.lng);
      if (distance_km > SEARCH_RADIUS_KM) return null;
      return {
        ...s,
        price,
        distance_km,
        cost_score: price + distance_km * DETOUR_FUEL_COST_PER_KM,
      };
    })
    .filter((s): s is RankedStation => s !== null)
    .sort((a, b) => a.cost_score - b.cost_score);
}

function formatPrice(p: number, locale: string): string {
  return new Intl.NumberFormat(locale, {
    style: 'currency',
    currency: 'CAD',
    minimumFractionDigits: 3,
    maximumFractionDigits: 3,
  }).format(p);
}

function formatUpdated(iso: string, locale: string): string {
  const d = new Date(iso);
  return new Intl.DateTimeFormat(locale, {
    hour: '2-digit',
    minute: '2-digit',
  }).format(d);
}

function StationCard({
  station,
  best,
  locale,
}: {
  station: RankedStation;
  best: boolean;
  locale: string;
}) {
  const href = buildDirectionsUrl(station.lat, station.lng);
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className={`block rounded-xl border p-4 transition active:scale-[0.99] ${
        best
          ? 'border-primary bg-primary/5 shadow-sm'
          : 'border-border bg-card hover:bg-accent/40'
      }`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="text-sm font-semibold text-foreground truncate">
              {station.brand}
            </span>
            {best && (
              <span className="text-[10px] uppercase tracking-wide font-bold text-primary">
                ★ Meilleur
              </span>
            )}
          </div>
          <p className="text-xs text-muted-foreground truncate">
            {station.address}
          </p>
          <div className="mt-2 flex items-center gap-3 text-xs text-muted-foreground">
            <span className="inline-flex items-center gap-1">
              <MapPin className="w-3 h-3" />
              {station.distance_km.toFixed(1)} km
            </span>
          </div>
        </div>
        <div className="text-right shrink-0">
          <div
            className={`font-display font-bold tabular-nums ${
              best ? 'text-2xl text-primary' : 'text-lg text-foreground'
            }`}
          >
            {formatPrice(station.price, locale)}
          </div>
          <div className="mt-1 inline-flex items-center gap-1 text-[11px] font-medium text-primary">
            <Navigation className="w-3 h-3" />
            Maps
          </div>
        </div>
      </div>
    </a>
  );
}

export default function GasScreen() {
  const { locale } = useI18n();
  const [fuel, setFuel] = useState<FuelKind>('regular');
  const { location, status: locStatus, error: locError, refresh } =
    useUserLocation(60_000);

  const {
    data,
    isLoading: pricesLoading,
    isFetching,
    error: pricesError,
    refetch,
  } = useQuery<GasPricesResponse>({
    queryKey: ['gas-prices'],
    queryFn: async () => {
      const { data, error } = await supabase.functions.invoke<GasPricesResponse>(
        'gas-prices',
        { method: 'GET' }
      );
      if (error) throw error;
      if (!data) throw new Error('Empty response');
      return data;
    },
    staleTime: 15 * 60 * 1000, // 15 min
    refetchOnWindowFocus: false,
  });

  const ranked = useMemo<RankedStation[]>(() => {
    if (!data || !location) return [];
    return rankStations(data.stations, location.latitude, location.longitude, fuel);
  }, [data, location, fuel]);

  const top = ranked.slice(0, 10);
  const best = top[0];

  const onRefresh = async () => {
    await Promise.all([refresh(), refetch()]);
  };

  return (
    <div className="min-h-screen pb-24 max-w-screen-sm mx-auto px-4 pt-4">
      <header className="flex items-center justify-between mb-4">
        <h1 className="text-2xl font-display font-bold inline-flex items-center gap-2">
          <Fuel className="w-6 h-6 text-primary" />
          Essence
        </h1>
        <button
          type="button"
          onClick={() => void onRefresh()}
          className="inline-flex items-center gap-1.5 rounded-md border border-border bg-card px-3 py-1.5 text-xs font-medium text-foreground hover:bg-accent/50 active:scale-95"
          disabled={isFetching}
        >
          <RefreshCw className={`w-3.5 h-3.5 ${isFetching ? 'animate-spin' : ''}`} />
          Actualiser
        </button>
      </header>

      <div className="grid grid-cols-3 gap-2 mb-4" role="tablist">
        {(
          [
            { id: 'regular', label: 'Régulier' },
            { id: 'super', label: 'Super' },
            { id: 'diesel', label: 'Diesel' },
          ] as const
        ).map((f) => (
          <button
            key={f.id}
            type="button"
            role="tab"
            aria-selected={fuel === f.id}
            onClick={() => setFuel(f.id)}
            className={`rounded-lg border py-2 text-sm font-medium transition ${
              fuel === f.id
                ? 'border-primary bg-primary text-primary-foreground'
                : 'border-border bg-card text-muted-foreground hover:text-foreground'
            }`}
          >
            {f.label}
          </button>
        ))}
      </div>

      {locStatus === 'loading' && !location && (
        <p className="text-sm text-muted-foreground mb-3">Localisation en cours…</p>
      )}
      {locStatus === 'error' && (
        <p className="text-sm text-destructive mb-3">
          {locError ?? 'Position GPS indisponible'} — autorise la géolocalisation pour voir les stations proches.
        </p>
      )}
      {pricesError && (
        <p className="text-sm text-destructive mb-3">
          Impossible de charger les prix EQC.{' '}
          {pricesError instanceof Error ? pricesError.message : ''}
        </p>
      )}

      {pricesLoading && (
        <p className="text-sm text-muted-foreground">Chargement des prix…</p>
      )}

      {best && (
        <section className="mb-4">
          <h2 className="text-xs uppercase tracking-wide font-semibold text-muted-foreground mb-2">
            La moins chère près de toi
          </h2>
          <StationCard station={best} best locale={locale} />
          <p className="mt-2 text-[11px] text-muted-foreground">
            Touche la carte pour ouvrir l&apos;itinéraire dans Google Maps.
          </p>
        </section>
      )}

      {top.length > 1 && (
        <section>
          <h2 className="text-xs uppercase tracking-wide font-semibold text-muted-foreground mb-2">
            Autres options (≤ {SEARCH_RADIUS_KM} km)
          </h2>
          <div className="space-y-2">
            {top.slice(1).map((s) => (
              <StationCard
                key={`${s.lat},${s.lng}`}
                station={s}
                best={false}
                locale={locale}
              />
            ))}
          </div>
        </section>
      )}

      {!pricesLoading && data && location && ranked.length === 0 && (
        <p className="text-sm text-muted-foreground">
          Aucune station avec ce type de carburant dans un rayon de {SEARCH_RADIUS_KM} km.
        </p>
      )}

      {data && (
        <p className="mt-6 text-[11px] text-muted-foreground text-center">
          Données : Régie de l&apos;énergie via essencequebec.com — mis à jour à{' '}
          {formatUpdated(data.updated_at, locale)}
        </p>
      )}
    </div>
  );
}
