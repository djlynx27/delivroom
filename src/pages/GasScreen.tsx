import { useUserLocation } from '@/hooks/useUserLocation';
import { useGasBoard } from '@/hooks/useGasBoard';
import { useI18n } from '@/contexts/I18nContext';
import {
  CLOSING_SOON_MINUTES,
  describeOpenStatus,
  type OpenStatus,
} from '@/lib/gasHours';
import { NEARBY_RADIUS_KM, type FuelKind, type GasSlot, type RankedStation } from '@/lib/gasRanking';
import { Clock, Fuel, HelpCircle, MapPin, Navigation, RefreshCw } from 'lucide-react';
import { useEffect, useState } from 'react';

function buildDirectionsUrl(lat: number, lng: number): string {
  return `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}&travelmode=driving`;
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
  return new Intl.DateTimeFormat(locale, {
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(iso));
}

function OpenBadge({ status }: { status: OpenStatus }) {
  const label = describeOpenStatus(status);

  if (status.state === 'unknown') {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
        <HelpCircle className="w-3 h-3" />
        {label}
      </span>
    );
  }

  const closingSoon =
    status.minutesUntilClose !== null &&
    status.minutesUntilClose <= CLOSING_SOON_MINUTES;

  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium ${
        closingSoon
          ? 'bg-amber-500/15 text-amber-600 dark:text-amber-400'
          : 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400'
      }`}
    >
      <Clock className="w-3 h-3" />
      {label}
    </span>
  );
}

function StationCard({
  station,
  status,
  locale,
  highlight,
  eyebrow,
}: {
  station: RankedStation;
  status: OpenStatus;
  locale: string;
  highlight?: boolean;
  eyebrow?: string;
}) {
  return (
    <a
      href={buildDirectionsUrl(station.lat, station.lng)}
      target="_blank"
      rel="noopener noreferrer"
      className={`block rounded-xl border p-4 transition active:scale-[0.99] ${
        highlight
          ? 'border-primary bg-primary/5 shadow-sm'
          : 'border-border bg-card hover:bg-accent/40'
      }`}
    >
      {eyebrow && (
        <p className="mb-1.5 text-[10px] uppercase tracking-wide font-bold text-primary">
          {eyebrow}
        </p>
      )}
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <span className="text-sm font-semibold text-foreground truncate block">
            {station.brand}
          </span>
          <p className="text-xs text-muted-foreground truncate">{station.address}</p>
          <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            <span className="inline-flex items-center gap-1">
              <MapPin className="w-3 h-3" />
              {station.distance_km.toFixed(1)} km
            </span>
            <OpenBadge status={status} />
          </div>
        </div>
        <div className="text-right shrink-0">
          <div
            className={`font-display font-bold tabular-nums ${
              highlight ? 'text-2xl text-primary' : 'text-lg text-foreground'
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

function slotEyebrow(slot: GasSlot): string {
  switch (slot.kind) {
    case 'nearest-cheapest':
      return slot.alsoCheapestInCity
        ? `★ La moins chère de ${slot.city} — et la plus proche`
        : `★ Meilleur compromis prix / distance à ${slot.city}`;
    case 'city-cheapest':
      return `La moins chère dans tout ${slot.city}`;
    case 'other-city-cheapest':
      return `La moins chère dans tout ${slot.city}`;
  }
}

export default function GasScreen() {
  const { locale } = useI18n();
  const [fuel, setFuel] = useState<FuelKind>('regular');
  const [now, setNow] = useState(() => new Date());
  const { location, status: locStatus, error: locError, refresh } = useUserLocation(60_000);

  // Une station qui ferme pendant que l'écran est ouvert doit disparaître des slots.
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(id);
  }, []);

  const { board, updatedAt, isLoading, isFetching, error, hoursUnavailable, refetch } =
    useGasBoard(fuel, location, now);

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
            className={`rounded-lg border py-3 min-h-11 text-sm font-medium transition ${
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
          {locError ?? 'Position GPS indisponible'} — autorise la géolocalisation pour voir
          les stations proches.
        </p>
      )}
      {error && (
        <p className="text-sm text-destructive mb-3">
          Impossible de charger les prix EQC. {error.message}
        </p>
      )}
      {hoursUnavailable && (
        <p className="text-sm text-amber-600 dark:text-amber-400 mb-3">
          Horaires indisponibles pour l&apos;instant — les stations sont affichées sans
          filtre d&apos;ouverture. Vérifie avant de te déplacer.
        </p>
      )}
      {isLoading && <p className="text-sm text-muted-foreground">Chargement des prix…</p>}

      {board && board.slots.length > 0 && (
        <section className="space-y-3">
          {board.slots.map((slot, index) => (
            <StationCard
              key={slot.station.key}
              station={slot.station}
              status={slot.status}
              locale={locale}
              highlight={index === 0}
              eyebrow={slotEyebrow(slot)}
            />
          ))}
        </section>
      )}

      {board && board.nearbyRest.length > 0 && (
        <section className="mt-6">
          <h2 className="text-xs uppercase tracking-wide font-semibold text-muted-foreground mb-2">
            Autres stations ouvertes {board.userCity ? `à ${board.userCity}` : ''} (≤{' '}
            {NEARBY_RADIUS_KM} km)
          </h2>
          <div className="space-y-2">
            {board.nearbyRest.map(({ station, status }) => (
              <StationCard
                key={station.key}
                station={station}
                status={status}
                locale={locale}
              />
            ))}
          </div>
        </section>
      )}

      {board && board.slots.length === 0 && !isLoading && (
        <p className="text-sm text-muted-foreground">
          Aucune station ouverte avec ce carburant autour de toi en ce moment.
        </p>
      )}

      <p className="mt-6 text-[11px] text-muted-foreground text-center">
        Seules les stations encore ouvertes sont proposées en tête de liste.
        {board?.hasUnknownHours &&
          ' Certaines n’ont pas d’horaire publié — elles portent le badge « horaire inconnu ».'}
      </p>

      {updatedAt && (
        <p className="mt-2 text-[11px] text-muted-foreground text-center">
          Prix : Régie de l&apos;énergie via essencequebec.com — mis à jour à{' '}
          {formatUpdated(updatedAt, locale)} · Horaires : Mapbox
        </p>
      )}
    </div>
  );
}
