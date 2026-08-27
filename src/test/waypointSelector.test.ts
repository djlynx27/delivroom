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

  it('returns an empty array when there are no candidates in the corridor', () => {
    const candidates = [zone('far-off', 45.3, -73.2, 100)];
    const result = selectProspectionWaypoints(origin, destination, candidates);
    expect(result).toEqual([]);
  });

  it('returns an empty array when origin equals destination', () => {
    const result = selectProspectionWaypoints(origin, origin, [
      zone('any', 45.51, -73.57, 100),
    ]);
    expect(result).toEqual([]);
  });
});
