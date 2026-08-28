import {
  applySaturationDegradation,
  computeSaturationFactor,
  countDriversPerZone,
  roundToPrivacyGrid,
  SATURATION_ALERT_THRESHOLD,
  type NearbyDriverPosition,
} from '@/lib/realtime';
import { describe, expect, it } from 'vitest';

describe('roundToPrivacyGrid', () => {
  it('snaps a small perturbation around a cell center back to the same cell', () => {
    // A rounded result is itself already grid-aligned (Math.round(x/step)*step
    // is a multiple of step), so it's the safest possible "cell center" to
    // perturb from -- unlike an arbitrary raw coordinate, which can happen to
    // sit right on a cell boundary where even a few meters flips the cell.
    const center = roundToPrivacyGrid(45.5017, -73.5673);
    const nearby = roundToPrivacyGrid(center.lat + 0.0001, center.lng + 0.0001); // ~11m
    expect(nearby).toEqual(center);
  });

  it('produces different cells for positions far enough apart', () => {
    const a = roundToPrivacyGrid(45.5017, -73.5673);
    const b = roundToPrivacyGrid(45.52, -73.58); // several km away
    expect(a).not.toEqual(b);
  });

  it('never returns the exact input coordinates (rounds to the grid)', () => {
    const result = roundToPrivacyGrid(45.50171234, -73.56731234);
    expect(result.lat).not.toBe(45.50171234);
    expect(result.lng).not.toBe(-73.56731234);
  });
});

describe('countDriversPerZone', () => {
  const zones = [
    { id: 'z1', latitude: 45.5, longitude: -73.57 },
    { id: 'z2', latitude: 45.6, longitude: -73.5 },
  ];

  it('buckets each position into its nearest zone within the match radius', () => {
    const positions: NearbyDriverPosition[] = [
      { lat: 45.501, lng: -73.571, updatedAt: '' }, // near z1
      { lat: 45.502, lng: -73.572, updatedAt: '' }, // near z1
      { lat: 45.601, lng: -73.501, updatedAt: '' }, // near z2
    ];
    const counts = countDriversPerZone(positions, zones);
    expect(counts.get('z1')).toBe(2);
    expect(counts.get('z2')).toBe(1);
  });

  it('drops positions farther than matchRadiusKm from every zone', () => {
    const positions: NearbyDriverPosition[] = [
      { lat: 46.0, lng: -74.0, updatedAt: '' }, // nowhere near either zone
    ];
    const counts = countDriversPerZone(positions, zones, 1.5);
    expect(counts.get('z1')).toBe(0);
    expect(counts.get('z2')).toBe(0);
  });

  it('always includes every zone in the result, even with zero drivers', () => {
    const counts = countDriversPerZone([], zones);
    expect(counts.get('z1')).toBe(0);
    expect(counts.get('z2')).toBe(0);
  });
});

describe('computeSaturationFactor', () => {
  it('divides active drivers by the base demand score', () => {
    expect(computeSaturationFactor(9, 6)).toBeCloseTo(1.5);
  });

  it('returns 0 when there are no drivers and no score', () => {
    expect(computeSaturationFactor(0, 0)).toBe(0);
  });

  it('returns Infinity when drivers are present but the score is 0', () => {
    expect(computeSaturationFactor(3, 0)).toBe(Infinity);
  });
});

describe('applySaturationDegradation', () => {
  it('leaves the score untouched at or below the alert threshold', () => {
    expect(applySaturationDegradation(80, SATURATION_ALERT_THRESHOLD)).toBe(80);
    expect(applySaturationDegradation(80, 1.0)).toBe(80);
  });

  it('degrades the score once past the threshold', () => {
    const result = applySaturationDegradation(80, 2.5);
    expect(result).toBeLessThan(80);
  });

  it('caps the penalty at 30% even for extreme saturation', () => {
    const result = applySaturationDegradation(100, 50);
    expect(result).toBe(70);
  });
});
