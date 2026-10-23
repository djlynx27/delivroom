import { haversineKm } from '@/hooks/useUserLocation';
import { getGoogleMapsNavUrl } from '@/lib/hotspots';
import type { RouteCandidateZone, RoutePoint } from './types';
import { selectProspectionWaypoints } from './waypointSelector';

export interface ProspectingStep {
  zone: RouteCandidateZone;
  /** Straight-line km from the previous stop (origin for the first step). */
  legKm: number;
  /** Single-destination Google Maps link — no origin, so Maps starts from wherever the driver is when tapped. */
  url: string;
  isDestination: boolean;
}

/**
 * Hop-by-hop prospection: the same corridor filter as the one-shot route
 * (selectProspectionWaypoints), but each stop becomes its own A→B Google Maps
 * link instead of one multi-waypoint URL Maps can reorder or recompute.
 * Last step is always the real destination.
 */
export function buildProspectingSteps(
  origin: RoutePoint,
  destination: RouteCandidateZone,
  candidates: RouteCandidateZone[]
): ProspectingStep[] {
  const stops = [
    ...selectProspectionWaypoints(
      origin,
      { lat: destination.latitude, lng: destination.longitude },
      candidates,
      { destinationId: destination.id }
    ),
    destination,
  ];
  let prev = origin;
  return stops.map((zone, i) => {
    const legKm = haversineKm(prev.lat, prev.lng, zone.latitude, zone.longitude);
    prev = { lat: zone.latitude, lng: zone.longitude };
    return {
      zone,
      legKm,
      url: getGoogleMapsNavUrl(zone.name, zone.latitude, zone.longitude),
      isDestination: i === stops.length - 1,
    };
  });
}
