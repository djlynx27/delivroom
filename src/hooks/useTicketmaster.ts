import { useQuery } from '@tanstack/react-query';

const TM_API_KEY = import.meta.env.VITE_TICKETMASTER_KEY ?? '';

const CITY_LATLONG: Record<string, string> = {
  mtl: '45.5017,-73.5673',
  qc: '46.8139,-71.2080',
  ott: '45.4215,-75.6972',
  lvl: '45.5559,-73.7217',
  lng: '45.5249,-73.5219',
  bsb: '45.6202,-73.8428',
  sth: '45.6422,-73.8295',
  blv: '45.6750,-73.8779',
  rsm: '45.6365,-73.7993',
  trb: '45.7017,-73.6449',
};

/** Known venue capacities for boost calculation */
const VENUE_CAPACITIES: Record<string, number> = {
  'Centre Bell': 21000,
  'Place Bell': 10000,
  'Stade olympique': 56000,
  'Stade Olympique': 56000,
  'Olympic Stadium': 56000,
  'Bell Centre': 21000,
  'Théâtre St-Denis': 2500,
  MTELUS: 2300,
  "L'Olympia": 1200,
  'Club Soda': 500,
};

export interface TicketmasterEvent {
  id: string;
  name: string;
  venueName: string;
  latitude: number;
  longitude: number;
  startDate: string; // ISO
  capacity: number;
  boostPoints: number; // 20-35 based on capacity
}

interface TicketmasterVenue {
  name?: string;
  location?: {
    latitude?: string;
    longitude?: string;
  };
}

interface TicketmasterApiEvent {
  id?: string;
  name?: string;
  dates?: {
    start?: {
      dateTime?: string;
      localDate?: string;
    };
  };
  _embedded?: {
    venues?: TicketmasterVenue[];
  };
}

interface TicketmasterApiResponse {
  _embedded?: {
    events?: TicketmasterApiEvent[];
  };
}

function capacityToBoost(capacity: number): number {
  if (capacity >= 40000) return 35;
  if (capacity >= 15000) return 30;
  if (capacity >= 5000) return 25;
  return 20;
}

export function useTicketmasterEvents(cityId: string) {
  const latlong = CITY_LATLONG[cityId] ?? CITY_LATLONG.mtl;

  return useQuery<TicketmasterEvent[]>({
    queryKey: ['ticketmaster', cityId],
    queryFn: async () => {
      if (!TM_API_KEY) return [];

      const url = `https://app.ticketmaster.com/discovery/v2/events.json?apikey=${TM_API_KEY}&latlong=${latlong}&radius=30&unit=km&size=50&sort=date,asc`;

      const res = await fetch(url);
      if (!res.ok) {
        console.warn('Ticketmaster fetch failed:', res.status);
        return [];
      }

      const data = (await res.json()) as TicketmasterApiResponse;
      const embedded = data?._embedded?.events;
      if (!Array.isArray(embedded)) return [];

      return embedded
        .map((ev) => {
          const venue = ev._embedded?.venues?.[0];
          if (!venue?.location) return null;

          const venueName = venue.name ?? '';
          const lat = parseFloat(venue.location.latitude);
          const lng = parseFloat(venue.location.longitude);
          if (isNaN(lat) || isNaN(lng)) return null;

          const startDate =
            ev.dates?.start?.dateTime ?? ev.dates?.start?.localDate ?? '';

          // Determine capacity from known venues or fallback
          const knownCap = VENUE_CAPACITIES[venueName];
          const capacity = knownCap ?? 2000; // default small venue

          return {
            id: ev.id,
            name: ev.name,
            venueName,
            latitude: lat,
            longitude: lng,
            startDate,
            capacity,
            boostPoints: capacityToBoost(capacity),
          } satisfies TicketmasterEvent;
        })
        .filter(Boolean) as TicketmasterEvent[];
    },
    staleTime: 15 * 60 * 1000,
    refetchInterval: 30 * 60 * 1000,
  });
}

/**
 * Filter events that are active now or starting within `windowHours`.
 */
export function getRelevantTmEvents(
  events: TicketmasterEvent[],
  now: Date,
  windowHours = 3
): TicketmasterEvent[] {
  const nowMs = now.getTime();
  const windowMs = windowHours * 60 * 60 * 1000;
  const eventDuration = 3 * 60 * 60 * 1000; // assume ~3h events

  return events.filter((ev) => {
    const start = new Date(ev.startDate).getTime();
    if (isNaN(start)) return false;
    const end = start + eventDuration;
    // Starting within window OR currently happening
    return (
      (start - nowMs <= windowMs && start - nowMs >= 0) ||
      (nowMs >= start && nowMs <= end)
    );
  });
}
