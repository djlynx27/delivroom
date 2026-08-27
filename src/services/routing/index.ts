import { fetchRoute } from './mapboxDirections';
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
 * Prospection mode: origin → up to 5 high-demand zones along the way →
 * destination, capped so the detour never exceeds +50% of the direct trip.
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

  const route = await fetchRoute(points, options);

  return { ...route, waypointsUsed };
}
