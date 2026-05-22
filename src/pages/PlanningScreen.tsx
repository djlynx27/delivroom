import { CitySelect } from '@/components/CitySelect';
import { DemandBadge } from '@/components/DemandBadge';
import { HourlyWeatherStrip } from '@/components/HourlyWeatherStrip';
import { NavigationSheet } from '@/components/NavigationSheet';
import { ShiftOptimizer } from '@/components/ShiftOptimizer';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useI18n } from '@/contexts/I18nContext';
import { useAutoCity } from '@/hooks/useAutoCity';
import { useCityId } from '@/hooks/useCityId';
import { usePullToRefresh } from '@/hooks/usePullToRefresh';
import { useCities, useZones } from '@/hooks/useSupabase';
import { haversineKm, useUserLocation } from '@/hooks/useUserLocation';
import { useWeather } from '@/hooks/useWeather';
import {
  formatTime24h,
  generate96TimeLabels,
  getDemandClass,
  getSlotOrderMinutes,
  normalize24hTime,
} from '@/lib/demandUtils';
import { getHomeConstraintsSettings } from '@/lib/driverPreferences';
import { computeDemandScore, type WeatherCondition } from '@/lib/scoringEngine';
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
} from 'react';

const TIME_LABELS = generate96TimeLabels();

function parseTimeMinPlanning(timeStr: string): number {
  const [h, m] = timeStr.split(':').map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
}

function formatMinAsTimePlanning(totalMin: number): string {
  const clamped = Math.max(0, totalMin);
  const h = Math.floor(clamped / 60);
  const m = clamped % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

export default function PlanningScreen() {
  usePullToRefresh(() => window.location.reload());

  // Family constraints — read once (no reactive update needed in planning view)
  const homeConstraints = useMemo(() => getHomeConstraintsSettings(), []);
  const { t } = useI18n();
  const [cityId, setCityId] = useCityId();
  const [date, setDate] = useState(
    () => new Date().toISOString().split('T')[0]
  );
  const [jumpTime, setJumpTime] = useState('');
  const [highlightTime, setHighlightTime] = useState<string | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const slotRefs = useRef<Map<string, HTMLDivElement>>(new Map());
  const { location: userLocation } = useUserLocation();
  useAutoCity(
    cityId,
    setCityId,
    userLocation?.latitude,
    userLocation?.longitude
  );

  const [navZone, setNavZone] = useState<{
    name: string;
    lat: number;
    lng: number;
  } | null>(null);

  const { data: cities = [] } = useCities();
  const { data: zones = [] } = useZones(cityId);
  const { data: weather } = useWeather(cityId);

  type ZoneItem = (typeof zones)[number];
  type SlotItem = {
    id: string;
    start_time: string;
    end_time: string;
    zone_id: string;
    demand_score: number;
    zones: ZoneItem;
  };

  const slots = useMemo(() => {
    if (zones.length === 0) return [];

    const weatherCond: WeatherCondition | null = weather
      ? {
          weatherId: weather.weatherId,
          temp: weather.temp,
          demandBoostPoints: weather.demandBoostPoints,
        }
      : null;
    const timeLabels = generate96TimeLabels();
    const items: SlotItem[] = [];

    for (const startTime of timeLabels) {
      const [hours, minutes] = startTime.split(':').map(Number);
      const endDate = new Date(2000, 0, 1, hours, minutes + 15);
      const endTime = formatTime24h(endDate);

      // Use a date object for scoring at this specific time
      const slotDate = new Date(date + 'T00:00:00');
      slotDate.setHours(hours, minutes, 0, 0);

      for (const zone of zones) {
        const { score } = computeDemandScore(zone, slotDate, weatherCond);
        items.push({
          id: `plan-${date}-${zone.id}-${startTime}`,
          start_time: startTime,
          end_time: endTime,
          zone_id: zone.id,
          demand_score: score,
          zones: zone,
        });
      }
    }

    // Group by HOUR, keep only top 3 zones per hour (best slot per zone)
    const hourGroups = new Map<number, SlotItem[]>();
    for (const item of items) {
      const [h] = item.start_time.split(':').map(Number);
      const arr = hourGroups.get(h) ?? [];
      arr.push(item);
      hourGroups.set(h, arr);
    }

    const result: SlotItem[] = [];
    for (const [, group] of hourGroups) {
      // Per zone, keep only the best-scoring slot within this hour
      const bestPerZone = new Map<string, SlotItem>();
      for (const item of group) {
        const existing = bestPerZone.get(item.zone_id);
        if (
          !existing ||
          (item.demand_score ?? 0) > (existing.demand_score ?? 0)
        ) {
          bestPerZone.set(item.zone_id, item);
        }
      }
      const deduped = [...bestPerZone.values()];
      deduped.sort((a, b) => {
        const scoreDiff = (b.demand_score ?? 0) - (a.demand_score ?? 0);
        if (scoreDiff !== 0) return scoreDiff;
        if (userLocation) {
          const dA = haversineKm(
            userLocation.latitude,
            userLocation.longitude,
            a.zones.latitude,
            a.zones.longitude
          );
          const dB = haversineKm(
            userLocation.latitude,
            userLocation.longitude,
            b.zones.latitude,
            b.zones.longitude
          );
          return dA - dB;
        }
        return 0;
      });
      result.push(...deduped.slice(0, 3));
    }

    return result.sort((a, b) => {
      const timeDiff =
        getSlotOrderMinutes(a.start_time) - getSlotOrderMinutes(b.start_time);
      if (timeDiff !== 0) return timeDiff;
      return (b.demand_score ?? 0) - (a.demand_score ?? 0);
    });
  }, [zones, date, userLocation, weather]);

  const fmtTime = normalize24hTime;

  const scrollAndHighlight = useCallback((time: string) => {
    const target = normalize24hTime(time);
    let bestEl: HTMLDivElement | null = null;
    let bestDiff = Infinity;
    const targetKey = getSlotOrderMinutes(target);

    slotRefs.current.forEach((el, key) => {
      const diff = Math.abs(getSlotOrderMinutes(key) - targetKey);
      if (diff < bestDiff) {
        bestDiff = diff;
        bestEl = el;
      }
    });

    (bestEl as HTMLDivElement | null)?.scrollIntoView({
      behavior: 'smooth',
      block: 'start',
    });
    setHighlightTime(target);
    setTimeout(() => setHighlightTime(null), 3000);
  }, []);

  // Auto-scroll to current time once slots are loaded
  const hasAutoScrolled = useRef(false);
  useEffect(() => {
    if (slots.length > 0 && !hasAutoScrolled.current) {
      hasAutoScrolled.current = true;
      const timer = setTimeout(() => {
        scrollAndHighlight(formatTime24h(new Date()));
      }, 150);
      return () => clearTimeout(timer);
    }
  }, [slots.length, scrollAndHighlight]);

  const handleJumpSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (/^\d{1,2}:\d{2}$/.test(jumpTime)) {
      scrollAndHighlight(normalize24hTime(jumpTime));
    }
  };

  const setSlotRef = useCallback((time: string, el: HTMLDivElement | null) => {
    if (el) slotRefs.current.set(time, el);
    else slotRefs.current.delete(time);
  }, []);

  return (
    <div className="flex flex-col h-full pb-36">
      <div className="px-3 pt-3 pb-2 space-y-2">
        <h1 className="text-[22px] font-display font-bold">{t('planning')}</h1>
        <div className="grid grid-cols-2 gap-2">
          <CitySelect cities={cities} value={cityId} onChange={setCityId} />
          <Input
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            className="bg-card border-border font-body text-[14px] h-11"
          />
        </div>

        <HourlyWeatherStrip cityId={cityId} hours={18} />

        <div className="grid grid-cols-2 gap-2">
          <Select onValueChange={scrollAndHighlight}>
            <SelectTrigger className="bg-card border-border font-body text-[14px] h-11">
              <SelectValue placeholder="⏱ Aller à..." />
            </SelectTrigger>
            <SelectContent className="bg-card border-border max-h-60">
              {TIME_LABELS.map((label) => (
                <SelectItem key={label} value={label}>
                  {label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <form onSubmit={handleJumpSubmit} className="flex gap-1">
            <Input
              placeholder="ex: 19:30"
              value={jumpTime}
              onChange={(e) => setJumpTime(e.target.value)}
              className="bg-card border-border font-body text-[14px] h-11"
            />
          </form>
        </div>

        <p className="text-[14px] text-muted-foreground font-body">
          {t('schedule')} · {date}
        </p>
      </div>

      <div
        ref={listRef}
        className="flex-1 overflow-y-auto px-3 space-y-1.5 pb-4"
      >
        {/* Weekly shift optimizer — appears above the daily slots */}
        <ShiftOptimizer cityId={cityId} className="mb-3 mt-1" />

        {slots.map((slot, index) => {
          const zone = slot.zones ?? zones.find((z) => z.id === slot.zone_id);
          const dc = getDemandClass(slot.demand_score);
          const timeKey = fmtTime(slot.start_time);
          const isHighlighted =
            highlightTime !== null && timeKey === highlightTime;
          const dist =
            userLocation && zone
              ? haversineKm(
                  userLocation.latitude,
                  userLocation.longitude,
                  zone.latitude,
                  zone.longitude
                )
              : null;

          // Constraint window marker: insert before first slot of each blocked hour
          const slotMin = getSlotOrderMinutes(slot.start_time);
          const prevSlot = index > 0 ? slots[index - 1] : null;
          const prevMin = prevSlot
            ? getSlotOrderMinutes(prevSlot.start_time)
            : -1;
          const familyMarker = (() => {
            if (!homeConstraints.enabled) return null;
            const homeStartMin = parseTimeMinPlanning(
              homeConstraints.returnHomeWindowStart
            );
            const pickupMin = parseTimeMinPlanning(homeConstraints.pickupTime);
            // Morning: mark before the return-home window starts
            if (slotMin >= homeStartMin && prevMin < homeStartMin) {
              return (
                <div
                  key={`family-home-${index}`}
                  className="flex items-center gap-2 bg-purple-500/10 border border-purple-500/30 rounded-xl px-3 py-2 my-1"
                >
                  <span className="text-base flex-shrink-0">🏠</span>
                  <div className="flex-1 min-w-0">
                    <p className="text-[13px] font-display font-bold text-purple-400 leading-snug">
                      Rentrer à la maison
                    </p>
                    <p className="text-[11px] text-muted-foreground font-body">
                      {homeConstraints.returnHomeWindowStart}–
                      {homeConstraints.returnHomeWindowEnd} ·{' '}
                      {homeConstraints.homeAddress}
                    </p>
                  </div>
                </div>
              );
            }
            // Afternoon: mark ~90 min before pickup (approximate departure window)
            const approxDepartMin = pickupMin - 60;
            if (slotMin >= approxDepartMin && prevMin < approxDepartMin) {
              return (
                <div
                  key={`family-pickup-${index}`}
                  className="flex items-center gap-2 bg-amber-500/10 border border-amber-500/30 rounded-xl px-3 py-2 my-1"
                >
                  <span className="text-base flex-shrink-0">🎒</span>
                  <div className="flex-1 min-w-0">
                    <p className="text-[13px] font-display font-bold text-amber-400 leading-snug">
                      Zone de départ pour {homeConstraints.momWorkName}
                    </p>
                    <p className="text-[11px] text-muted-foreground font-body">
                      Récupération à {homeConstraints.pickupTime} · heure de
                      pointe · quitter vers{' '}
                      {formatMinAsTimePlanning(approxDepartMin)}
                    </p>
                  </div>
                </div>
              );
            }
            return null;
          })();

          return (
            <>
              {familyMarker}
              <div
                key={slot.id || index}
                ref={(el) => setSlotRef(timeKey, el)}
                onClick={() =>
                  zone &&
                  setNavZone({
                    name: zone.name,
                    lat: zone.latitude,
                    lng: zone.longitude,
                  })
                }
                className={`flex items-center justify-between bg-card rounded-xl border-l-4 ${dc.border} border border-border p-4 gap-3 transition-all duration-500 cursor-pointer active:scale-[0.98] ${
                  isHighlighted
                    ? 'ring-2 ring-primary bg-primary/20 border-primary shadow-lg shadow-primary/30'
                    : ''
                }`}
              >
                <div className="flex-1 min-w-0">
                  <span className="text-[14px] text-muted-foreground font-body block">
                    {fmtTime(slot.start_time)} – {slot.end_time}
                  </span>
                  <span className="text-[18px] font-display font-semibold leading-tight block break-words">
                    {zone?.name}
                    {dist !== null && (
                      <span className="text-muted-foreground text-[14px] font-body ml-2">
                        · {dist.toFixed(1)} km
                      </span>
                    )}
                  </span>
                </div>
                <div className="flex-shrink-0">
                  <DemandBadge score={slot.demand_score} size="lg" />
                </div>
              </div>
            </>
          );
        })}
      </div>

      <NavigationSheet
        open={!!navZone}
        onClose={() => setNavZone(null)}
        zoneName={navZone?.name ?? ''}
        latitude={navZone?.lat ?? 0}
        longitude={navZone?.lng ?? 0}
      />
    </div>
  );
}
