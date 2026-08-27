import { fetchRoute } from '@/services/routing/mapboxDirections';
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

describe('fetchRoute', () => {
  beforeEach(() => {
    vi.stubEnv('VITE_MAPBOX_TOKEN', 'test-token');
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it('builds the directions URL with ordered lng,lat coordinate pairs and the access token', async () => {
    mockFetchOnce({
      routes: [
        {
          geometry: {
            type: 'LineString',
            coordinates: [
              [-73.57, 45.51],
              [-73.6, 45.55],
            ],
          },
          distance: 5000,
          duration: 600,
        },
      ],
    });

    await fetchRoute([
      { lat: 45.51, lng: -73.57 },
      { lat: 45.55, lng: -73.6 },
    ]);

    const calledUrl = vi.mocked(fetch).mock.calls[0][0] as string;
    expect(calledUrl).toContain(
      'https://api.mapbox.com/directions/v5/mapbox/driving-traffic/-73.57,45.51;-73.6,45.55'
    );
    expect(calledUrl).toContain('access_token=test-token');
    expect(calledUrl).toContain('geometries=geojson');
  });

  it('parses distance (m→km) and duration (s→min) from the first route', async () => {
    mockFetchOnce({
      routes: [
        {
          geometry: {
            type: 'LineString',
            coordinates: [
              [-73.57, 45.51],
              [-73.6, 45.55],
            ],
          },
          distance: 4200,
          duration: 480,
        },
      ],
    });

    const result = await fetchRoute([
      { lat: 45.51, lng: -73.57 },
      { lat: 45.55, lng: -73.6 },
    ]);

    expect(result.distanceKm).toBeCloseTo(4.2);
    expect(result.durationMin).toBeCloseTo(8);
    expect(result.geometry.coordinates).toHaveLength(2);
  });

  it('throws when the token is missing', async () => {
    vi.stubEnv('VITE_MAPBOX_TOKEN', '');

    await expect(
      fetchRoute([
        { lat: 45.51, lng: -73.57 },
        { lat: 45.55, lng: -73.6 },
      ])
    ).rejects.toThrow(/token/i);
  });

  it('throws when fewer than 2 points are given', async () => {
    await expect(fetchRoute([{ lat: 45.51, lng: -73.57 }])).rejects.toThrow();
  });

  it('throws when the API responds with a non-OK status', async () => {
    mockFetchOnce({ message: 'Not Found' }, false, 404);

    await expect(
      fetchRoute([
        { lat: 45.51, lng: -73.57 },
        { lat: 45.55, lng: -73.6 },
      ])
    ).rejects.toThrow(/404/);
  });

  it('throws when the API returns no routes', async () => {
    mockFetchOnce({ routes: [] });

    await expect(
      fetchRoute([
        { lat: 45.51, lng: -73.57 },
        { lat: 45.55, lng: -73.6 },
      ])
    ).rejects.toThrow();
  });
});
