import { getGoogleMapsNavUrl } from '@/lib/hotspots';
import { logger } from '@/lib/logger';
import { fetchOsrmRoute, fetchRoute } from './mapboxDirections';
import type {
  DriveRouteResult,
  NavigationMode,
  RouteCandidateZone,
  RoutePoint,
} from './types';
import { selectProspectionWaypoints } from './waypointSelector';

export type {
  DriveRouteResult,
  NavigationMode,
  RouteCandidateZone,
  RoutePoint,
  RouteGeometry,
} from './types';
export { selectProspectionWaypoints } from './waypointSelector';

/**
 * Direct mode: origin → destination, fastest path.
 * Prospection mode: origin → up to 3 high-demand hub zones along the way →
 * destination, capped so the detour never exceeds +20% of the direct trip
 * (waypointSelector's default maxDetourRatio = 1.2).
 */
export async function getDriveRoute(
  origin: RoutePoint,
  destination: RouteCandidateZone,
  candidateZones: RouteCandidateZone[],
  mode: NavigationMode,
  options: { signal?: AbortSignal } = {}
): Promise<DriveRouteResult> {
  const waypointsUsed =
    mode === 'prospection'
      ? selectProspectionWaypoints(origin, destination, candidateZones, {
          destinationId: destination.id,
        })
      : [];

  const points: RoutePoint[] = [
    origin,
    ...waypointsUsed.map((z) => ({ lat: z.latitude, lng: z.longitude })),
    { lat: destination.latitude, lng: destination.longitude },
  ];

  try {
    const route = await fetchRoute(points, options);
    return { ...route, waypointsUsed };
  } catch (err) {
    if (options.signal?.aborted) throw err;
    // Mapbox down/rate-limited/bad request: fall back to OSRM's public
    // router rather than surfacing an error and leaving the driver with a
    // blank map — same points, same result shape.
    logger.warn('Mapbox Directions failed, falling back to OSRM', {
      mode,
      message: err instanceof Error ? err.message : String(err),
    });
    const route = await fetchOsrmRoute(points, options);
    return { ...route, waypointsUsed };
  }
}

/**
 * Builds an official Google Maps Directions deep link carrying the
 * prospection route's own waypoints, so tapping "Open in Google Maps" hands
 * the driver the same sweep Delivroom computed instead of a plain
 * origin→destination line. Google Maps deep links get unwieldy well before
 * Mapbox's 25-coordinate limit, so this is capped independently at 4 —
 * enough to convey a real detour without turning into a maze of pins.
 */
// ~11 m precision — a waypoint this close to the destination reads to
// Google Maps as the same stop, which can make its label eclipse the actual
// destination in the app's UI. Belt-and-suspenders on top of
// waypointSelector's MIN_ENDPOINT_DISTANCE_KM filter: this guard protects
// every caller of this function, not just the prospection selector.
function coordKey(lat: number, lng: number): string {
  return `${lat.toFixed(4)},${lng.toFixed(4)}`;
}

export function buildGoogleMapsProspectingUrl(
  origin: RoutePoint,
  destination: RouteCandidateZone,
  waypoints: RouteCandidateZone[]
): string {
  const destKey = coordKey(destination.latitude, destination.longitude);
  const strategicWaypoints = waypoints
    .filter((w) => coordKey(w.latitude, w.longitude) !== destKey)
    .slice(0, 4);
  const params = new URLSearchParams({
    api: '1',
    origin: `${origin.lat},${origin.lng}`,
    destination: `${destination.latitude},${destination.longitude}`,
    travelmode: 'driving',
  });
  if (strategicWaypoints.length > 0) {
    params.set(
      'waypoints',
      strategicWaypoints.map((z) => `${z.latitude},${z.longitude}`).join('|')
    );
  }
  return `https://www.google.com/maps/dir/?${params.toString()}`;
}

/**
 * 1-tap navigation: no in-app map, no route fetch, no confirmation — just
 * the URL to hand straight to `window.location.href`. Waypoint selection is
 * pure geometry (no network call), so this resolves synchronously even
 * though the full in-app nav view needs a Directions API round-trip for the
 * drawn line. Falls back to a plain destination link when GPS isn't locked
 * yet rather than blocking the tap.
 */
export function buildOneTapNavigationUrl(
  origin: RoutePoint | null,
  destination: RouteCandidateZone,
  candidateZones: RouteCandidateZone[]
): string {
  if (!origin) {
    return getGoogleMapsNavUrl(destination.name, destination.latitude, destination.longitude);
  }
  const waypoints = selectProspectionWaypoints(origin, destination, candidateZones, {
    destinationId: destination.id,
  });
  return buildGoogleMapsProspectingUrl(origin, destination, waypoints);
}
