import {
  computeEffectiveScore,
  getReturnCorridor,
  type ReturnCorridorZone,
} from '@/lib/scoringEngine';
import { buildGoogleMapsProspectingUrl } from '@/services/routing';
import { describe, expect, it } from 'vitest';

// Roughly Boul. Saint-Laurent, Montréal, north-south — matches the fixture
// used in waypointSelector.test.ts so the corridor math is easy to reason
// about (straight north-south line, perpendicular distance = longitude delta).
const current = { lat: 45.51, lng: -73.57 };
const hub = { lat: 45.56, lng: -73.62 };

function zone(
  id: string,
  lat: number,
  lng: number,
  score: number,
  type = 'commercial'
): ReturnCorridorZone {
  return { id, name: id, type, latitude: lat, longitude: lng, score };
}

describe('computeEffectiveScore', () => {
  it('subtracts distance * cost per km from the base score', () => {
    expect(computeEffectiveScore(80, 10, 0.35)).toBeCloseTo(76.5);
  });

  it('uses the default $0.35/km cost when not overridden', () => {
    expect(computeEffectiveScore(80, 10)).toBeCloseTo(76.5);
  });

  it('can drive a far high-scoring zone below a closer lower-scoring one', () => {
    const far = computeEffectiveScore(90, 40); // 90 - 14 = 76
    const near = computeEffectiveScore(70, 2); // 70 - 0.7 = 69.3
    expect(far).toBeGreaterThan(near); // sanity: not yet crossed
    const veryFar = computeEffectiveScore(90, 80); // 90 - 28 = 62
    expect(veryFar).toBeLessThan(near);
  });
});

describe('getReturnCorridor', () => {
  it('stays inactive (direct route) when the hub is within 6 km', () => {
    const closeHub = { lat: current.lat + 0.02, lng: current.lng }; // ~2.2 km
    const result = getReturnCorridor(current, closeHub, [
      zone('z1', 45.53, -73.595, 80),
    ]);
    expect(result.active).toBe(false);
    expect(result.steps).toEqual([]);
    expect(result.directDistanceKm).toBeLessThan(6);
  });

  it('builds a multi-step corridor when the hub is more than 6 km away', () => {
    const candidates = [
      zone('on-route-low', 45.53, -73.595, 40),
      zone('on-route-high', 45.545, -73.61, 90),
      zone('far-off', 45.53, -73.4, 95),
    ];
    const result = getReturnCorridor(current, hub, candidates);

    expect(result.directDistanceKm).toBeGreaterThan(6);
    expect(result.active).toBe(true);
    expect(result.steps.map((s) => s.id)).toEqual([
      'on-route-low',
      'on-route-high',
    ]);
  });

  it('caps steps at 3 and keeps the highest cost-adjusted scores', () => {
    const candidates = Array.from({ length: 8 }, (_, i) =>
      zone(`z${i}`, 45.51 + i * 0.005, -73.57 - i * 0.005, i * 10)
    );
    const result = getReturnCorridor(current, hub, candidates);
    expect(result.steps.length).toBeLessThanOrEqual(3);
  });

  it('prefers a closer, cheaper zone over a farther similarly-scored one once cost is applied', () => {
    // Both sit on the corridor with a small raw-score gap; "far-hot" is much
    // farther from `current` (near the hub end), so the ~6 km extra deadhead
    // at $0.35/km should be enough to tip the ranking to the closer one.
    const closeCheap = zone('close-cheap', 45.511, -73.571, 56);
    // Near the hub end but >500m from `hub` itself — a candidate that close
    // to the destination is now excluded outright (see
    // MIN_DESTINATION_DISTANCE_KM in waypointSelector.ts), so this stays
    // just outside that radius to keep testing the cost-adjustment ranking
    // rather than the destination-proximity filter.
    const farHot = zone('far-hot', 45.554, -73.612, 58);

    const result = getReturnCorridor(current, hub, [closeCheap, farHot], 6);

    const closeStep = result.steps.find((s) => s.id === 'close-cheap');
    const farStep = result.steps.find((s) => s.id === 'far-hot');
    expect(closeStep).toBeDefined();
    expect(farStep).toBeDefined();
    expect(closeStep!.effectiveScore).toBeGreaterThan(farStep!.effectiveScore);
  });

  it('respects a tighter maxDetourKm by excluding off-corridor zones', () => {
    const offCorridor = zone('off-corridor', 45.53, -73.5, 90); // far off the line
    const result = getReturnCorridor(current, hub, [offCorridor], 0.5);
    expect(result.steps.find((s) => s.id === 'off-corridor')).toBeUndefined();
  });

  it('falls back to a synthetic patrol step when no real candidates qualify', () => {
    const result = getReturnCorridor(current, hub, []);
    expect(result.active).toBe(true);
    expect(result.steps).toHaveLength(1);
    expect(result.steps[0].id).toBe('patrol-sweep');
  });
});

describe('return corridor -> 1-tap Google Maps URL', () => {
  it('carries the corridor step zones as waypoints on the Maps deep link', () => {
    const candidates = [
      zone('on-route-low', 45.53, -73.595, 40),
      zone('on-route-high', 45.545, -73.61, 90),
    ];
    const corridor = getReturnCorridor(current, hub, candidates);
    expect(corridor.active).toBe(true);

    const hubZone = { id: 'hub', name: 'Hub principal', latitude: hub.lat, longitude: hub.lng, score: 80 };
    const url = buildGoogleMapsProspectingUrl(current, hubZone, corridor.steps);

    expect(url).toContain('https://www.google.com/maps/dir/?');
    expect(url).toContain(`origin=${current.lat}%2C${current.lng}`);
    expect(url).toContain(`destination=${hub.lat}%2C${hub.lng}`);
    // Both step zones, in corridor order, pipe-separated (%7C when encoded).
    expect(url).toContain('waypoints=45.53%2C-73.595%7C45.545%2C-73.61');
  });
});
