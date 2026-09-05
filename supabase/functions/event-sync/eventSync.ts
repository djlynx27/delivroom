// Pure event-mapping logic for event-sync, split out of index.ts so it's
// testable with `deno test` without hitting the network or Supabase.

// ── Fixed venue allowlist ─────────────────────────────────────────────────────
// Coordinates + boost tuning match the conventions used in the hand-seeded
// 2026 calendar (20260319000001_events_2026.sql). Keyed by Ticketmaster's
// venue name (case-insensitive) so unrelated venues in the radius search are
// skipped entirely.
export interface VenueConfig {
  cityId: string;
  latitude: number;
  longitude: number;
  capacity: number;
  boostRadiusKm: number;
  boostZoneTypes: string[];
}

export const VENUE_ALLOWLIST: Record<string, VenueConfig> = {
  'centre bell': {
    cityId: 'mtl', latitude: 45.4957, longitude: -73.5693,
    capacity: 21288, boostRadiusKm: 3.5,
    boostZoneTypes: ['nightlife', 'commercial', 'événements'],
  },
  'bell centre': {
    cityId: 'mtl', latitude: 45.4957, longitude: -73.5693,
    capacity: 21288, boostRadiusKm: 3.5,
    boostZoneTypes: ['nightlife', 'commercial', 'événements'],
  },
  'place bell': {
    cityId: 'lvl', latitude: 45.5476, longitude: -73.7479,
    capacity: 10000, boostRadiusKm: 2.5,
    boostZoneTypes: ['événements', 'nightlife', 'commercial'],
  },
  mtelus: {
    cityId: 'mtl', latitude: 45.5090, longitude: -73.5618,
    capacity: 2300, boostRadiusKm: 1.5,
    boostZoneTypes: ['nightlife', 'commercial', 'tourisme'],
  },
  'théâtre st-denis': {
    cityId: 'mtl', latitude: 45.5165, longitude: -73.5622,
    capacity: 2500, boostRadiusKm: 1.5,
    boostZoneTypes: ['nightlife', 'commercial', 'tourisme'],
  },
  "l'olympia": {
    cityId: 'mtl', latitude: 45.5088, longitude: -73.5658,
    capacity: 1200, boostRadiusKm: 1.2,
    boostZoneTypes: ['nightlife', 'commercial'],
  },
  'club soda': {
    cityId: 'mtl', latitude: 45.5087, longitude: -73.5698,
    capacity: 500, boostRadiusKm: 1.0,
    boostZoneTypes: ['nightlife', 'commercial'],
  },
  'place des arts': {
    cityId: 'mtl', latitude: 45.5090, longitude: -73.5618,
    capacity: 3000, boostRadiusKm: 1.5,
    boostZoneTypes: ['nightlife', 'commercial', 'tourisme', 'événements'],
  },
  'stade olympique': {
    cityId: 'mtl', latitude: 45.5589, longitude: -73.5514,
    capacity: 56000, boostRadiusKm: 4.0,
    boostZoneTypes: ['transport', 'événements', 'tourisme'],
  },
};

// Search radius per market centroid — 30km covers the whole allowlist per city.
export const SEARCH_MARKETS: Record<string, { lat: number; lon: number }> = {
  mtl: { lat: 45.5017, lon: -73.5673 },
  lvl: { lat: 45.5559, lon: -73.7217 },
  lng: { lat: 45.5311, lon: -73.5181 },
};

// Ticketmaster never publishes an end time — estimate from the segment.
export const DURATION_HOURS_BY_SEGMENT: Record<string, number> = {
  sports: 3.25,
  music: 2.75,
  'arts & theatre': 2.25,
};
export const DEFAULT_DURATION_HOURS = 2.5;

export const CATEGORY_BY_SEGMENT: Record<string, string> = {
  sports: 'sport',
  music: 'concert',
  'arts & theatre': 'event',
};

// ── Ticketmaster API types (subset actually used) ─────────────────────────────
export interface TmVenue {
  name?: string;
}
export interface TmClassification {
  segment?: { name?: string };
}
export interface TmApiEvent {
  id?: string;
  name?: string;
  dates?: { start?: { dateTime?: string } };
  classifications?: TmClassification[];
  _embedded?: { venues?: TmVenue[] };
}
export interface TmApiResponse {
  _embedded?: { events?: TmApiEvent[] };
}

export interface EventRow {
  external_id: string;
  name: string;
  venue: string;
  city_id: string;
  latitude: number;
  longitude: number;
  start_at: string;
  end_at: string;
  capacity: number;
  category: string;
  boost_radius_km: number;
  boost_zone_types: string[];
}

/** Maps one Ticketmaster event to an events row, or null if it should be
 * skipped (missing required fields, or not one of our tracked venues). */
export function toEventRow(ev: TmApiEvent): EventRow | null {
  const venueName = ev._embedded?.venues?.[0]?.name?.trim().toLowerCase();
  if (!venueName) return null;
  const config = VENUE_ALLOWLIST[venueName];
  if (!config) return null; // not one of our tracked venues — skip the noise

  const startIso = ev.dates?.start?.dateTime;
  if (!ev.id || !ev.name || !startIso) return null;
  const startMs = new Date(startIso).getTime();
  if (!Number.isFinite(startMs)) return null;

  const segment = ev.classifications?.[0]?.segment?.name?.toLowerCase() ?? '';
  const durationHours = DURATION_HOURS_BY_SEGMENT[segment] ?? DEFAULT_DURATION_HOURS;
  const endIso = new Date(startMs + durationHours * 3_600_000).toISOString();

  return {
    external_id: ev.id,
    name: ev.name,
    venue: ev._embedded!.venues![0].name!,
    city_id: config.cityId,
    latitude: config.latitude,
    longitude: config.longitude,
    start_at: startIso,
    end_at: endIso,
    capacity: config.capacity,
    category: CATEGORY_BY_SEGMENT[segment] ?? 'event',
    boost_radius_km: config.boostRadiusKm,
    boost_zone_types: config.boostZoneTypes,
  };
}

/** De-dupes across multiple market searches (a venue near two market
 * centroids could otherwise appear twice) by external_id. */
export function dedupeEventRows(lists: TmApiEvent[][]): EventRow[] {
  const byExternalId = new Map<string, EventRow>();
  for (const list of lists) {
    for (const ev of list) {
      const row = toEventRow(ev);
      if (row) byExternalId.set(row.external_id, row);
    }
  }
  return Array.from(byExternalId.values());
}
