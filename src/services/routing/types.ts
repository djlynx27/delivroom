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
