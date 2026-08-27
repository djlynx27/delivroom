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

  return orderedByRoute(selected).map((s) => s.zone);
}
