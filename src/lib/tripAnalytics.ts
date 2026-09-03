import type { TripWithZone } from '@/hooks/useTrips';
import type { Tables } from '@/integrations/supabase/types';

type SessionRow = Tables<'sessions'>;

export interface MetricSummary {
  revenue: number;
  rides: number;
  hours: number;
  revenuePerHour: number;
  averageRide: number;
  distanceKm: number;
}

export interface ChartPoint {
  label: string;
  revenue: number;
  rides: number;
  hours: number;
}

export interface RankedBucket {
  label: string;
  revenue: number;
  rides: number;
  hours: number;
  /** revenue/hours, but only once the sample clears MIN_RATE_TRIPS trips and
   * MIN_RATE_HOURS cumulative duration — below that, a single short trip can
   * swing $/h wildly (division by a near-zero denominator), so null tells
   * callers to show "not enough data" instead of a misleading number. */
  revenuePerHour: number | null;
}

export interface ShiftSnapshot {
  startedAt: string;
  elapsedHours: number;
  metrics: MetricSummary;
  topZone: string | null;
  topPlatform: string | null;
}

export interface TrackedShiftSummary {
  shiftCount: number;
  hours: number;
  revenue: number;
  rides: number;
  revenuePerHour: number;
}

export interface TripAnalytics {
  last7Days: MetricSummary;
  last30Days: MetricSummary;
  dailySeries: ChartPoint[];
  zoneSeries: RankedBucket[];
  daypartSeries: RankedBucket[];
  platformSeries: RankedBucket[];
  bestZone: string | null;
  bestPlatform: string | null;
}

const DAYPART_LABELS = ['Nuit', 'Matin', 'Après-midi', 'Soir'];

function round(value: number, digits = 1) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function toDate(value: string | null | undefined) {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function getSessionTrackedTotals(session: SessionRow) {
  const startedAt = toDate(session.started_at);
  const endedAt = toDate(session.ended_at);
  const derivedDurationHours =
    startedAt && endedAt
      ? Math.max(0, (endedAt.getTime() - startedAt.getTime()) / 3_600_000)
      : 0;

  return {
    startedAt,
    endedAt,
    totalHours: Math.max(
      Number(session.total_hours ?? 0),
      derivedDurationHours
    ),
    totalRevenue: Number(session.total_earnings ?? 0),
    totalRides: Number(session.total_rides ?? 0),
  };
}

export function getTripRevenue(trip: Pick<TripWithZone, 'earnings' | 'tips'>) {
  return Number(trip.earnings ?? 0) + Number(trip.tips ?? 0);
}

export function getTripHours(
  trip: { started_at: string | null; ended_at: string | null },
  fallbackEnd?: Date
) {
  const startedAt = toDate(trip.started_at);
  if (!startedAt) return 0;

  const endedAt = toDate(trip.ended_at) ?? fallbackEnd;
  if (!endedAt) return 0;
  return Math.max(0, (endedAt.getTime() - startedAt.getTime()) / 3_600_000);
}

export function summarizeTrips(
  trips: TripWithZone[],
  start: Date,
  end = new Date()
): MetricSummary {
  const windowTrips = trips.filter((trip) => {
    const startedAt = toDate(trip.started_at);
    return startedAt && startedAt >= start && startedAt <= end;
  });

  const revenue = windowTrips.reduce(
    (sum, trip) => sum + getTripRevenue(trip),
    0
  );
  const rides = windowTrips.length;
  const hours = windowTrips.reduce((sum, trip) => sum + getTripHours(trip), 0);
  const distanceKm = windowTrips.reduce(
    (sum, trip) => sum + Number(trip.distance_km ?? 0),
    0
  );

  return {
    revenue: round(revenue, 2),
    rides,
    hours: round(hours, 1),
    revenuePerHour: hours > 0 ? round(revenue / hours, 2) : 0,
    averageRide: rides > 0 ? round(revenue / rides, 2) : 0,
    distanceKm: round(distanceKm, 1),
  };
}

export function summarizeTrackedSessions(
  sessions: SessionRow[],
  start: Date,
  end = new Date()
): TrackedShiftSummary {
  let shiftCount = 0;
  let hours = 0;
  let revenue = 0;
  let rides = 0;

  for (const session of sessions) {
    const totals = getSessionTrackedTotals(session);
    if (!totals.startedAt || !totals.endedAt || totals.totalHours <= 0) {
      continue;
    }

    const overlapStart = Math.max(totals.startedAt.getTime(), start.getTime());
    const overlapEnd = Math.min(totals.endedAt.getTime(), end.getTime());
    if (overlapEnd <= overlapStart) {
      continue;
    }

    const overlapHours = (overlapEnd - overlapStart) / 3_600_000;
    const ratio = Math.min(overlapHours / totals.totalHours, 1);
    shiftCount += 1;
    hours += overlapHours;
    revenue += totals.totalRevenue * ratio;
    rides += totals.totalRides * ratio;
  }

  return {
    shiftCount,
    hours: round(hours, 1),
    revenue: round(revenue, 2),
    rides: round(rides, 1),
    revenuePerHour: hours > 0 ? round(revenue / hours, 2) : 0,
  };
}

// Below this sample size, a per-zone/platform $/h is noise, not signal — a
// zone with 1-2 short trips (or synthetic seed data averaging ~9 min/trip)
// can show $100+/h purely from dividing by a near-zero duration. Matches the
// 2026-09-02 admin-reports audit finding (Cégep de Terrebonne showing
// $278/h off a handful of micro-duration trips).
const MIN_RATE_TRIPS = 3;
const MIN_RATE_HOURS = 0.5;

function getDaypartLabel(date: Date) {
  const hour = date.getHours();
  if (hour < 6) return DAYPART_LABELS[0];
  if (hour < 12) return DAYPART_LABELS[1];
  if (hour < 18) return DAYPART_LABELS[2];
  return DAYPART_LABELS[3];
}

function buildRankedSeries(
  trips: TripWithZone[],
  bucket: (trip: TripWithZone) => string,
  limit: number
) {
  // Normalize key by trimming + lower-casing to prevent duplicate buckets
  // when DB entries have inconsistent casing (e.g. "Downtown" vs "downtown").
  // The original label is preserved for display via the first occurrence.
  const map = new Map<string, Omit<RankedBucket, 'revenuePerHour'>>();

  for (const trip of trips) {
    const rawLabel = bucket(trip);
    const key = rawLabel.trim().toLowerCase();
    const current = map.get(key) ?? {
      label: rawLabel.trim(),
      revenue: 0,
      rides: 0,
      hours: 0,
    };
    current.revenue += getTripRevenue(trip);
    current.rides += 1;
    current.hours += getTripHours(trip);
    map.set(key, current);
  }

  return [...map.values()]
    .map((entry) => ({
      ...entry,
      revenue: round(entry.revenue, 2),
      hours: round(entry.hours, 1),
      revenuePerHour:
        entry.rides >= MIN_RATE_TRIPS && entry.hours >= MIN_RATE_HOURS
          ? round(entry.revenue / entry.hours, 2)
          : null,
    }))
    .sort((left, right) => right.revenue - left.revenue)
    .slice(0, limit);
}

export function aggregateTripAnalytics(
  trips: TripWithZone[],
  now = new Date()
): TripAnalytics {
  const start7Days = new Date(now);
  start7Days.setDate(start7Days.getDate() - 6);
  start7Days.setHours(0, 0, 0, 0);

  const start30Days = new Date(now);
  start30Days.setDate(start30Days.getDate() - 29);
  start30Days.setHours(0, 0, 0, 0);

  const trips30Days = trips.filter((trip) => {
    const startedAt = toDate(trip.started_at);
    return startedAt && startedAt >= start30Days && startedAt <= now;
  });

  const dailySeries: ChartPoint[] = Array.from({ length: 7 }, (_, index) => {
    const day = new Date(start7Days);
    day.setDate(start7Days.getDate() + index);
    const nextDay = new Date(day);
    nextDay.setDate(day.getDate() + 1);

    const metrics = summarizeTrips(trips, day, nextDay);
    return {
      label: new Intl.DateTimeFormat('fr-CA', {
        weekday: 'short',
        day: 'numeric',
      }).format(day),
      revenue: metrics.revenue,
      rides: metrics.rides,
      hours: metrics.hours,
    };
  });

  const zoneSeries = buildRankedSeries(
    trips30Days,
    (trip) => trip.zones?.name || 'Zone inconnue',
    8
  );
  const daypartSeries = DAYPART_LABELS.map((label) => {
    const daypartTrips = trips30Days.filter((trip) => {
      const startedAt = toDate(trip.started_at);
      return startedAt && getDaypartLabel(startedAt) === label;
    });
    const metrics = summarizeTrips(daypartTrips, new Date(0), now);
    return {
      label,
      revenue: metrics.revenue,
      rides: metrics.rides,
      hours: metrics.hours,
    };
  });
  const platformSeries = buildRankedSeries(
    trips30Days,
    (trip) => trip.platform || 'Non précisé',
    6
  );

  return {
    last7Days: summarizeTrips(trips, start7Days, now),
    last30Days: summarizeTrips(trips, start30Days, now),
    dailySeries,
    zoneSeries,
    daypartSeries,
    platformSeries,
    bestZone: zoneSeries[0]?.label ?? null,
    bestPlatform: platformSeries[0]?.label ?? null,
  };
}

export function buildShiftSnapshot(
  trips: TripWithZone[],
  startedAtIso: string,
  now = new Date()
): ShiftSnapshot {
  const startedAt = toDate(startedAtIso) ?? now;
  const metrics = summarizeTrips(trips, startedAt, now);
  const zoneSeries = buildRankedSeries(
    trips.filter((trip) => {
      const tripDate = toDate(trip.started_at);
      return tripDate && tripDate >= startedAt && tripDate <= now;
    }),
    (trip) => trip.zones?.name || 'Zone inconnue',
    1
  );
  const platformSeries = buildRankedSeries(
    trips.filter((trip) => {
      const tripDate = toDate(trip.started_at);
      return tripDate && tripDate >= startedAt && tripDate <= now;
    }),
    (trip) => trip.platform || 'Non précisé',
    1
  );

  return {
    startedAt: startedAt.toISOString(),
    elapsedHours: round((now.getTime() - startedAt.getTime()) / 3_600_000, 1),
    metrics,
    topZone: zoneSeries[0]?.label ?? null,
    topPlatform: platformSeries[0]?.label ?? null,
  };
}
