import { selectProspectionWaypoints } from '@/services/routing/waypointSelector';
import type { RouteCandidateZone } from '@/services/routing/types';
import { describe, expect, it } from 'vitest';

// Origin/destination roughly along Boul. Saint-Laurent, Montréal — north-south
// straight line so perpendicular-distance math is easy to reason about.
const origin = { lat: 45.51, lng: -73.57 };
const destination = { lat: 45.56, lng: -73.62 };

function zone(
  id: string,
  lat: number,
  lng: number,
  score: number
): RouteCandidateZone {
  return { id, name: id, latitude: lat, longitude: lng, score };
}

describe('selectProspectionWaypoints', () => {
  it('keeps only candidates inside the corridor, ordered along the route', () => {
    const candidates = [
      zone('on-route-low', 45.53, -73.595, 40), // near the line, low score
      zone('on-route-high', 45.545, -73.61, 90), // near the line, closer to destination
      zone('far-off', 45.53, -73.4, 95), // high score but way off the corridor
    ];

    const result = selectProspectionWaypoints(origin, destination, candidates);

    expect(result.map((z) => z.id)).toEqual(['on-route-low', 'on-route-high']);
  });

  it('excludes the destination itself if present in candidates', () => {
    const candidates = [
      zone('dest-dup', destination.lat, destination.lng, 99),
      zone('on-route', 45.53, -73.595, 50),
    ];

    const result = selectProspectionWaypoints(origin, destination, candidates, {
      destinationId: 'dest-dup',
    });

    expect(result.map((z) => z.id)).toEqual(['on-route']);
  });

  it('caps at maxWaypoints, keeping the highest scores', () => {
    const candidates = Array.from({ length: 8 }, (_, i) =>
      zone(`z${i}`, 45.51 + i * 0.005, -73.57 - i * 0.005, i * 10)
    );

    const result = selectProspectionWaypoints(origin, destination, candidates, {
      maxWaypoints: 3,
    });

    expect(result).toHaveLength(3);
    // Highest-scored three are z5, z6, z7 (scores 50, 60, 70)
    expect(new Set(result.map((z) => z.id))).toEqual(
      new Set(['z5', 'z6', 'z7'])
    );
  });

  it('drops the lowest-scored waypoint until the detour stays within maxDetourRatio', () => {
    const candidates = [
      // Both far off-corridor so the corridor filter alone wouldn't exclude
      // them (wide buffer below) — the detour cap must do the trimming.
      zone('big-detour', 45.4, -73.3, 20),
      zone('small-detour', 45.53, -73.6, 80),
    ];

    const result = selectProspectionWaypoints(origin, destination, candidates, {
      corridorBufferKm: 50,
      maxDetourRatio: 1.1,
    });

    expect(result.map((z) => z.id)).toEqual(['small-detour']);
  });

  it('falls back to a patrol waypoint when no candidates are in the corridor', () => {
    const candidates = [zone('far-off', 45.3, -73.2, 100)];
    const result = selectProspectionWaypoints(origin, destination, candidates);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('patrol-sweep');
  });

  it('returns an empty array when origin equals destination', () => {
    const result = selectProspectionWaypoints(origin, origin, [
      zone('any', 45.51, -73.57, 100),
    ]);
    expect(result).toEqual([]);
  });

  it('falls back to a synthetic patrol waypoint when no real candidates qualify', () => {
    // No candidates at all — the empty-corridor case the bug report described
    // as "prospection route identical to direct".
    const result = selectProspectionWaypoints(origin, destination, []);

    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('patrol-sweep');
    // The synthetic point must actually be off the direct line, otherwise
    // Mapbox would just retrace the same route.
    const midLat = (origin.lat + destination.lat) / 2;
    const midLng = (origin.lng + destination.lng) / 2;
    const offLine =
      Math.abs(result[0].latitude - midLat) > 0.0005 ||
      Math.abs(result[0].longitude - midLng) > 0.0005;
    expect(offLine).toBe(true);
  });

  it('skips the patrol fallback for a very short hop (nowhere to sweep)', () => {
    const veryClose = { lat: origin.lat + 0.001, lng: origin.lng + 0.001 };
    const result = selectProspectionWaypoints(origin, veryClose, []);
    expect(result).toEqual([]);
  });

  it('keeps the patrol detour within the detour ratio budget', () => {
    const result = selectProspectionWaypoints(origin, destination, [], {
      maxDetourRatio: 1.2,
    });
    expect(result).toHaveLength(1);

    const direct = Math.hypot(
      (destination.lat - origin.lat) * 110.574,
      (destination.lng - origin.lng) * 78.02
    );
    const viaPatrol =
      Math.hypot(
        (result[0].latitude - origin.lat) * 110.574,
        (result[0].longitude - origin.lng) * 78.02
      ) +
      Math.hypot(
        (destination.lat - result[0].latitude) * 110.574,
        (destination.lng - result[0].longitude) * 78.02
      );
    expect(viaPatrol).toBeLessThanOrEqual(direct * 1.2 + 0.01);
  });
});
