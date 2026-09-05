/**
 * Inverse Proximity Spotter — micro-positioning within a hot zone.
 *
 * The zone-level score (scoringEngine.ts) already penalizes a zone that's
 * saturated with rival Lyft drivers (applyNearbyDriversCompetitionNudge),
 * but that only says "this zone is worse" — it doesn't say where *within*
 * the zone to actually park. This module answers that: given the 3x3
 * driver-density grid Gemini extracts from the "Nearby drivers" screenshot
 * (see supabase/functions/ingest-lyft-screenshots), it nudges the zone's
 * coordinate toward the sparsest cell.
 *
 * Deliberately a short tactical offset (50-150m), not a retreat into a side
 * street: the goal is an ETA to the zone's real pickups that's still
 * effectively identical, while not sitting inside the rival cluster and
 * keeping a clear, immediate way out.
 */

export const DRIVER_GRID_SIZE = 9;
export type DriverGrid = number[];

export const MIN_SPOT_OFFSET_METERS = 50;
export const MAX_SPOT_OFFSET_METERS = 150;
const DEFAULT_SPOT_OFFSET_METERS = 100; // midpoint

const EARTH_RADIUS_METERS = 6_371_000;

export interface GeoPoint {
  latitude: number;
  longitude: number;
}

export type Quadrant =
  | 'top_left' | 'top_center' | 'top_right'
  | 'middle_left' | 'center' | 'middle_right'
  | 'bottom_left' | 'bottom_center' | 'bottom_right';

// Row-major, matching the Gemini prompt in ingest-lyft-screenshots/index.ts.
const QUADRANT_LABELS: Quadrant[] = [
  'top_left', 'top_center', 'top_right',
  'middle_left', 'center', 'middle_right',
  'bottom_left', 'bottom_center', 'bottom_right',
];

// Compass bearing (0=N, 90=E, 180=S, 270=W) pointing from the map's center
// toward each grid cell. `center` has no direction of its own -- handled
// separately in computeMicroSpot.
const QUADRANT_BEARING_DEG: Record<Quadrant, number | null> = {
  top_left: 315,
  top_center: 0,
  top_right: 45,
  middle_left: 270,
  center: null,
  middle_right: 90,
  bottom_left: 225,
  bottom_center: 180,
  bottom_right: 135,
};

export interface MicroSpot extends GeoPoint {
  quadrant: Quadrant;
  bearingDeg: number | null;
  offsetMeters: number;
  driverCountInQuadrant: number;
}

/** True if `grid` is a usable 9-cell density grid (shape only -- values are
 * trusted as already-validated non-negative numbers by this point, since
 * the Edge Function's parseDriverGrid is the one real validation boundary). */
export function isValidDriverGrid(grid: unknown): grid is DriverGrid {
  return Array.isArray(grid) && grid.length === DRIVER_GRID_SIZE;
}

/**
 * Finds the least-dense cell in the grid. Ties resolve to the first cell in
 * row-major order (deterministic, not the "most central" or "most spread
 * out" cell — simplicity over a tie-break rule nothing has asked for yet).
 */
export function findQuietestQuadrant(grid: DriverGrid): {
  quadrant: Quadrant;
  index: number;
  count: number;
} {
  let bestIndex = 0;
  for (let i = 1; i < grid.length; i++) {
    if (grid[i] < grid[bestIndex]) bestIndex = i;
  }
  return { quadrant: QUADRANT_LABELS[bestIndex], index: bestIndex, count: grid[bestIndex] };
}

function clampOffsetMeters(distanceMeters: number): number {
  return Math.min(MAX_SPOT_OFFSET_METERS, Math.max(MIN_SPOT_OFFSET_METERS, distanceMeters));
}

/**
 * Standard equirectangular destination-point approximation: accurate to a
 * few centimeters at the distances this module deals with (tens to low
 * hundreds of meters), and far simpler than full great-circle math for a
 * case where that precision would be wasted anyway.
 */
export function offsetCoordinate(
  origin: GeoPoint,
  bearingDeg: number,
  distanceMeters: number
): GeoPoint {
  const bearingRad = (bearingDeg * Math.PI) / 180;
  const latRad = (origin.latitude * Math.PI) / 180;

  const dLat = (distanceMeters * Math.cos(bearingRad)) / EARTH_RADIUS_METERS;
  const dLng =
    (distanceMeters * Math.sin(bearingRad)) / (EARTH_RADIUS_METERS * Math.cos(latRad));

  return {
    latitude: origin.latitude + (dLat * 180) / Math.PI,
    longitude: origin.longitude + (dLng * 180) / Math.PI,
  };
}

/**
 * Computes the tactical micro-spot for a hot zone: a point 50-150m from the
 * zone's coordinate, offset toward the sparsest cell of the driver density
 * grid. Returns null when there's no usable grid (e.g. capture didn't
 * include spatial data) or the sparsest cell is the center -- already the
 * quietest spot, so the zone's own coordinate stands unmodified.
 */
export function computeMicroSpot(
  zoneCentroid: GeoPoint,
  grid: DriverGrid | null | undefined,
  offsetMeters: number = DEFAULT_SPOT_OFFSET_METERS
): MicroSpot | null {
  if (!isValidDriverGrid(grid)) return null;

  const { quadrant, count } = findQuietestQuadrant(grid);
  const bearingDeg = QUADRANT_BEARING_DEG[quadrant];
  if (bearingDeg === null) {
    return {
      ...zoneCentroid,
      quadrant,
      bearingDeg: null,
      offsetMeters: 0,
      driverCountInQuadrant: count,
    };
  }

  const distance = clampOffsetMeters(offsetMeters);
  const point = offsetCoordinate(zoneCentroid, bearingDeg, distance);
  return {
    ...point,
    quadrant,
    bearingDeg,
    offsetMeters: distance,
    driverCountInQuadrant: count,
  };
}
