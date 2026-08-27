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

/**
 * Calls the Mapbox Directions API (driving-traffic profile) through an
 * ordered list of points — [origin, ...waypoints, destination] — and
 * returns the first route's geometry, distance and duration.
 */
export async function fetchRoute(
  points: RoutePoint[],
  options: { signal?: AbortSignal } = {}
): Promise<Pick<DriveRouteResult, 'geometry' | 'distanceKm' | 'durationMin'>> {
  if (points.length < 2) {
    throw new Error('fetchRoute requires at least an origin and a destination');
  }

  const token = getMapboxToken();
  if (!token) {
    throw new Error('VITE_MAPBOX_TOKEN not configured');
  }

  const coords = points.map((p) => `${p.lng},${p.lat}`).join(';');
  const url =
    `https://api.mapbox.com/directions/v5/mapbox/driving-traffic/${coords}` +
    `?geometries=geojson&overview=full&access_token=${token}`;

  const response = await fetch(url, { signal: options.signal });
  if (!response.ok) {
    throw new Error(`Mapbox Directions request failed (${response.status})`);
  }

  const payload = (await response.json()) as { routes?: DirectionsApiRoute[] };
  const route = payload.routes?.[0];
  if (!route) {
    throw new Error('Mapbox Directions returned no route');
  }

  return {
    geometry: route.geometry,
    distanceKm: route.distance / 1000,
    durationMin: route.duration / 60,
  };
}
