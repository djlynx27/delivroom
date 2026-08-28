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

  const originVec: Vec2 = { x: 0, y: 0 };
  const destVec = toLocalKm(origin, destination);
  const routeLenKm = distanceKm(originVec, destVec);
  if (routeLenKm === 0) return [];

  type Scored = { zone: RouteCandidateZone; vec: Vec2; t: number };

  const maxSingleDetourKm = routeLenKm * MAX_SINGLE_WAYPOINT_DETOUR_RATIO;

  // Bad seed data (null/NaN lat-lng) must never reach the corridor math —
  // it silently coerces (null - n = -n) into a bogus-but-finite point
  // instead of throwing, so it can slip through and reach Mapbox as a
  // malformed coordinate. Drop it here, before any math touches it.
  const inCorridor: Scored[] = candidates
    .filter((zone) => zone.id !== destinationId)
    .filter((zone) => hasFiniteCoordinates(zone))
    .filter(isHubZone)
    .map((zone) => {
      const vec = toLocalKm(origin, { lat: zone.latitude, lng: zone.longitude });
      // Perpendicular distance from the infinite origin→destination line.
      const cross = destVec.x * vec.y - destVec.y * vec.x;
      const perpKm = Math.abs(cross) / routeLenKm;
      const t = (vec.x * destVec.x + vec.y * destVec.y) / (routeLenKm * routeLenKm);
      return { zone, vec, t, perpKm } as Scored & { perpKm: number };
    })
    .filter((c) => (c as Scored & { perpKm: number }).perpKm <= corridorBufferKm)
    // Anti-backtrack: a candidate whose projection falls behind the origin
    // (t < 0) or past the destination (t > 1) forces a doubling-back zigzag
    // even when its insertion cost is small (e.g. 500 m behind the origin on
    // a 10 km trip). Only keep points that lie between the endpoints.
    .filter((c) => c.t >= 0 && c.t <= 1)
    // Per-waypoint incremental detour: reject a candidate that alone would
    // stretch the trip more than MAX_SINGLE_WAYPOINT_DETOUR_RATIO, even if
    // combining it with others would still pass the overall maxDetourRatio.
    .filter((c) => {
      const insertionCostKm =
        distanceKm(originVec, c.vec) + distanceKm(c.vec, destVec) - routeLenKm;
      return insertionCostKm <= maxSingleDetourKm;
    });

  let selected = [...inCorridor]
    .sort((a, b) => b.zone.score - a.zone.score)
    .slice(0, maxWaypoints);

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
    return orderedByRoute(selected).map((s) => s.zone);
  }

  // No real high-demand zone qualified (empty candidate list, or none within
  // the corridor / detour budget) — prospection mode must still diverge from
  // the direct route, so sweep a nearby boulevard instead of silently
  // collapsing to the same line.
  return resolvePatrolFallback(origin, destVec, routeLenKm, maxDetourRatio);
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
