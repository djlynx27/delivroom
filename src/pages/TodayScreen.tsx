import { useTrips, type TripWithZone } from '@/hooks/useTrips';
import { getTripRevenue, summarizeTrips } from '@/lib/tripAnalytics';
import { getMontrealDayStart } from '@/lib/timezone';
import { RefreshCw } from 'lucide-react';
import { useMemo } from 'react';

export function formatMoney(amount: number): string {
  return `${Math.round(amount ?? 0)} $`;
}

export function formatHoursMinutes(hours: number): string {
  const totalMinutes = Math.max(0, Math.round((hours ?? 0) * 60));
  const h = Math.floor(totalMinutes / 60);
  const m = totalMinutes % 60;
  return `${h}h${String(m).padStart(2, '0')}`;
}

export function toValidDate(value: string | null | undefined): Date | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function KpiTile({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex-1 bg-card rounded-xl border border-border px-3 py-4 text-center min-w-0">
      <p className="text-[22px] font-display font-bold text-foreground truncate">{value}</p>
      <p className="text-[11px] text-muted-foreground font-body uppercase tracking-wide mt-1">
        {label}
      </p>
    </div>
  );
}

function TripRow({ trip }: { trip: TripWithZone }) {
  const zoneName = trip.zones?.name ?? 'Zone inconnue';
  const startedAt = toValidDate(trip.started_at);
  const time = startedAt
    ? startedAt.toLocaleTimeString('fr-CA', { hour: '2-digit', minute: '2-digit' })
    : '--:--';

  return (
    <div className="flex items-center justify-between bg-card rounded-lg border border-border px-3 py-2.5 gap-3">
      <div className="min-w-0 flex-1">
        <p className="text-[14px] font-display font-semibold truncate">{zoneName}</p>
        <p className="text-[12px] text-muted-foreground font-body">{time}</p>
      </div>
      <p className="text-[14px] font-display font-bold text-green-400 flex-shrink-0">
        {formatMoney(getTripRevenue(trip))}
      </p>
    </div>
  );
}

function EmptyState() {
  return (
    <div className="flex flex-col items-center justify-center py-16 text-center px-6">
      <p className="text-[16px] font-display font-semibold text-muted-foreground">
        Aucune course aujourd'hui
      </p>
      <p className="text-[13px] text-muted-foreground font-body mt-1">
        Tes courses enregistrées apparaîtront ici.
      </p>
    </div>
  );
}

function TripsSection({
  isLoading,
  isError,
  trips,
}: {
  isLoading: boolean;
  isError: boolean;
  trips: TripWithZone[];
}) {
  if (isLoading) {
    return (
      <p className="text-center text-muted-foreground text-[13px] py-8">Chargement…</p>
    );
  }
  if (isError) {
    return (
      <p className="text-center text-muted-foreground text-[13px] py-8 px-4">
        Connexion indisponible — synchronise pour réessayer.
      </p>
    );
  }
  if (trips.length === 0) {
    return <EmptyState />;
  }
  return (
    <>
      {trips.map((trip) => (
        <TripRow key={trip.id} trip={trip} />
      ))}
    </>
  );
}

/**
 * Aujourd'hui — minimal, single-source-of-truth day view. Reads only
 * useTrips(); every metric goes through `?? 0`/`toValidDate` guards so bad
 * or missing data renders "0"/"--:--" instead of crashing the tab.
 */
export default function TodayScreen() {
  const { data: trips, isLoading, isError, refetch, isRefetching } = useTrips({ limit: 200 });

  const todayTrips = useMemo(() => {
    const todayStart = getMontrealDayStart();
    return (trips ?? [])
      .filter((trip) => {
        const startedAt = toValidDate(trip.started_at);
        return !!startedAt && startedAt >= todayStart;
      })
      .sort((a, b) => {
        const aTime = toValidDate(a.started_at)?.getTime() ?? 0;
        const bTime = toValidDate(b.started_at)?.getTime() ?? 0;
        return bTime - aTime;
      });
  }, [trips]);

  const summary = useMemo(
    () => summarizeTrips(todayTrips, getMontrealDayStart()),
    [todayTrips]
  );

  return (
    <div className="flex flex-col h-full pb-36">
      <div className="px-4 pt-4 pb-2">
        <h1 className="text-[20px] font-display font-bold">Aujourd'hui</h1>
      </div>

      <div className="px-4 flex gap-2">
        <KpiTile label="Gains" value={formatMoney(summary.revenue ?? 0)} />
        <KpiTile label="Courses" value={String(summary.rides ?? 0)} />
        <KpiTile label="Temps en route" value={formatHoursMinutes(summary.hours ?? 0)} />
      </div>

      <div className="px-4 mt-4 flex-1 space-y-2 overflow-y-auto">
        <TripsSection isLoading={isLoading} isError={isError} trips={todayTrips} />
      </div>

      <div className="px-4 pb-4 pt-2">
        <button
          onClick={() => void refetch()}
          disabled={isRefetching}
          className="w-full h-12 rounded-xl bg-primary text-primary-foreground font-display font-bold flex items-center justify-center gap-2 disabled:opacity-60"
        >
          <RefreshCw className={`w-4 h-4 ${isRefetching ? 'animate-spin' : ''}`} />
          {isRefetching ? 'Synchronisation…' : 'Synchroniser'}
        </button>
      </div>
    </div>
  );
}
