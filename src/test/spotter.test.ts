import { describe, expect, it } from 'vitest';
import {
  computeMicroSpot,
  findQuietestQuadrant,
  isValidDriverGrid,
  MAX_SPOT_OFFSET_METERS,
  MIN_SPOT_OFFSET_METERS,
  offsetCoordinate,
} from '@/lib/spotter';

const CHOMEDEY: { latitude: number; longitude: number } = {
  latitude: 45.544154,
  longitude: -73.739052,
};

describe('isValidDriverGrid', () => {
  it('accepts a 9-cell array', () => {
    expect(isValidDriverGrid([0, 0, 0, 0, 0, 0, 0, 0, 0])).toBe(true);
  });

  it('rejects a grid of the wrong length', () => {
    expect(isValidDriverGrid([0, 0, 0])).toBe(false);
  });

  it('rejects non-array input', () => {
    expect(isValidDriverGrid(null)).toBe(false);
    expect(isValidDriverGrid(undefined)).toBe(false);
  });
});

describe('findQuietestQuadrant', () => {
  it('picks the cell with the fewest drivers', () => {
    // top_right (index 2) has the lowest count
    const grid = [5, 4, 0, 3, 6, 2, 1, 4, 3];
    expect(findQuietestQuadrant(grid)).toEqual({ quadrant: 'top_right', index: 2, count: 0 });
  });

  it('breaks ties by taking the first cell in row-major order', () => {
    const grid = [0, 0, 1, 1, 1, 1, 1, 1, 1];
    expect(findQuietestQuadrant(grid).quadrant).toBe('top_left');
  });

  it('resolves an all-zero grid to top_left (nothing to avoid)', () => {
    const grid = [0, 0, 0, 0, 0, 0, 0, 0, 0];
    expect(findQuietestQuadrant(grid).quadrant).toBe('top_left');
  });
});

describe('offsetCoordinate', () => {
  it('moves due north by roughly the requested distance', () => {
    const point = offsetCoordinate(CHOMEDEY, 0, 100);
    // ~1 degree latitude ≈ 111km, so 100m ≈ 0.0009 degrees
    expect(point.latitude).toBeGreaterThan(CHOMEDEY.latitude);
    expect(point.latitude - CHOMEDEY.latitude).toBeCloseTo(100 / 111_320, 5);
    expect(point.longitude).toBeCloseTo(CHOMEDEY.longitude, 6);
  });

  it('moves due east by roughly the requested distance', () => {
    const point = offsetCoordinate(CHOMEDEY, 90, 100);
    expect(point.longitude).toBeGreaterThan(CHOMEDEY.longitude);
    expect(point.latitude).toBeCloseTo(CHOMEDEY.latitude, 6);
  });
});

describe('computeMicroSpot', () => {
  it('returns null when no grid is available', () => {
    expect(computeMicroSpot(CHOMEDEY, undefined)).toBeNull();
    expect(computeMicroSpot(CHOMEDEY, null)).toBeNull();
  });

  it('returns null when the grid has the wrong shape', () => {
    expect(computeMicroSpot(CHOMEDEY, [1, 2, 3])).toBeNull();
  });

  it('leaves the centroid unmodified when the center cell is quietest', () => {
    // center (index 4) is the lowest
    const grid = [5, 5, 5, 5, 0, 5, 5, 5, 5];
    const spot = computeMicroSpot(CHOMEDEY, grid);
    expect(spot).toMatchObject({
      latitude: CHOMEDEY.latitude,
      longitude: CHOMEDEY.longitude,
      quadrant: 'center',
      bearingDeg: null,
      offsetMeters: 0,
    });
  });

  it('offsets toward the sparsest quadrant, away from the driver cluster', () => {
    // top_right (index 2) is emptiest -- most drivers are bottom_left (6)
    const grid = [3, 3, 0, 3, 3, 3, 9, 3, 3];
    const spot = computeMicroSpot(CHOMEDEY, grid);
    expect(spot).not.toBeNull();
    expect(spot!.quadrant).toBe('top_right');
    expect(spot!.bearingDeg).toBe(45);
    // Moving NE means both latitude and longitude increase.
    expect(spot!.latitude).toBeGreaterThan(CHOMEDEY.latitude);
    expect(spot!.longitude).toBeGreaterThan(CHOMEDEY.longitude);
  });

  it('clamps a caller-supplied offset into the 50-150m tactical range', () => {
    const grid = [9, 9, 0, 9, 9, 9, 9, 9, 9];
    const tooFar = computeMicroSpot(CHOMEDEY, grid, 500);
    expect(tooFar!.offsetMeters).toBe(MAX_SPOT_OFFSET_METERS);

    const tooClose = computeMicroSpot(CHOMEDEY, grid, 10);
    expect(tooClose!.offsetMeters).toBe(MIN_SPOT_OFFSET_METERS);
  });

  it('defaults to a 100m offset when none is specified', () => {
    const grid = [9, 9, 0, 9, 9, 9, 9, 9, 9];
    const spot = computeMicroSpot(CHOMEDEY, grid);
    expect(spot!.offsetMeters).toBe(100);
  });

  it('reports the driver count found in the chosen quadrant', () => {
    const grid = [3, 3, 1, 3, 3, 3, 9, 3, 3];
    const spot = computeMicroSpot(CHOMEDEY, grid);
    expect(spot!.driverCountInQuadrant).toBe(1);
  });
});
