import { CitySelect } from '@/components/CitySelect';
import { Button } from '@/components/ui/button';
import { useI18n } from '@/contexts/I18nContext';
import { useAutoCity } from '@/hooks/useAutoCity';
import { useCityId } from '@/hooks/useCityId';
import { useEvents, type AppEvent } from '@/hooks/useEvents';
import { usePullToRefresh } from '@/hooks/usePullToRefresh';
import { useCities } from '@/hooks/useSupabase';
import { useUserLocation } from '@/hooks/useUserLocation';
import { openGoogleMapsNav } from '@/lib/hotspots';
import { Calendar, Clock, Navigation, Star, Users } from 'lucide-react';
import { useMemo } from 'react';

function formatDate(dateStr: string, locale: string): string {
  return new Date(dateStr).toLocaleDateString(locale, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  });
}

function formatTime(dateStr: string): string {
  const d = new Date(dateStr);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

function DemandStars({ impact }: { impact: number }) {
  return (
    <div className="flex gap-0.5">
      {Array.from({ length: 5 }, (_, i) => (
        <Star
          key={i}
          className={`w-4 h-4 ${i < impact ? 'fill-primary text-primary' : 'text-muted-foreground/30'}`}
        />
      ))}
    </div>
  );
}

function CategoryBadge({ category }: { category: string }) {
  const { t } = useI18n();
  const labels: Record<string, { label: string; emoji: string }> = {
    hockey: { label: t('eventCategoryHockey'), emoji: '🏒' },
    festival: { label: t('eventCategoryFestival'), emoji: '🎵' },
    holiday: { label: t('eventCategoryHoliday'), emoji: '🎉' },
    event: { label: t('eventCategoryEvent'), emoji: '📅' },
  };
  const c = labels[category] ?? labels.event;
  return (
    <span className="inline-flex items-center gap-1 bg-accent rounded-full px-2.5 py-0.5 text-[12px] font-display font-medium">
      {c.emoji} {c.label}
    </span>
  );
}

function EventCard({ event, isToday }: { event: AppEvent; isToday: boolean }) {
  const { t, locale } = useI18n();
  const now = new Date();
  const endAt = new Date(event.end_at);
  const minutesUntilEnd = Math.round(
    (endAt.getTime() - now.getTime()) / 60_000
  );
  const isEndingSoon = isToday && minutesUntilEnd > 0 && minutesUntilEnd <= 60;
  const isActive = isToday && now >= new Date(event.start_at) && now <= endAt;

  return (
    <div
      className={`bg-card rounded-xl border border-border p-4 space-y-3 ${isActive ? 'ring-1 ring-primary/50' : ''}`}
    >
      {isEndingSoon && (
        <div className="flex items-center gap-2 bg-destructive/20 border border-destructive/40 rounded-lg px-3 py-2">
          <span className="text-[14px] font-body font-bold text-destructive">
            🔴 {event.name} {t('eventEndsIn')} {minutesUntilEnd}
            {t('minutes')} – {t('maxDemandExpected')}
          </span>
        </div>
      )}

      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 mb-1">
            <CategoryBadge category={event.category} />
            {isActive && (
              <span className="inline-flex items-center gap-1 bg-primary/20 text-primary rounded-full px-2 py-0.5 text-[11px] font-bold uppercase">
                {t('ongoing')}
              </span>
            )}
          </div>
          <h3 className="text-[20px] font-display font-bold leading-tight break-words">
            {event.name}
          </h3>
          <p className="text-[14px] text-muted-foreground mt-0.5">
            {event.venue}
          </p>
        </div>
        <DemandStars impact={event.demand_impact} />
      </div>

      <div className="flex items-center gap-4 text-[14px] text-muted-foreground font-body">
        <span className="flex items-center gap-1">
          <Calendar className="w-3.5 h-3.5" />
          {formatDate(event.start_at, locale)}
        </span>
        <span className="flex items-center gap-1">
          <Clock className="w-3.5 h-3.5" />
          {formatTime(event.start_at)}–{formatTime(event.end_at)}
        </span>
        {event.capacity > 0 && (
          <span className="flex items-center gap-1">
            <Users className="w-3.5 h-3.5" />
            {event.capacity.toLocaleString()}
          </span>
        )}
      </div>

      <div className="flex items-center gap-2 text-[13px] text-muted-foreground">
        <span>
          {t('boost')}: ×{event.boost_multiplier}
        </span>
        <span>·</span>
        <span>
          {t('radius')}: {event.boost_radius_km} km
        </span>
      </div>

      {!event.is_holiday && (
        <Button
          onClick={() => openGoogleMapsNav(event.venue, event.latitude, event.longitude)}
          className="w-full h-14 text-[16px] font-display font-bold gap-2 bg-primary text-primary-foreground hover:bg-primary/90"
        >
          <Navigation className="w-4 h-4" />
          {t('navigateTo')} {event.venue}
        </Button>
      )}
    </div>
  );
}

export default function EventsScreen() {
  usePullToRefresh(() => window.location.reload());
  const { t } = useI18n();
  const [cityId, setCityId] = useCityId();
  const { location: userLocation } = useUserLocation();
  useAutoCity(
    cityId,
    setCityId,
    userLocation?.latitude,
    userLocation?.longitude
  );
  const { data: cities = [] } = useCities();
  const { data: events = [] } = useEvents(cityId);

  // Build stable date boundaries for today (local timezone)
  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const todayEnd = new Date(todayStart);
  todayEnd.setDate(todayEnd.getDate() + 1);
  const weekEnd = new Date(todayStart);
  weekEnd.setDate(weekEnd.getDate() + 8);

  const todayMs = todayStart.getTime();
  const todayEndMs = todayEnd.getTime();
  const weekEndMs = weekEnd.getTime();

  // Today: any event that overlaps with today (started before tomorrow AND ends after midnight today)
  // This includes events starting later tonight that haven't begun yet
  const todayEvents = useMemo(
    () =>
      events.filter((e) => {
        const startMs = new Date(e.start_at).getTime();
        const endMs = new Date(e.end_at).getTime();
        return startMs < todayEndMs && endMs >= todayMs;
      }),
    [events, todayMs, todayEndMs]
  );

  // Next 7 days: events starting from tomorrow through next week
  const upcomingEvents = useMemo(
    () =>
      events.filter((e) => {
        const startMs = new Date(e.start_at).getTime();
        return startMs >= todayEndMs && startMs < weekEndMs;
      }),
    [events, todayEndMs, weekEndMs]
  );

  return (
    <div className="flex flex-col h-full pb-36 overflow-y-auto">
      <div className="px-3 pt-3 pb-2 space-y-2">
        <div className="flex items-center justify-between gap-2">
          <h1 className="text-[22px] font-display font-bold">{t('events')}</h1>
          <div className="w-[150px] flex-shrink-0">
            <CitySelect cities={cities} value={cityId} onChange={setCityId} />
          </div>
        </div>
      </div>

      <div className="px-3 space-y-3">
        {/* Today's events */}
        <h2 className="text-[16px] font-display font-bold text-primary uppercase tracking-wide">
          {t('today')}
          {todayEvents.length > 0 && (
            <span className="ml-2 bg-primary text-primary-foreground text-[12px] rounded-full px-2 py-0.5 font-bold">
              {todayEvents.length}
            </span>
          )}
        </h2>
        {todayEvents.length === 0 && (
          <p className="text-[14px] text-muted-foreground font-body py-4">
            {t('noEventsToday')}
          </p>
        )}
        {todayEvents.map((e) => (
          <EventCard key={e.id} event={e} isToday />
        ))}

        {/* Next 7 days */}
        <h2 className="text-[16px] font-display font-bold text-muted-foreground uppercase tracking-wide mt-4">
          {t('next7Days')}
        </h2>
        {upcomingEvents.length === 0 && (
          <p className="text-[14px] text-muted-foreground font-body py-4">
            {t('noUpcomingEvents')}
          </p>
        )}
        {upcomingEvents.map((e) => (
          <EventCard key={e.id} event={e} isToday={false} />
        ))}
      </div>
    </div>
  );
}
