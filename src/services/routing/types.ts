export interface RoutePoint {
  lat: number;
  lng: number;
}

export interface RouteCandidateZone {
  id: string;
  name: string;
  latitude: number;
  longitude: number;
  score: number;
  /** Zone category (e.g. 'commercial', 'transport') — used by
   * waypointSelector to keep prospection stops to genuine high-traffic
   * hubs. Absent for callers that don't carry it; an absent type is
   * rejected (unverifiable), not treated as allowed. */
  type?: string;
}

export interface RouteGeometry {
  type: 'LineString';
  coordinates: [number, number][];
}

export interface DriveRouteResult {
  geometry: RouteGeometry;
  distanceKm: number;
  durationMin: number;
  waypointsUsed: RouteCandidateZone[];
}

export type NavigationMode = 'direct' | 'prospection';
