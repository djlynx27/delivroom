import {
  getActiveEvents,
  getStartingSoonEvents,
  type AppEvent,
} from '@/hooks/useEvents';
import type { Zone } from '@/hooks/useSupabase';
import { haversineKm } from '@/hooks/useUserLocation';
import {
  DISTANCE_PENALTY_PER_KM,
  MAX_HERO_ZONE_DISTANCE_KM,
  rankByProximityPenalizedScore,
} from '@/lib/zoneMatch';

/**
 * Lab-only "taxi mode" candidate builder. Pure, client-side: no DB writes, no
 * change to the shared scores/cron (the DB is shared with the commercial
 * DailyVroom build). The Drive screen swaps its candidate list for this when
 * `isLabBuild()`.
 *
 * Output = taxi hubs + in-progress / imminent events, nothing else. Events are
 * ranked ABOVE every hub regardless of the hub's score: the DB score clamps at
 * 100 and a permanent hub starts at 70-80, so a +2..+20 event boost could never
 * overtake it (events were effectively never recommended).
 */

export type TaxiHubKind = 'airport' | 'transit' | 'hospital' | 'arena' | 'mall';

export interface TaxiHub {
  id: string;
  name: string;
  city_id: 'mtl' | 'lvl' | 'lng';
  kind: TaxiHubKind;
  latitude: number;
  longitude: number;
}

// Coordinates verified against the official GTFS stops (STL, RTL, exo; 2026-10-12)
// for the 7 transit hubs, and OSM geocoding for the rest (Place Bell, YUL, Gare
// Centrale, Centre Bell, Berri-UQAM, CHUM, DIX30). The driver's original values
// were 0.9-5.8 km off for Cartier, Le Carrefour, Sainte-Dorothée,
// Charles-Le Moyne and Longueuil. "Candidats" taxi: that a point is an OFFICIAL
// taxi stand is not verifiable remotely (the Ville de Montréal stand dataset
// only covers the island: Gare Centrale, Berri-UQAM and CHUM sit within 30 m of
// one) — confirm Laval/Longueuil on the ground.
export const TAXI_HUBS: readonly TaxiHub[] = [
  { id: 'lvl-carrefour', name: 'Terminus Le Carrefour', city_id: 'lvl', kind: 'transit', latitude: 45.5686, longitude: -73.7484 },
  { id: 'lvl-montmorency', name: 'Métro Montmorency', city_id: 'lvl', kind: 'transit', latitude: 45.5583, longitude: -73.721 },
  { id: 'lvl-place-bell', name: 'Place Bell', city_id: 'lvl', kind: 'arena', latitude: 45.5559, longitude: -73.7231 },
  { id: 'lvl-cartier', name: 'Métro Cartier', city_id: 'lvl', kind: 'transit', latitude: 45.5598, longitude: -73.6826 },
  { id: 'lvl-rem-ste-dorothee', name: 'REM Sainte-Dorothée', city_id: 'lvl', kind: 'transit', latitude: 45.5233, longitude: -73.8617 },
  { id: 'mtl-yul', name: 'Aéroport YUL (arrivées)', city_id: 'mtl', kind: 'airport', latitude: 45.4657, longitude: -73.7455 },
  { id: 'mtl-gare-centrale', name: 'Gare Centrale', city_id: 'mtl', kind: 'transit', latitude: 45.5002, longitude: -73.5661 },
  { id: 'mtl-centre-bell', name: 'Centre Bell', city_id: 'mtl', kind: 'arena', latitude: 45.4951, longitude: -73.5698 },
  { id: 'mtl-berri-uqam', name: 'Terminus Berri-UQAM', city_id: 'mtl', kind: 'transit', latitude: 45.5153, longitude: -73.559 },
  { id: 'mtl-chum', name: 'CHUM', city_id: 'mtl', kind: 'hospital', latitude: 45.5112, longitude: -73.5574 },
  { id: 'lng-terminus', name: 'Terminus Longueuil', city_id: 'lng', kind: 'transit', latitude: 45.524, longitude: -73.5215 },
  { id: 'lng-dix30', name: 'Quartier DIX30', city_id: 'lng', kind: 'mall', latitude: 45.4455, longitude: -73.435 },
  { id: 'lng-charles-le-moyne', name: 'Hôpital Charles-Le Moyne', city_id: 'lng', kind: 'hospital', latitude: 45.497, longitude: -73.4866 },
];

const KIND_TO_ZONE_TYPE: Record<TaxiHubKind, Zone['type']> = {
  airport: 'aéroport',
  transit: 'transport',
  hospital: 'médical',
  arena: 'événements',
  mall: 'commercial',
};

// Real `zones.type` values that count as a taxi hub on their own. Plain
// stations (`métro`) only count when they sit on a static hub (see below).
const HUB_ZONE_TYPES: readonly string[] = ['aéroport', 'transport', 'médical', 'événements'];

export const HUB_ZONE_MATCH_KM = 0.4;
const SCORE_INHERIT_MAX_KM = 3;
export const NEUTRAL_HUB_SCORE = 50;
export const EVENT_MAX_KM = 10;
export const EVENT_LEAD_MINUTES = 45;
// ESTIMATED: events sort first regardless; this only sets the badge value.
export const EVENT_PRIORITY_SCORE = 95;
const EVENT_DEDUPE_KM = 0.15;

const VIRTUAL_PREFIXES = ['taxi-hub:', 'taxi-evt:'] as const;

/** Ids that don't exist in `zones` (FK targets) — never send them to the DB. */
export function isVirtualTaxiId(id: string): boolean {
  return VIRTUAL_PREFIXES.some((p) => id.startsWith(p));
}

export type TaxiTier = 'event' | 'hub';

export type TaxiRecommendation = Zone & {
  score: number;
  distKm: number;
  taxiTier: TaxiTier;
  eventEndAt?: string;
};

interface Point {
  latitude: number;
  longitude: number;
}

interface BuildInput {
  zones: Zone[];
  scores: Map<string, number>;
  events: AppEvent[];
  now: Date;
  origin: Point;
}

type Scored = Zone & { score: number };

function virtualZone(
  id: string,
  name: string,
  cityId: string,
  type: Zone['type'],
  p: Point,
  score: number,
  now: Date,
  eventId: string | null
): Scored {
  const iso = now.toISOString();
  return {
    active_windows: [],
    address: null,
    base_score: score,
    category: 'taxi_hub',
    city_id: cityId,
    created_at: iso,
    current_score: score,
    event_id: eventId,
    id,
    is_temporal: eventId !== null,
    latitude: p.latitude,
    longitude: p.longitude,
    name,
    territory: null,
    type,
    updated_at: iso,
    score,
  };
}

function nearestScore(p: Point, zones: Zone[], scores: Map<string, number>): number {
  let best = NEUTRAL_HUB_SCORE;
  let bestDist = SCORE_INHERIT_MAX_KM;
  for (const z of zones) {
    const s = scores.get(z.id);
    if (s === undefined) continue;
    const d = haversineKm(p.latitude, p.longitude, z.latitude, z.longitude);
    if (d <= bestDist) {
      bestDist = d;
      best = s;
    }
  }
  return best;
}

function collectHubs({ zones, scores, now }: BuildInput): Scored[] {
  const real = zones.filter(
    (z) =>
      HUB_ZONE_TYPES.includes(z.type) ||
      TAXI_HUBS.some(
        (h) => haversineKm(h.latitude, h.longitude, z.latitude, z.longitude) <= HUB_ZONE_MATCH_KM
      )
  );
  const hubs: Scored[] = real.map((z) => ({ ...z, score: scores.get(z.id) ?? 0 }));
  for (const h of TAXI_HUBS) {
    const covered = real.some(
      (z) => haversineKm(h.latitude, h.longitude, z.latitude, z.longitude) <= HUB_ZONE_MATCH_KM
    );
    if (covered) continue;
    hubs.push(
      virtualZone(
        `taxi-hub:${h.id}`,
        h.name,
        h.city_id,
        KIND_TO_ZONE_TYPE[h.kind],
        h,
        nearestScore(h, zones, scores),
        now,
        null
      )
    );
  }
  return hubs;
}

// Repeated alerts for the same place (e.g. one "Retard majeur" row per
// transit delay) collapse into the one ending last.
function dedupeEvents(events: AppEvent[]): AppEvent[] {
  const kept: AppEvent[] = [];
  for (const e of events) {
    const i = kept.findIndex(
      (k) => haversineKm(k.latitude, k.longitude, e.latitude, e.longitude) <= EVENT_DEDUPE_KM
    );
    const prev = kept[i];
    if (prev === undefined) kept.push(e);
    else if (new Date(e.end_at).getTime() > new Date(prev.end_at).getTime()) kept[i] = e;
  }
  return kept;
}

function eventLabel(e: AppEvent): string {
  return e.venue && !e.name.includes(e.venue) ? `${e.venue} — ${e.name}` : e.name;
}

/** Badge payload for an event row (same shape the Drive hero already reads). */
export function taxiEventBadge(
  zone: { name: string; taxiTier?: TaxiTier; eventEndAt?: string }
): { name: string; end_at: string } | undefined {
  return zone.taxiTier === 'event' && zone.eventEndAt
    ? { name: zone.name, end_at: zone.eventEndAt }
    : undefined;
}

interface EventRow {
  row: TaxiRecommendation;
  consumedHubId: string | null;
}

// A real hub zone lends its id (FK-safe, factors/badges keep working); any
// other case is a virtual row anchored on the hub's or the event's point.
function eventBase(e: AppEvent, hub: Scored | undefined, point: Point, now: Date): Scored {
  if (hub && !isVirtualTaxiId(hub.id)) return hub;
  return virtualZone(
    `taxi-evt:${e.id}`,
    hub ? hub.name : eventLabel(e),
    hub ? hub.city_id : e.city_id,
    hub ? hub.type : 'événements',
    point,
    EVENT_PRIORITY_SCORE,
    now,
    e.id
  );
}

// One event -> one row. A hub within 400 m lends its exact coordinates and
// name (a taxi-stand point rather than a generic street point).
function toEventRow(
  e: AppEvent,
  hubs: Scored[],
  { origin, now }: BuildInput
): EventRow | null {
  const hub = hubs.find(
    (h) => haversineKm(h.latitude, h.longitude, e.latitude, e.longitude) <= HUB_ZONE_MATCH_KM
  );
  const point: Point = hub ?? e;
  const distKm = haversineKm(origin.latitude, origin.longitude, point.latitude, point.longitude);
  if (distKm > EVENT_MAX_KM) return null;
  const base = eventBase(e, hub, point, now);
  return {
    consumedHubId: hub ? hub.id : null,
    row: {
      ...base,
      name: hub ? `${hub.name} — ${e.name}` : eventLabel(e),
      score: Math.max(base.score, EVENT_PRIORITY_SCORE),
      distKm,
      taxiTier: 'event',
      eventEndAt: e.end_at,
    },
  };
}

/**
 * Taxi-only recommendations: hubs (real zones of hub type + the static hub
 * list) and events in progress or starting within 45 min. Events come first.
 */
export function buildTaxiRecommendations(input: BuildInput): TaxiRecommendation[] {
  const { origin, now, events } = input;
  const hubs = collectHubs(input);

  const live = dedupeEvents(
    [...getActiveEvents(events, now), ...getStartingSoonEvents(events, now, EVENT_LEAD_MINUTES)]
      .filter((e) => !e.is_holiday && e.capacity > 0)
  );
  const built = live.flatMap((e) => toEventRow(e, hubs, input) ?? []);
  const consumed = new Set(built.flatMap((b) => b.consumedHubId ?? []));
  const eventRows = built.map((b) => b.row).sort((a, b) => a.distKm - b.distKm);

  const hubRows = rankByProximityPenalizedScore(
    origin.latitude,
    origin.longitude,
    hubs.filter((h) => !consumed.has(h.id)),
    MAX_HERO_ZONE_DISTANCE_KM,
    DISTANCE_PENALTY_PER_KM
  ).map((z): TaxiRecommendation => ({ ...z, taxiTier: 'hub' }));

  return [...eventRows, ...hubRows];
}
