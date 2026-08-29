import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import type { Zone } from '@/hooks/useSupabase';
import { supabase } from '@/integrations/supabase/client';
import { getTripHours } from '@/lib/tripAnalytics';
import { useQuery } from '@tanstack/react-query';
import { BarChart3 } from 'lucide-react';
import { useMemo, useState } from 'react';

const HOURS = Array.from({ length: 24 }, (_, i) => i);
const DAYS = [
  { value: '1', label: 'Lun' },
  { value: '2', label: 'Mar' },
  { value: '3', label: 'Mer' },
  { value: '4', label: 'Jeu' },
  { value: '5', label: 'Ven' },
  { value: '6', label: 'Sam' },
  { value: '0', label: 'Dim' },
];

function useZonePerformance() {
  return useQuery({
    queryKey: ['zone-performance'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('trips')
        .select('zone_id, earnings, tips, started_at, ended_at')
        .not('zone_id', 'is', null)
        .order('started_at', { ascending: false })
        .limit(1000);
      if (error) throw error;
      return data ?? [];
    },
    staleTime: 5 * 60_000,
  });
}

interface Props {
  zones: Zone[];
}

type HeatmapColor = 'green' | 'yellow' | 'red' | 'grey';
type ZonePerformanceTrip = {
  zone_id: string | null;
  earnings: number | null;
  tips: number | null;
  started_at: string;
  ended_at: string | null;
};

const colorLabels: Record<HeatmapColor, string> = {
  green: 'Au-dessus',
  yellow: 'Moyen',
  red: 'En-dessous',
  grey: 'Pas de données',
};

const colorClasses: Record<HeatmapColor, string> = {
  green: 'bg-green-500/20 border-green-500/40 text-green-400',
  yellow: 'bg-yellow-500/20 border-yellow-500/40 text-yellow-400',
  red: 'bg-red-500/20 border-red-500/40 text-red-400',
  grey: 'bg-muted/20 border-border text-muted-foreground',
};

function getMatchingTrips({
  trips,
  selectedHour,
  selectedDay,
}: {
  trips: ZonePerformanceTrip[];
  selectedHour: number;
  selectedDay: number;
}) {
  return trips.filter((trip) => {
    const date = new Date(trip.started_at);
    return date.getHours() === selectedHour && date.getDay() === selectedDay;
  });
}

function buildZoneEarningsPerHour(trips: ZonePerformanceTrip[]) {
  const zoneStats: Record<
    string,
    { totalEarnings: number; totalHours: number }
  > = {};

  for (const trip of trips) {
    if (!trip.zone_id) {
      continue;
    }

    if (!zoneStats[trip.zone_id]) {
      zoneStats[trip.zone_id] = { totalEarnings: 0, totalHours: 0 };
    }

    zoneStats[trip.zone_id]!.totalEarnings +=
      Number(trip.earnings || 0) + Number(trip.tips || 0);
    zoneStats[trip.zone_id]!.totalHours += getTripHours(trip);
  }

  const earningsPerHour: Record<string, number> = {};
  for (const [zoneId, stats] of Object.entries(zoneStats)) {
    earningsPerHour[zoneId] =
      stats.totalHours > 0 ? stats.totalEarnings / stats.totalHours : 0;
  }

  return earningsPerHour;
}

export interface ZonePerf {
  color: HeatmapColor;
  earningsPerHour: number | null;
}

// Empty map = no trip data at all for the selected hour/day (distinct from a
// zone that has no data individually, which gets a 'grey' entry below) — the
// caller renders a section-wide empty state instead of a wall of grey cards.
export function buildZonePerformance({
  trips,
  hour,
  day,
  zones,
}: {
  trips: ZonePerformanceTrip[];
  hour: string;
  day: string;
  zones: Zone[];
}): Map<string, ZonePerf> {
  const selectedHour = parseInt(hour, 10);
  const selectedDay = parseInt(day, 10);
  const matchingTrips = getMatchingTrips({ trips, selectedHour, selectedDay });
  const earningsPerHour = buildZoneEarningsPerHour(matchingTrips);
  const values = Object.values(earningsPerHour);

  if (values.length === 0) {
    return new Map<string, ZonePerf>();
  }

  const average =
    values.reduce((first, second) => first + second, 0) / values.length;
  const result = new Map<string, ZonePerf>();

  for (const zone of zones) {
    const eph = earningsPerHour[zone.id];
    if (eph === undefined) {
      result.set(zone.id, { color: 'grey', earningsPerHour: null });
      continue;
    }

    const color: HeatmapColor =
      eph >= average * 1.2 ? 'green' : eph >= average * 0.8 ? 'yellow' : 'red';
    result.set(zone.id, { color, earningsPerHour: eph });
  }

  return result;
}

function HeatmapLegend() {
  return (
    <div className="flex gap-2 text-[11px]">
      {(['green', 'yellow', 'red', 'grey'] as const).map((color) => (
        <span
          key={color}
          className={`px-2 py-0.5 rounded border ${colorClasses[color]}`}
        >
          {colorLabels[color]}
        </span>
      ))}
    </div>
  );
}

function HeatmapZoneList({
  zones,
  perf,
}: {
  zones: Zone[];
  perf: Map<string, ZonePerf>;
}) {
  return (
    <div className="space-y-1.5 max-h-[300px] overflow-y-auto">
      {zones.map((zone) => {
        const { color, earningsPerHour } = perf.get(zone.id) ?? {
          color: 'grey' as HeatmapColor,
          earningsPerHour: null,
        };
        return (
          <div
            key={zone.id}
            className={`flex items-center justify-between gap-2 rounded-lg border px-3 py-2 ${colorClasses[color]}`}
          >
            <div className="min-w-0">
              <span className="text-[13px] font-display font-semibold">
                {zone.name}
              </span>
              <span className="text-[11px] ml-2 capitalize opacity-70">
                {zone.type}
              </span>
            </div>
            {/* Explicit metric/badge so a performance card never reads like
             * the plain CRUD rows below it. */}
            <span className="text-[11px] font-semibold flex-shrink-0">
              {earningsPerHour !== null
                ? `${earningsPerHour.toFixed(0)} $/h`
                : colorLabels.grey}
            </span>
          </div>
        );
      })}
    </div>
  );
}

function PerformanceEmptyState({ dayLabel, hour }: { dayLabel: string; hour: string }) {
  return (
    <div className="rounded-lg border border-dashed border-border px-3 py-6 text-center text-[13px] text-muted-foreground">
      Aucune donnée de performance enregistrée pour {dayLabel} {hour.padStart(2, '0')}:00.
    </div>
  );
}

export function ZonePerformanceHeatmap({ zones }: Props) {
  const [hour, setHour] = useState(String(new Date().getHours()));
  const [day, setDay] = useState(String(new Date().getDay()));
  const { data: trips = [] } = useZonePerformance();

  const perf = useMemo(
    () => buildZonePerformance({ trips, hour, day, zones }),
    [trips, hour, day, zones]
  );
  const dayLabel = DAYS.find((d) => d.value === day)?.label ?? '';

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <BarChart3 className="w-4 h-4 text-primary" />
        <span className="text-[14px] font-display font-bold">
          Performance par zone
        </span>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <Select value={hour} onValueChange={setHour}>
          <SelectTrigger className="bg-background border-border text-[13px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent className="bg-card border-border max-h-60">
            {HOURS.map((h) => (
              <SelectItem key={h} value={String(h)}>
                {String(h).padStart(2, '0')}:00
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={day} onValueChange={setDay}>
          <SelectTrigger className="bg-background border-border text-[13px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent className="bg-card border-border">
            {DAYS.map((d) => (
              <SelectItem key={d.value} value={d.value}>
                {d.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <HeatmapLegend />
      {perf.size === 0 ? (
        <PerformanceEmptyState dayLabel={dayLabel} hour={hour} />
      ) : (
        <HeatmapZoneList zones={zones} perf={perf} />
      )}
    </div>
  );
}
