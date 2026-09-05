import { describe, expect, it } from 'vitest';
import {
  computeStats,
  DEFAULT_SHIFT_TARGET,
  DEPRECIATION_PER_KM,
  FUEL_COST_PER_KM,
  MIN_VIABLE_NET_PER_HOUR,
  type ShiftTally,
} from './shiftTracker';

function tally(rides: ShiftTally['rides'], startedAt = 0): ShiftTally {
  return { startedAt, rides };
}

describe('computeStats net math', () => {
  it('returns zeroed net fields with no rides', () => {
    const stats = computeStats(tally([]));
    expect(stats.netFare).toBe(0);
    expect(stats.netHourlyRate).toBeNull();
    expect(stats.netPerKm).toBeNull();
  });

  it('subtracts fuel + depreciation per km from gross fare', () => {
    const now = 2 * 3_600_000; // 2h wall time
    const stats = computeStats(
      tally([{ ts: 0, fare: 100, rideKm: 50, rideMin: 90, platform: 'lyft' }], 0),
      now
    );
    const expectedNet = 100 - 50 * (FUEL_COST_PER_KM + DEPRECIATION_PER_KM);
    expect(stats.netFare).toBeCloseTo(expectedNet);
    expect(stats.netHourlyRate).toBeCloseTo(expectedNet / 2);
    expect(stats.netPerKm).toBeCloseTo(expectedNet / 50);
  });

  it('flags net $/h below the viability threshold', () => {
    const now = 4 * 3_600_000; // 4h wall time
    // Low fare over lots of km -> net $/h well under threshold
    const stats = computeStats(
      tally([{ ts: 0, fare: 40, rideKm: 100, rideMin: 200, platform: 'lyft' }], 0),
      now
    );
    expect(stats.netHourlyRate).not.toBeNull();
    expect(stats.netHourlyRate!).toBeLessThan(MIN_VIABLE_NET_PER_HOUR);
  });
});

describe('shift target defaults', () => {
  it('exposes a positive default target', () => {
    expect(DEFAULT_SHIFT_TARGET).toBeGreaterThan(0);
  });
});
