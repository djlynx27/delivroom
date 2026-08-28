import { hasFiniteCoordinates } from '@/lib/demandUtils';
import type { RouteCandidateZone, RoutePoint } from './types';

// Equirectangular approximation — good enough at city scale (a few km) and
// keeps the corridor-projection math (below) and the distance math in the
// same coordinate system, so the detour-ratio comparison stays consistent.
const KM_PER_DEG_LAT = 110.574;
function kmPerDegLng(lat: number) {
  return 111.32 * Math.cos((lat * Math.PI) / 180);
}

interface Vec2 {
  x: number;
  y: number;
}

function toLocalKm(origin: RoutePoint, point: RoutePoint): Vec2 {
  return {
    x: (point.lng - origin.lng) * kmPerDegLng(origin.lat),
    y: (point.lat - origin.lat) * KM_PER_DEG_LAT,
  };
}

function fromLocalKm(origin: RoutePoint, vec: Vec2): RoutePoint {
  return {
    lat: origin.lat + vec.y / KM_PER_DEG_LAT,
    lng: origin.lng + vec.x / kmPerDegLng(origin.lat),
  };
}

function distanceKm(a: Vec2, b: Vec2): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

export interface WaypointSelectionOptions {
  /** Max waypoints to keep, ranked by score. Default 3 — Mapbox Directions
   * caps total coordinates at 25, and a tight detour reads better anyway. */
  maxWaypoints?: number;
  /** Perpendicular distance (km) from the origin→destination line a candidate may sit. Default 2. */
  corridorBufferKm?: number;
  /** Detour cap vs the direct distance, e.g. 1.2 = +20%. Default 1.2. */
  maxDetourRatio?: number;
  /** Exclude a candidate matching this id (typically the destination zone itself). */
  destinationId?: string;
}

// High-traffic hubs worth a prospection detour — transit stations, malls,
// airports, hotel/tourism districts. Deliberately excludes zone types that
// read as small/local rather than a real hub a rider would actually be
// heading to or from (résidentiel, nightlife, université, médical,
// événements) — the isolated-hairdresser/corner-store problem the ticket
// describes, one level up at the zone-category granularity this catalog
// actually has (individual businesses aren't in the zones table).
const HUB_ZONE_TYPES = new Set(['transport', 'métro', 'aéroport', 'commercial', 'tourisme']);

// An untyped zone can't be verified as a real hub — treating "unknown" as
// "allowed" is exactly how an isolated business (e.g. a promoted
// zone-discovery entry with no type set, like "Nan Hair Stylist") slipped
// through as a prospection waypoint. Reject anything not explicitly typed.
// The synthetic patrol-sweep waypoint (buildPatrolWaypoint) never passes
// through this filter — it's the fallback path's own return value, not a
// `candidates` entry — so it's unaffected by this being strict.
function isHubZone(zone: RouteCandidateZone): boolean {
  return zone.type !== undefined && HUB_ZONE_TYPES.has(zone.type);
}

/** Per-waypoint incremental detour: how much longer the trip gets from
 * inserting just this one zone, as a share of the direct distance. Catches
 * a candidate that individually detours too much even when the *combined*
 * path with other waypoints would still clear maxDetourRatio. */
const MAX_SINGLE_WAYPOINT_DETOUR_RATIO = 0.15;

// A hub sitting right on top of the destination (e.g. Gare Centrale, ~430 m
// from Centre Bell) passes every other filter — tiny insertion cost, t≈1,
// small perpendicular offset — and gets inserted as the last waypoint,
// immediately before the destination. Google Maps then renders that
// waypoint's name as the prominent "next stop" and the actual destination
// reads as lost/wrong. Reject anything this close to the destination; it
// adds no real detour value anyway. Deliberately NOT applied to the origin
// side — a candidate near the origin is exactly what getReturnCorridor
// (scoringEngine.ts) wants when suggesting the nearest reachable zone.
const MIN_DESTINATION_DISTANCE_KM = 0.5;

// Under 5km, a 2km-wide corridor buffer is most of the trip's own length —
// real downtown grids (one-way streets, the Ville-Marie tunnel) turn a
// Euclidean-close "on the corridor" candidate into a genuine multi-km
// zigzag once Mapbox snaps it to real roads (the Place Dupuis -> Centre
// Bell report: 2.5km direct became a 5.3km loop). Straight-line geometry
// can't see the road network, so the only reliable guard on a short trip is
// to tighten what qualifies at all: a much narrower corridor and at most
// one waypoint.
const SHORT_TRIP_KM = 5;
const SHORT_TRIP_MAX_WAYPOINTS = 1;
const SHORT_TRIP_CORRIDOR_BUFFER_KM = 0.3;

type Scored = { zone: RouteCandidateZone; vec: Vec2; t: number };

// One row per evaluated candidate — printed as a console.table so a bad
// prospection route can be diagnosed from the exact numbers instead of
// guessing. Deliberately plain console (not `logger`): logger.debug is
// stripped in production and logger's Sentry transport redacts lat/lng as
// PII, both of which would hide the very values this is for. Stays local to
// the device either way — never transmitted.
interface CandidateEvaluation {
  id: string;
  name: string;
  type: string | undefined;
  isHub: boolean;
  score: number;
  perpKm: number | null;
  t: number | null;
  insertionCostKm: number | null;
  distToDestKm: number | null;
  accepted: boolean;
  reason: string;
}

/** console.table row — same fields as CandidateEvaluation, minus the
 * internal `vec` (a Vec2 object prints unreadably in a table). */
function toTableRow(e: CandidateEvaluation & { vec: Vec2 | null }) {
  return {
    id: e.id,
    name: e.name,
    type: e.type,
    isHub: e.isHub,
    score: e.score,
    perpKm: e.perpKm,
    t: e.t,
    insertionCostKm: e.insertionCostKm,
    distToDestKm: e.distToDestKm,
    accepted: e.accepted,
    reason: e.reason,
  };
}

function describeNonHubReason(type: string | undefined): string {
  return type === undefined ? 'no type (unverifiable)' : `type "${type}" is not a hub`;
}

function describeBacktrackReason(t: number): string | null {
  if (t < 0) return 'projects behind origin (backtrack)';
  if (t > 1) return 'projects past destination (overshoot)';
  return null;
}

function evaluateCandidate(
  zone: RouteCandidateZone,
  origin: RoutePoint,
  originVec: Vec2,
  destVec: Vec2,
  routeLenKm: number,
  corridorBufferKm: number,
  maxSingleDetourKm: number,
  destinationId: string | undefined
): CandidateEvaluation & { vec: Vec2 | null } {
  const base = {
    id: zone.id,
    name: zone.name,
    type: zone.type,
    isHub: isHubZone(zone),
    score: zone.score,
    perpKm: null,
    t: null,
    insertionCostKm: null,
    distToDestKm: null,
    vec: null,
  };

  if (zone.id === destinationId) {
    return { ...base, accepted: false, reason: 'is the destination itself' };
  }
  // Bad seed data (null/NaN lat-lng) must never reach the corridor math — it
  // silently coerces (null - n = -n) into a bogus-but-finite point instead
  // of throwing, so it can slip through and reach Mapbox as a malformed
  // coordinate. Reject here, before any math touches it.
  if (!hasFiniteCoordinates(zone)) {
    return { ...base, accepted: false, reason: 'invalid/missing coordinates' };
  }
  // An untyped or non-hub zone can't be verified as a real hub (see
  // isHubZone) — reject before computing any geometry for it.
  if (!base.isHub) {
    return { ...base, accepted: false, reason: describeNonHubReason(zone.type) };
  }

  const vec = toLocalKm(origin, { lat: zone.latitude, lng: zone.longitude });
  const cross = destVec.x * vec.y - destVec.y * vec.x;
  const perpKm = Math.abs(cross) / routeLenKm;
  const t = (vec.x * destVec.x + vec.y * destVec.y) / (routeLenKm * routeLenKm);
  const distToDestKm = distanceKm(vec, destVec);
  const insertionCostKm = distanceKm(originVec, vec) + distToDestKm - routeLenKm;
  const withGeometry = { ...base, vec, perpKm, t, insertionCostKm, distToDestKm };

  if (perpKm > corridorBufferKm) {
    return { ...withGeometry, accepted: false, reason: `${perpKm.toFixed(2)}km off the corridor axis (max ${corridorBufferKm}km)` };
  }
  if (distToDestKm < MIN_DESTINATION_DISTANCE_KM) {
    return { ...withGeometry, accepted: false, reason: `only ${(distToDestKm * 1000).toFixed(0)}m from destination (min ${MIN_DESTINATION_DISTANCE_KM * 1000}m)` };
  }
  // Anti-backtrack: a projection behind the origin (t<0) or past the
  // destination (t>1) forces a doubling-back zigzag even when its insertion
  // cost is small (e.g. 500m behind the origin on a 10km trip).
  const backtrackReason = describeBacktrackReason(t);
  if (backtrackReason) {
    return { ...withGeometry, accepted: false, reason: backtrackReason };
  }
  if (insertionCostKm > maxSingleDetourKm) {
    // Per-waypoint incremental detour: reject a candidate that alone would
    // stretch the trip more than MAX_SINGLE_WAYPOINT_DETOUR_RATIO, even if
    // combining it with others would still pass the overall maxDetourRatio.
    return { ...withGeometry, accepted: false, reason: `+${insertionCostKm.toFixed(2)}km detour alone (max ${maxSingleDetourKm.toFixed(2)}km)` };
  }
  return { ...withGeometry, accepted: true, reason: 'accepted — in corridor, within detour budget' };
}

function applyShortTripCaps(
  routeLenKm: number,
  maxWaypoints: number,
  corridorBufferKm: number
): { maxWaypoints: number; corridorBufferKm: number } {
  if (routeLenKm >= SHORT_TRIP_KM) return { maxWaypoints, corridorBufferKm };
  const capped = {
    maxWaypoints: Math.min(maxWaypoints, SHORT_TRIP_MAX_WAYPOINTS),
    corridorBufferKm: Math.min(corridorBufferKm, SHORT_TRIP_CORRIDOR_BUFFER_KM),
  };
  console.log(
    `[waypointSelector] short trip (${routeLenKm.toFixed(2)}km < ${SHORT_TRIP_KM}km): ` +
      `capping to ${capped.maxWaypoints} waypoint(s), corridor buffer ${capped.corridorBufferKm}km`
  );
  return capped;
}

/**
 * Picks the highest-demand zones that sit close to the driver's straight-line
 * path to `destination`, ordered along the route, trimmed so the resulting
 * detour never exceeds `maxDetourRatio` of the direct distance.
 */
export function selectProspectionWaypoints(
  origin: RoutePoint,
  destination: RoutePoint,
  candidates: RouteCandidateZone[],
  options: WaypointSelectionOptions = {}
): RouteCandidateZone[] {
  const {
    maxWaypoints = 3,
    corridorBufferKm = 2,
    maxDetourRatio = 1.2,
    destinationId,
  } = options;

  console.log('[waypointSelector] origin:', origin, 'destination:', destination);

  const originVec: Vec2 = { x: 0, y: 0 };
  const destVec = toLocalKm(origin, destination);
  const routeLenKm = distanceKm(originVec, destVec);
  if (routeLenKm === 0) return [];

  const { maxWaypoints: effectiveMaxWaypoints, corridorBufferKm: effectiveCorridorBufferKm } =
    applyShortTripCaps(routeLenKm, maxWaypoints, corridorBufferKm);

  const maxSingleDetourKm = routeLenKm * MAX_SINGLE_WAYPOINT_DETOUR_RATIO;

  const evaluations = candidates.map((zone) =>
    evaluateCandidate(
      zone,
      origin,
      originVec,
      destVec,
      routeLenKm,
      effectiveCorridorBufferKm,
      maxSingleDetourKm,
      destinationId
    )
  );
  console.log(`[waypointSelector] evaluated ${evaluations.length} candidate(s) (routeLenKm=${routeLenKm.toFixed(2)}):`);
  console.table(evaluations.map(toTableRow));

  const inCorridor: Scored[] = evaluations
    .filter((e): e is CandidateEvaluation & { vec: Vec2; t: number; accepted: true } => e.accepted && e.vec !== null)
    .map((e) => ({
      zone: candidates.find((c) => c.id === e.id)!,
      vec: e.vec,
      t: e.t,
    }));

  let selected = [...inCorridor]
    .sort((a, b) => b.zone.score - a.zone.score)
    .slice(0, effectiveMaxWaypoints);

  function pathLengthKm(ordered: Scored[]): number {
    const points = [originVec, ...ordered.map((s) => s.vec), destVec];
    let total = 0;
    for (let i = 1; i < points.length; i++) {
      total += distanceKm(points[i - 1], points[i]);
    }
    return total;
  }

  function orderedByRoute(items: Scored[]): Scored[] {
    return [...items].sort((a, b) => a.t - b.t);
  }

  const maxPathKm = routeLenKm * maxDetourRatio;
  while (selected.length > 0 && pathLengthKm(orderedByRoute(selected)) > maxPathKm) {
    const worst = selected.reduce((min, s) =>
      s.zone.score < min.zone.score ? s : min
    );
    selected = selected.filter((s) => s !== worst);
  }

  if (selected.length > 0) {
    const finalWaypoints = orderedByRoute(selected).map((s) => s.zone);
    console.log(
      '[waypointSelector] final waypoints (ordered):',
      finalWaypoints.map((z) => `${z.name} (${z.id})`)
    );
    return finalWaypoints;
  }

  // No real high-demand zone qualified (empty candidate list, or none within
  // the corridor / detour budget) — prospection mode must still diverge from
  // the direct route, so sweep a nearby boulevard instead of silently
  // collapsing to the same line.
  const patrol = resolvePatrolFallback(origin, destVec, routeLenKm, maxDetourRatio);
  const patrolPoint = patrol[0];
  console.log(
    '[waypointSelector] final waypoints: none qualified — patrol-sweep fallback:',
    patrolPoint ? `${patrolPoint.latitude},${patrolPoint.longitude}` : '(none, route too short)'
  );
  return patrol;
}

function resolvePatrolFallback(
  origin: RoutePoint,
  destVec: Vec2,
  routeLenKm: number,
  maxDetourRatio: number
): RouteCandidateZone[] {
  // Below ~1.5 km a sweep isn't worth the fuel: road snapping amplifies a
  // small straight-line offset into a disproportionate real-world loop (the
  // 2.3 km-direct-trip-turned-10 km Montmorency case). Short hop → direct.
  if (routeLenKm < 1.5) return [];
  const patrol = buildPatrolWaypoint(origin, destVec, routeLenKm, maxDetourRatio);
  return patrol ? [patrol] : [];
}

/**
 * Synthesizes a single off-route point near the route's midpoint so the
 * Directions API is forced through nearby streets instead of retracing the
 * direct line. Not a real zone — Mapbox snaps it to the closest road, which
 * is enough to produce a genuine "patrol the neighbouring boulevard" detour.
 */
function buildPatrolWaypoint(
  origin: RoutePoint,
  destVec: Vec2,
  routeLenKm: number,
  maxDetourRatio: number
): RouteCandidateZone | null {
  const midpoint: Vec2 = { x: destVec.x / 2, y: destVec.y / 2 };
  // Perpendicular unit vector to the route direction.
  const perp = { x: -destVec.y / routeLenKm, y: destVec.x / routeLenKm };

  // Budget the sweep so the round trip through the offset point stays within
  // the detour cap: 2 legs of ~sqrt((routeLenKm/2)^2 + offset^2) vs routeLenKm.
  const maxRoundTripKm = routeLenKm * maxDetourRatio;
  const halfRouteKm = routeLenKm / 2;
  const maxOffsetKm = Math.sqrt(
    Math.max(0, (maxRoundTripKm / 2) ** 2 - halfRouteKm ** 2)
  );
  // ponytail: straight-line geometry underestimates road distance — the 1.0 km
  // hard cap (down from 1.5) absorbs that amplification; a road-network-aware
  // budget would need a Directions round-trip this sync path can't afford.
  const offsetKm = Math.min(maxOffsetKm, 1.0, routeLenKm * 0.25);
  if (offsetKm < 0.15) return null;

  const sweepVec: Vec2 = {
    x: midpoint.x + perp.x * offsetKm,
    y: midpoint.y + perp.y * offsetKm,
  };
  const point = fromLocalKm(origin, sweepVec);

  return {
    id: 'patrol-sweep',
    name: 'Boulevard voisin',
    latitude: point.lat,
    longitude: point.lng,
    score: 0,
  };
}
