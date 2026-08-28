import { supabase } from '@/integrations/supabase/client';
import { haversineKm } from '@/hooks/useUserLocation';
import { useQuery } from '@tanstack/react-query';

export interface AppEvent {
  id: string;
  name: string;
  venue: string;
  city_id: string;
  latitude: number;
  longitude: number;
  start_at: string;
  end_at: string;
  capacity: number;
  demand_impact: number;
  boost_multiplier: number;
  boost_radius_km: number;
  boost_zone_types: string[];
  category: string;
  is_holiday: boolean;
}

const HIGH_DEMAND_EVENT_CATEGORIES = new Set(['sport', 'festival', 'holiday']);

function getEventDemandGraceMinutes(event: AppEvent) {
  if (HIGH_DEMAND_EVENT_CATEGORIES.has(event.category)) return 60;
  if (event.capacity >= 2500 || event.demand_impact >= 3) return 30;
  return 10;
}

export function isDemandRelevantEvent(event: AppEvent, now: Date) {
  const hour = now.getHours();
  const isOvernight = hour >= 0 && hour < 5;

  if (!isOvernight) return true;

  if (HIGH_DEMAND_EVENT_CATEGORIES.has(event.category)) return true;

  const supportsNightlife = event.boost_zone_types.includes('nightlife');
  const hasLargeCrowd = event.capacity >= 1500;
  const hasStrongDemandSignal =
    event.demand_impact >= 3 || event.boost_multiplier >= 1.7;

  return supportsNightlife && (hasLargeCrowd || hasStrongDemandSignal);
}

export function useEvents(cityId?: string) {
  return useQuery<AppEvent[]>({
    queryKey: ['events', cityId ?? 'all'],
    queryFn: async () => {
      let q = supabase.from('events').select('*').order('start_at');
      if (cityId) q = q.eq('city_id', cityId);
      const { data, error } = await q;
      if (error) throw error;
      return (data ?? []) as unknown as AppEvent[];
    },
  });
}

/** Get events active right now or within the next `windowMinutes` */
export function getActiveEvents(
  events: AppEvent[],
  now: Date,
  windowMinutes = 60
): AppEvent[] {
  const nowMs = now.getTime();
  return events.filter((e) => {
    const start = new Date(e.start_at).getTime();
    const end = new Date(e.end_at).getTime();
    if (!Number.isFinite(start) || !Number.isFinite(end)) return false;
    const graceMinutes = Math.min(windowMinutes, getEventDemandGraceMinutes(e));
    return (
      nowMs >= start &&
      nowMs <= end + graceMinutes * 60_000 &&
      isDemandRelevantEvent(e, now)
    );
  });
}

/** Get events ending within X minutes */
export function getEndingSoonEvents(
  events: AppEvent[],
  now: Date,
  withinMinutes = 60
): AppEvent[] {
  const nowMs = now.getTime();
  return events.filter((e) => {
    const end = new Date(e.end_at).getTime();
    if (!Number.isFinite(end)) return false;
    const diff = end - nowMs;
    return (
      diff > 0 &&
      diff <= withinMinutes * 60_000 &&
      isDemandRelevantEvent(e, now)
    );
  });
}

/**
 * Picks the event whose boost applies to `zone` — a radius + zone-type
 * match, same rule scoringEngine.ts uses to apply boost_multiplier.
 * `candidates` should be ending-soon events first, then merely-active ones,
 * so an event about to dump a crowd on the street outranks one that just
 * started (used for the "⚡ [Event] — sortie prévue" badge).
 */
export function matchZoneEvent(
  zone: { latitude: number; longitude: number; type: string },
  candidates: AppEvent[]
): AppEvent | undefined {
  return candidates.find((event) => {
    const appliesToZoneType =
      event.boost_zone_types.length === 0 ||
      event.boost_zone_types.includes(zone.type);
    if (!appliesToZoneType) return false;
    return (
      haversineKm(
        zone.latitude,
        zone.longitude,
        event.latitude,
        event.longitude
      ) <= event.boost_radius_km
    );
  });
}

/** Get events starting within X minutes (not yet started) */
export function getStartingSoonEvents(
  events: AppEvent[],
  now: Date,
  withinMinutes = 90
): AppEvent[] {
  const nowMs = now.getTime();
  return events.filter((e) => {
    const start = new Date(e.start_at).getTime();
    if (!Number.isFinite(start)) return false;
    const diff = start - nowMs;
    return (
      diff > 0 &&
      diff <= withinMinutes * 60_000 &&
      isDemandRelevantEvent(e, new Date(e.start_at))
    );
  });
}
