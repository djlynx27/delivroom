import {
  resolveNextNavigationWaypoint,
  resolveTripWaypoints,
  type TripWaypoint,
} from '@/lib/tripSave';
import { describe, expect, it } from 'vitest';

describe('resolveTripWaypoints', () => {
  it('synthesizes pickup/dropoff from the plain fields when trip_waypoints is absent', () => {
    const result = resolveTripWaypoints({
      pickup_address: '1 Rue A, Laval',
      dropoff_address: '2 Rue B, Laval',
      trip_waypoints: null,
    });
    expect(result).toEqual([
      { type: 'pickup', address: '1 Rue A, Laval' },
      { type: 'dropoff', address: '2 Rue B, Laval' },
    ]);
  });

  it('prefers an explicit multi-stop trip_waypoints array over the plain fields', () => {
    const waypoints: TripWaypoint[] = [
      { type: 'pickup', address: 'A' },
      { type: 'stop', address: 'B' },
      { type: 'dropoff', address: 'C' },
    ];
    const result = resolveTripWaypoints({
      pickup_address: 'A',
      dropoff_address: 'C',
      trip_waypoints: waypoints,
    });
    expect(result).toBe(waypoints);
  });

  it('returns an empty array when neither source has an address', () => {
    expect(resolveTripWaypoints({})).toEqual([]);
  });
});

describe('resolveNextNavigationWaypoint', () => {
  const waypoints: TripWaypoint[] = [
    { type: 'pickup', address: 'Pickup' },
    { type: 'stop', address: 'Stop 1' },
    { type: 'stop', address: 'Stop 2' },
    { type: 'dropoff', address: 'Dropoff' },
  ];

  it('returns the pickup while still en route to the passenger, ignoring stopsVisited', () => {
    expect(resolveNextNavigationWaypoint(waypoints, 'to_pickup', 2)).toEqual({
      type: 'pickup',
      address: 'Pickup',
    });
  });

  it('returns the next unvisited stop once the trip is active', () => {
    expect(resolveNextNavigationWaypoint(waypoints, 'active_trip', 0)).toEqual({
      type: 'stop',
      address: 'Stop 1',
    });
    expect(resolveNextNavigationWaypoint(waypoints, 'active_trip', 1)).toEqual({
      type: 'stop',
      address: 'Stop 2',
    });
  });

  it('falls back to dropoff once every stop has been visited', () => {
    expect(resolveNextNavigationWaypoint(waypoints, 'active_trip', 2)).toEqual({
      type: 'dropoff',
      address: 'Dropoff',
    });
  });

  it('returns dropoff directly for a normal single-destination ride (no stops)', () => {
    const simple: TripWaypoint[] = [
      { type: 'pickup', address: 'Pickup' },
      { type: 'dropoff', address: 'Dropoff' },
    ];
    expect(resolveNextNavigationWaypoint(simple, 'active_trip', 0)).toEqual({
      type: 'dropoff',
      address: 'Dropoff',
    });
  });
});
