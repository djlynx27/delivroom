import { selectProspectionWaypoints } from '@/services/routing/waypointSelector';
import { buildGoogleMapsProspectingUrl } from '@/services/routing';
import { haversineKm } from '@/hooks/useUserLocation';
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
  score: number,
  type?: string
): RouteCandidateZone {
  return { id, name: id, latitude: lat, longitude: lng, score, type };
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

  it('skips the patrol fallback below 1.5 km — road snapping blows up short sweeps', () => {
    // ~1.2 km hop: geometry says a small offset fits the budget, but real
    // roads amplify it (the 2.3 km→10 km Montmorency report) — no sweep.
    const shortHop = { lat: origin.lat + 0.011, lng: origin.lng };
    const result = selectProspectionWaypoints(origin, shortHop, []);
    expect(result).toEqual([]);
  });

  it('rejects a candidate projecting behind the origin (anti-backtrack zigzag)', () => {
    // 500 m behind the origin on the route axis, on a ~6.8 km trip: passes
    // the per-waypoint 15% insertion-cost rule but forces a doubling-back
    // start — the t∈[0,1] filter must drop it.
    const behind = zone('behind-origin', 45.5064, -73.5664, 100, 'métro');
    const result = selectProspectionWaypoints(origin, destination, [behind]);
    expect(result.map((z) => z.id)).not.toContain('behind-origin');
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

  it('defaults maxDetourRatio to 1.2 (strict — never +25% or +50%)', () => {
    // Two candidates far off-corridor (wide buffer bypasses the corridor
    // filter) so only the detour-ratio trim decides between them.
    const candidates = [
      zone('big-detour', 45.4, -73.3, 20),
      zone('small-detour', 45.53, -73.6, 80),
    ];
    const result = selectProspectionWaypoints(origin, destination, candidates, {
      corridorBufferKm: 50,
    });
    expect(result.map((z) => z.id)).toEqual(['small-detour']);
  });

  it('rejects a candidate that is perfectly on-corridor but a huge individual detour (past the destination and back)', () => {
    // Sits exactly on the origin→destination line (perp = 0, so the
    // corridor-buffer filter alone would never catch it) but 3x past the
    // destination — inserting it means overshooting the destination and
    // doubling back, a detour the per-waypoint 15% rule must reject even
    // though the overall-path trim loop never gets a chance to see it.
    const overshoot = zone(
      'overshoot',
      origin.lat + (destination.lat - origin.lat) * 3,
      origin.lng + (destination.lng - origin.lng) * 3,
      100
    );
    const result = selectProspectionWaypoints(origin, destination, [overshoot]);
    expect(result.map((z) => z.id)).not.toContain('overshoot');
  });

  it('excludes non-hub zone types (résidentiel) even with a high score and good position', () => {
    const candidates = [
      zone('corner-store', 45.53, -73.595, 95, 'résidentiel'),
      zone('mall', 45.545, -73.61, 40, 'commercial'),
    ];
    const result = selectProspectionWaypoints(origin, destination, candidates);
    expect(result.map((z) => z.id)).toEqual(['mall']);
  });

  it('allows every documented hub type (transport, métro, aéroport, commercial, tourisme)', () => {
    const candidates = [
      zone('t1', 45.515, -73.575, 50, 'transport'),
      zone('t2', 45.52, -73.58, 50, 'métro'),
      zone('t3', 45.525, -73.585, 50, 'aéroport'),
      zone('t4', 45.53, -73.59, 50, 'commercial'),
      zone('t5', 45.535, -73.595, 50, 'tourisme'),
    ];
    const result = selectProspectionWaypoints(origin, destination, candidates, {
      maxWaypoints: 5,
    });
    expect(new Set(result.map((z) => z.id))).toEqual(
      new Set(['t1', 't2', 't3', 't4', 't5'])
    );
  });

  it('keeps a candidate with no type at all (synthetic/unlabeled waypoints are unknown, not excluded)', () => {
    const candidates = [zone('no-type', 45.53, -73.595, 80, undefined)];
    const result = selectProspectionWaypoints(origin, destination, candidates);
    expect(result.map((z) => z.id)).toContain('no-type');
  });

  it('Chomedey -> Montmorency (real Delivroom zone coordinates, ~2 km direct): total route never exceeds 3.5 km', () => {
    // Real coordinates from supabase/migrations/20260731130000_fix_zone_coordinates.sql
    const chomedey = { lat: 45.544154, lng: -73.739052 }; // lvl-chomedey-notre
    const montmorency = { lat: 45.558353, lng: -73.721518 }; // lvl-mm (Station Montmorency)

    const candidates = [
      zone('centropolis', 45.5605, -73.7205, 90, 'commercial'),
      zone('cegep-montmorency', 45.5599, -73.7191, 85, 'université'), // non-hub, must be excluded
      zone('local-salon', 45.552, -73.730, 99, 'résidentiel'), // non-hub, must be excluded
    ];

    const waypoints = selectProspectionWaypoints(chomedey, montmorency, candidates, {
      corridorBufferKm: 1.5,
    });

    const legs = [chomedey, ...waypoints.map((w) => ({ lat: w.latitude, lng: w.longitude })), montmorency];
    let totalKm = 0;
    for (let i = 1; i < legs.length; i++) {
      totalKm += haversineKm(legs[i - 1].lat, legs[i - 1].lng, legs[i].lat, legs[i].lng);
    }

    expect(totalKm).toBeLessThanOrEqual(3.5);
    expect(waypoints.map((w) => w.id)).not.toContain('cegep-montmorency');
    expect(waypoints.map((w) => w.id)).not.toContain('local-salon');
  });

  it('orders waypoints in strict sequential geographic progression (no zigzag) in the Google Maps URL', () => {
    // Three hubs strictly ordered along the route by construction; feeding
    // them in shuffled input order must not change the output order.
    const candidates = [
      zone('near-dest', 45.55, -73.612, 60, 'commercial'),
      zone('near-origin', 45.515, -73.575, 60, 'transport'),
      zone('midway', 45.535, -73.595, 60, 'métro'),
    ];

    const waypoints = selectProspectionWaypoints(origin, destination, candidates, {
      maxWaypoints: 3,
    });

    expect(waypoints.map((w) => w.id)).toEqual(['near-origin', 'midway', 'near-dest']);

    const url = buildGoogleMapsProspectingUrl(
      origin,
      { id: 'dest', name: 'dest', latitude: destination.lat, longitude: destination.lng, score: 0 },
      waypoints
    );
    const waypointsParam = decodeURIComponent(new URL(url).searchParams.get('waypoints') ?? '');
    const expectedOrder = waypoints.map((w) => `${w.latitude},${w.longitude}`).join('|');
    expect(waypointsParam).toBe(expectedOrder);
  });
});
