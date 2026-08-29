import { getDriveRoute } from '@/services/routing';
import type { RouteCandidateZone } from '@/services/routing/types';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

function mockFetchOnce(body: unknown, ok = true, status = 200) {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue({
      ok,
      status,
      json: () => Promise.resolve(body),
    })
  );
}

const mapboxRouteResponse = {
  routes: [
    {
      geometry: { type: 'LineString', coordinates: [[-73.57, 45.51], [-73.62, 45.56]] },
      distance: 10000,
      duration: 900,
    },
  ],
};

describe('getDriveRoute (prospection mode)', () => {
  beforeEach(() => {
    vi.stubEnv('VITE_MAPBOX_TOKEN', 'test-token');
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it('never returns a NaN waypoint when destination is a RouteCandidateZone (latitude/longitude, not lat/lng)', async () => {
    mockFetchOnce(mapboxRouteResponse);

    const origin = { lat: 45.5917, lng: -73.5893 };
    // destination is intentionally the RouteCandidateZone shape every real
    // caller (DriveScreen, CustomNavigationMap) actually passes here.
    const destination: RouteCandidateZone = {
      id: 'mtl-cb',
      name: 'Centre Bell',
      latitude: 45.4969,
      longitude: -73.5698,
      score: 0,
    };
    const candidates: RouteCandidateZone[] = [
      { id: 'mtl-bq', name: 'Station Berri-UQAM', type: 'métro', latitude: 45.5151, longitude: -73.5611, score: 78 },
      { id: 'mtl-vp', name: 'Vieux-Port de Montréal', type: 'tourisme', latitude: 45.5087, longitude: -73.552, score: 75 },
    ];

    const route = await getDriveRoute(origin, destination, candidates, 'prospection');

    expect(route.waypointsUsed.length).toBeGreaterThan(0);
    for (const w of route.waypointsUsed) {
      expect(Number.isFinite(w.latitude)).toBe(true);
      expect(Number.isFinite(w.longitude)).toBe(true);
    }
  });

  it('falls back to the patrol-sweep waypoint (not NaN) when no real candidate qualifies', async () => {
    mockFetchOnce(mapboxRouteResponse);

    const origin = { lat: 45.5917, lng: -73.5893 };
    const destination: RouteCandidateZone = {
      id: 'mtl-cb',
      name: 'Centre Bell',
      latitude: 45.4969,
      longitude: -73.5698,
      score: 0,
    };

    const route = await getDriveRoute(origin, destination, [], 'prospection');

    expect(route.waypointsUsed).toHaveLength(1);
    expect(route.waypointsUsed[0]!.id).toBe('patrol-sweep');
    expect(Number.isFinite(route.waypointsUsed[0]!.latitude)).toBe(true);
    expect(Number.isFinite(route.waypointsUsed[0]!.longitude)).toBe(true);
  });
});
