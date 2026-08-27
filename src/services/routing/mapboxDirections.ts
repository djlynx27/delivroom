import type { DriveRouteResult, RoutePoint } from './types';

// Read at call time (not module scope) so tests can stub the env var between
// cases without needing to re-import the module.
function getMapboxToken(): string | undefined {
  return import.meta.env.VITE_MAPBOX_TOKEN as string | undefined;
}

interface DirectionsApiRoute {
  geometry: { type: 'LineString'; coordinates: [number, number][] };
  distance: number; // meters
  duration: number; // seconds
}

// Mapbox Directions caps total coordinates (origin + waypoints + destination)
// at 25 for every driving profile — a request over that limit is rejected
// outright (422) instead of being truncated server-side.
export const MAX_ROUTE_COORDINATES = 25;

function isFinitePoint(p: RoutePoint): boolean {
  return Number.isFinite(p.lat) && Number.isFinite(p.lng);
}

/**
 * Drops any point with non-finite/null coordinates and caps the list at the
 * Directions API's 25-coordinate limit, always keeping origin and
 * destination. Bad seed data or an oversized waypoint list must never reach
 * the API as a malformed request — that 422s and looks like an outage
 * instead of the data problem it actually is.
 */
export function sanitizeRoutePoints(points: RoutePoint[]): RoutePoint[] {
  const clean = points.filter(isFinitePoint);
  if (clean.length <= MAX_ROUTE_COORDINATES) return clean;

  const [origin, ...rest] = clean;
  const destination = rest.pop();
  const middle = rest.slice(0, MAX_ROUTE_COORDINATES - 2);
  return destination ? [origin, ...middle, destination] : [origin, ...middle];
}

async function requestDirections(
  url: string,
  signal: AbortSignal | undefined,
  notFoundMessage: string
): Promise<Pick<DriveRouteResult, 'geometry' | 'distanceKm' | 'durationMin'>> {
  const response = await fetch(url, { signal });
  if (!response.ok) {
    throw new Error(`Directions request failed (${response.status})`);
  }

  const payload = (await response.json()) as { routes?: DirectionsApiRoute[] };
  const route = payload.routes?.[0];
  if (!route) {
    throw new Error(notFoundMessage);
  }

  return {
    geometry: route.geometry,
    distanceKm: route.distance / 1000,
    durationMin: route.duration / 60,
  };
}

/**
 * Calls the Mapbox Directions API (driving-traffic profile) through an
 * ordered list of points — [origin, ...waypoints, destination] — and
 * returns the first route's geometry, distance and duration.
 */
export async function fetchRoute(
  points: RoutePoint[],
  options: { signal?: AbortSignal } = {}
): Promise<Pick<DriveRouteResult, 'geometry' | 'distanceKm' | 'durationMin'>> {
  const clean = sanitizeRoutePoints(points);
  if (clean.length < 2) {
    throw new Error('fetchRoute requires at least a valid origin and destination');
  }

  const token = getMapboxToken();
  if (!token) {
    throw new Error('VITE_MAPBOX_TOKEN not configured');
  }

  const coords = clean.map((p) => `${p.lng},${p.lat}`).join(';');
  const url =
    `https://api.mapbox.com/directions/v5/mapbox/driving-traffic/${coords}` +
    `?geometries=geojson&overview=full&access_token=${token}`;

  return requestDirections(url, options.signal, 'Mapbox Directions returned no route');
}

/**
 * Fallback used when Mapbox Directions fails (outage, rate limit, bad
 * request) — OSRM's public demo router speaks the same route shape
 * (GeoJSON LineString + distance/duration) so the caller doesn't need a
 * second result type, just a second source.
 */
export async function fetchOsrmRoute(
  points: RoutePoint[],
  options: { signal?: AbortSignal } = {}
): Promise<Pick<DriveRouteResult, 'geometry' | 'distanceKm' | 'durationMin'>> {
  const clean = sanitizeRoutePoints(points);
  if (clean.length < 2) {
    throw new Error('fetchOsrmRoute requires at least a valid origin and destination');
  }

  const coords = clean.map((p) => `${p.lng},${p.lat}`).join(';');
  const url = `https://router.project-osrm.org/route/v1/driving/${coords}?geometries=geojson&overview=full`;

  return requestDirections(url, options.signal, 'OSRM returned no route');
}
