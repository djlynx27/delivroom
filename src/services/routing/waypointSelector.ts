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
  /** Max waypoints to keep, ranked by score. Default 5 (spec target: 3-5). */
  maxWaypoints?: number;
  /** Perpendicular distance (km) from the origin→destination line a candidate may sit. Default 2. */
  corridorBufferKm?: number;
  /** Detour cap vs the direct distance, e.g. 1.5 = +50%. Default 1.5. */
  maxDetourRatio?: number;
  /** Exclude a candidate matching this id (typically the destination zone itself). */
  destinationId?: string;
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
    maxWaypoints = 5,
    corridorBufferKm = 2,
    maxDetourRatio = 1.5,
    destinationId,
  } = options;

  const originVec: Vec2 = { x: 0, y: 0 };
  const destVec = toLocalKm(origin, destination);
  const routeLenKm = distanceKm(originVec, destVec);
  if (routeLenKm === 0) return [];

  type Scored = { zone: RouteCandidateZone; vec: Vec2; t: number };

  const inCorridor: Scored[] = candidates
    .filter((zone) => zone.id !== destinationId)
    .map((zone) => {
      const vec = toLocalKm(origin, { lat: zone.latitude, lng: zone.longitude });
      // Perpendicular distance from the infinite origin→destination line.
      const cross = destVec.x * vec.y - destVec.y * vec.x;
      const perpKm = Math.abs(cross) / routeLenKm;
      const t = (vec.x * destVec.x + vec.y * destVec.y) / (routeLenKm * routeLenKm);
      return { zone, vec, t, perpKm } as Scored & { perpKm: number };
    })
    .filter((c) => (c as Scored & { perpKm: number }).perpKm <= corridorBufferKm);

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
  // Below ~600 m there's no room to loop.
  if (routeLenKm < 0.6) return [];
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
  const offsetKm = Math.min(maxOffsetKm, 1.5, routeLenKm * 0.35);
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
