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

export type TaxiHubKind = 'airport' | 'transit' | 'hospital' | 'arena' | 'mall' | 'hotel' | 'tourism';

/** Official Ville de Montréal taxi stand (open data `postestaxi`, 2026-09). */
export interface TaxiStand {
  code: string;
  kind: 'Public' | 'En commun' | 'Privé';
  places: number;
  address: string;
  /** Operating window [fromHour, toHour) in Toronto time; absent = 24/7. */
  window?: readonly [number, number];
}

export interface TaxiHub {
  id: string;
  name: string;
  city_id: 'mtl' | 'lvl' | 'lng';
  kind: TaxiHubKind;
  latitude: number;
  longitude: number;
  /** Set when latitude/longitude ARE an official stand's coordinates. */
  stand?: TaxiStand;
}

// Laval/Longueuil hubs: coordinates verified against the official GTFS stops
// (STL, RTL, exo; 2026-10-12) — the driver's original values were 0.9-5.8 km
// off for Cartier, Le Carrefour, Sainte-Dorothée, Charles-Le Moyne, Longueuil.
// No official stand claim there: the Ville de Montréal dataset covers the
// island only.
// Montréal hubs (`stand`): the 15 posts of postestaxi.geojson (2026-09) the
// driver selected — coordinates, places, type and hours checked against the
// file (0 m delta). Excluded: 9-933 (1 place), and the duplicate Mansfield row.
// Only data from the file is kept; hand-written access rules and "optimal
// windows" from the source brief are not verifiable and are deliberately left out.
export const TAXI_HUBS: readonly TaxiHub[] = [
  { id: 'lvl-carrefour', name: 'Terminus Le Carrefour', city_id: 'lvl', kind: 'transit', latitude: 45.5686, longitude: -73.7484 },
  { id: 'lvl-montmorency', name: 'Métro Montmorency', city_id: 'lvl', kind: 'transit', latitude: 45.5583, longitude: -73.721 },
  { id: 'lvl-place-bell', name: 'Place Bell', city_id: 'lvl', kind: 'arena', latitude: 45.5559, longitude: -73.7231 },
  { id: 'lvl-cartier', name: 'Métro Cartier', city_id: 'lvl', kind: 'transit', latitude: 45.5598, longitude: -73.6826 },
  { id: 'lvl-rem-ste-dorothee', name: 'REM Sainte-Dorothée', city_id: 'lvl', kind: 'transit', latitude: 45.5233, longitude: -73.8617 },
  { id: 'mtl-yul', name: 'Aéroport YUL (bassin taxis)', city_id: 'mtl', kind: 'airport', latitude: 45.45603, longitude: -73.746683, stand: { code: '5-35', kind: 'Privé', places: 400, address: '975 boul. Roméo-Vachon, ligne et bassin Taxis et Limousines' } },
  { id: 'mtl-gare-centrale-privee', name: 'Gare Centrale (poste privé Taxelco)', city_id: 'mtl', kind: 'transit', latitude: 45.499968, longitude: -73.566249, stand: { code: '20-437', kind: 'Privé', places: 12, address: '895 De la Gauchetière O, poste privé de Taxelco' } },
  { id: 'mtl-mansfield', name: 'Gare Centrale / hôtels — Mansfield (20-696)', city_id: 'mtl', kind: 'hotel', latitude: 45.49987, longitude: -73.568365, stand: { code: '20-696', kind: 'Public', places: 15, address: 'rue Mansfield / boul. René-Lévesque O' } },
  { id: 'mtl-bonaventure', name: 'Hôtel Bonaventure — Mansfield (20-446)', city_id: 'mtl', kind: 'hotel', latitude: 45.498989, longitude: -73.566444, stand: { code: '20-446', kind: 'Public', places: 6, address: 'rue Mansfield / rue De la Gauchetière O' } },
  { id: 'mtl-berri-uqam', name: 'Terminus Berri-UQAM (21-402)', city_id: 'mtl', kind: 'transit', latitude: 45.515356, longitude: -73.558753, stand: { code: '21-402', kind: 'Public', places: 6, address: 'rue Saint-Hubert / rue Sainte-Catherine E' } },
  { id: 'mtl-chum', name: 'CHUM (21-911)', city_id: 'mtl', kind: 'hospital', latitude: 45.511015, longitude: -73.557669, stand: { code: '21-911', kind: 'Public', places: 11, address: "rue Sanguinet / rue De la Gauchetière E (poste d'attente du CHUM)" } },
  { id: 'mtl-cusm-glen', name: 'CUSM Glen (9-931)', city_id: 'mtl', kind: 'hospital', latitude: 45.47162, longitude: -73.601711, stand: { code: '9-931', kind: 'En commun', places: 14, address: '1001 Décarie, réserve' } },
  { id: 'mtl-hgm', name: 'Hôpital général de Montréal (20-609)', city_id: 'mtl', kind: 'hospital', latitude: 45.496623, longitude: -73.590408, stand: { code: '20-609', kind: 'Public', places: 5, address: '1650 Cedar' } },
  { id: 'mtl-hgj', name: 'Hôpital général juif (26-898)', city_id: 'mtl', kind: 'hospital', latitude: 45.496632, longitude: -73.630321, stand: { code: '26-898', kind: 'Public', places: 6, address: '5767 Légaré' } },
  { id: 'mtl-vieux-notre-dame', name: 'Vieux-Montréal — Notre-Dame (21-404)', city_id: 'mtl', kind: 'tourism', latitude: 45.506218, longitude: -73.555537, stand: { code: '21-404', kind: 'Public', places: 4, address: 'boul. Saint-Laurent / rue Notre-Dame E' } },
  { id: 'mtl-vieux-saint-paul', name: 'Vieux-Montréal — Saint-Paul (21-403, 18h-minuit)', city_id: 'mtl', kind: 'tourism', latitude: 45.505584, longitude: -73.553639, stand: { code: '21-403', kind: 'Public', places: 5, address: 'boul. Saint-Laurent / rue Saint-Paul', window: [18, 24] } },
  { id: 'mtl-centre-bell', name: 'Centre Bell (20-681)', city_id: 'mtl', kind: 'arena', latitude: 45.495698, longitude: -73.572919, stand: { code: '20-681', kind: 'Public', places: 3, address: "boul. René-Lévesque O / rue Lucien-L'Allier" } },
  { id: 'mtl-place-des-arts', name: 'Place des Arts (21-785)', city_id: 'mtl', kind: 'arena', latitude: 45.508274, longitude: -73.563852, stand: { code: '21-785', kind: 'Public', places: 5, address: 'rue Saint-Urbain / rue Sainte-Catherine O' } },
  { id: 'mtl-casino-parc', name: 'Casino / Parc Jean-Drapeau (21-387)', city_id: 'mtl', kind: 'tourism', latitude: 45.505654, longitude: -73.52579, stand: { code: '21-387', kind: 'Public', places: 3, address: '1 avenue du Casino' } },
  { id: 'mtl-casino-reserve', name: 'Casino de Montréal — réserve (21-394)', city_id: 'mtl', kind: 'tourism', latitude: 45.507075, longitude: -73.524621, stand: { code: '21-394', kind: 'En commun', places: 18, address: 'Casino de Montréal, réserve au sud-est' } },
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
  hotel: 'tourisme',
  tourism: 'tourisme',
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

// Private company posts are never recommended, except the airport line (the
// only official YUL option): it still needs the driver's own YUL authorization.
// ESTIMATED policy — adjust per driver.
export const PRIVATE_STAND_ALLOWLIST: readonly string[] = ['5-35'];

const TORONTO_HOUR = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'America/Toronto',
  hour: '2-digit',
  hourCycle: 'h23',
});

function isInWindow(hour: number, [from, to]: readonly [number, number]): boolean {
  return from <= to ? hour >= from && hour < to : hour >= from || hour < to;
}

/** Whether a driver can actually use this hub right now (stand rules). */
export function isHubUsable(hub: TaxiHub, now: Date): boolean {
  const { stand } = hub;
  if (!stand) return true;
  if (stand.kind === 'Privé' && !PRIVATE_STAND_ALLOWLIST.includes(stand.code)) return false;
  return stand.window ? isInWindow(Number(TORONTO_HOUR.format(now)), stand.window) : true;
}

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

// Closest item within the match radius (the nearest wins, not the first in
// list order: e.g. Centre Bell over the Bonaventure post for an arena event).
function nearestWithin<T extends Point>(p: Point, items: T[]): T | undefined {
  let best: T | undefined;
  let bestDist = HUB_ZONE_MATCH_KM;
  for (const it of items) {
    const d = haversineKm(it.latitude, it.longitude, p.latitude, p.longitude);
    if (d <= bestDist) {
      bestDist = d;
      best = it;
    }
  }
  return best;
}

function collectHubs({ zones, scores, now }: BuildInput): Scored[] {
  const staticHubs = TAXI_HUBS.filter((h) => isHubUsable(h, now));
  const real = zones.filter(
    (z) =>
      HUB_ZONE_TYPES.includes(z.type) ||
      staticHubs.some(
        (h) => haversineKm(h.latitude, h.longitude, z.latitude, z.longitude) <= HUB_ZONE_MATCH_KM
      )
  );
  // A real zone sitting on a stand-anchored hub keeps its id/score/name but
  // navigates to the official stand (no second row for the same place).
  const anchor = (z: Zone): Point =>
    nearestWithin(z, staticHubs.filter((h) => h.stand)) ?? z;
  const hubs: Scored[] = real.map((z) => {
    const { latitude, longitude } = anchor(z);
    return { ...z, latitude, longitude, score: scores.get(z.id) ?? 0 };
  });
  for (const h of staticHubs) {
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
  const hub = nearestWithin(e, hubs);
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
