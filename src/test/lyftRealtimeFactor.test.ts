import {
  applyLyftRealtimeBoost,
  computeLyftRealtimeScore,
  isLyftSweetSpot,
  SWEET_SPOT_MAX_WAIT_MIN,
  SWEET_SPOT_MIN_DEMAND_SCORE,
  type LyftRealtimeSignal,
} from '@/lib/scoringEngine';
import { describe, expect, it } from 'vitest';

describe('computeLyftRealtimeScore', () => {
  it('matches the exact specified formula', () => {
    // demand=8, wait=4, drivers=2
    // (8/4) * (1/(1+2*0.35)) = 2 * (1/1.7) = 1.17647...
    expect(computeLyftRealtimeScore(8, 4, 2)).toBeCloseTo(2 * (1 / 1.7));
  });

  it('floors wait_time_min at 1 to avoid dividing by zero', () => {
    expect(computeLyftRealtimeScore(10, 0, 0)).toBe(10);
    expect(computeLyftRealtimeScore(10, -5, 0)).toBe(10);
  });

  it('decreases as nearby driver count rises, all else equal', () => {
    const zeroDrivers = computeLyftRealtimeScore(9, 3, 0);
    const fiveDrivers = computeLyftRealtimeScore(9, 3, 5);
    expect(fiveDrivers).toBeLessThan(zeroDrivers);
  });

  it('decreases as wait time rises, all else equal', () => {
    const shortWait = computeLyftRealtimeScore(9, 2, 1);
    const longWait = computeLyftRealtimeScore(9, 20, 1);
    expect(longWait).toBeLessThan(shortWait);
  });
});

describe('isLyftSweetSpot', () => {
  const base: LyftRealtimeSignal = {
    demandScore: SWEET_SPOT_MIN_DEMAND_SCORE,
    waitTimeMin: SWEET_SPOT_MAX_WAIT_MIN,
    nearbyDriversCount: 0,
  };

  it('is true at the exact threshold boundaries (high demand, low wait, zero competition)', () => {
    expect(isLyftSweetSpot(base)).toBe(true);
  });

  it('is false when demand is below the threshold', () => {
    expect(isLyftSweetSpot({ ...base, demandScore: SWEET_SPOT_MIN_DEMAND_SCORE - 1 })).toBe(
      false
    );
  });

  it('is false when wait time exceeds the threshold', () => {
    expect(isLyftSweetSpot({ ...base, waitTimeMin: SWEET_SPOT_MAX_WAIT_MIN + 1 })).toBe(
      false
    );
  });

  it('is false the moment there is any local competition', () => {
    expect(isLyftSweetSpot({ ...base, nearbyDriversCount: 1 })).toBe(false);
  });
});

describe('applyLyftRealtimeBoost', () => {
  it('applies the flat Sweet Spot boost when all three conditions hold', () => {
    const result = applyLyftRealtimeBoost(50, {
      demandScore: 9,
      waitTimeMin: 2,
      nearbyDriversCount: 0,
    });
    expect(result).toBe(65); // 50 + 15
  });

  it('nudges the score up for a strong (but not-quite-Sweet-Spot) signal', () => {
    const result = applyLyftRealtimeBoost(50, {
      demandScore: 10,
      waitTimeMin: 1,
      nearbyDriversCount: 1, // fails the zero-competition Sweet Spot condition
    });
    expect(result).toBeGreaterThan(50);
  });

  it('nudges the score down for a weak signal (high wait, heavy competition)', () => {
    const result = applyLyftRealtimeBoost(50, {
      demandScore: 2,
      waitTimeMin: 20,
      nearbyDriversCount: 10,
    });
    expect(result).toBeLessThan(50);
  });

  it('caps the nudge so a single signal cannot swing the score unboundedly', () => {
    const result = applyLyftRealtimeBoost(50, {
      demandScore: 10,
      waitTimeMin: 1,
      nearbyDriversCount: 1,
    });
    expect(result).toBeLessThanOrEqual(50 + 8);
  });

  it('never pushes the final score past 100', () => {
    const result = applyLyftRealtimeBoost(95, {
      demandScore: 10,
      waitTimeMin: 1,
      nearbyDriversCount: 0,
    });
    expect(result).toBe(100);
  });

  it('never pushes the final score below 0', () => {
    const result = applyLyftRealtimeBoost(3, {
      demandScore: 1,
      waitTimeMin: 60,
      nearbyDriversCount: 50,
    });
    expect(result).toBe(0);
  });
});
