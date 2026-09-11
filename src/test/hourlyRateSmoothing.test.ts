import { describe, expect, it } from 'vitest';
import {
  calculateSmoothedHourlyRate,
  GLOBAL_PRIOR_RATE,
  MAX_HOURLY_CAP,
  MIN_SAMPLE_WEIGHT,
} from '@/lib/hourlyRateSmoothing';

describe('calculateSmoothedHourlyRate', () => {
  it('returns the prior when there is no evidence at all', () => {
    expect(calculateSmoothedHourlyRate({ hourlyRate: 80, sampleCount: 0 })).toBe(
      GLOBAL_PRIOR_RATE
    );
    expect(calculateSmoothedHourlyRate({ hourlyRate: 80, sampleCount: -3 })).toBe(
      GLOBAL_PRIOR_RATE
    );
  });

  it('pulls a single lucky sample most of the way back to the prior', () => {
    // (5 * 28.5 + 1 * 80) / 6 = 37.08 — the "Station Concorde 80$/h" case.
    const smoothed = calculateSmoothedHourlyRate({ hourlyRate: 80, sampleCount: 1 });
    expect(smoothed).toBeCloseTo((MIN_SAMPLE_WEIGHT * GLOBAL_PRIOR_RATE + 80) / 6, 4);
    expect(smoothed).toBeLessThan(40);
    expect(smoothed).toBeGreaterThan(GLOBAL_PRIOR_RATE);
  });

  it('barely moves a thick sample', () => {
    const raw = 31;
    const smoothed = calculateSmoothedHourlyRate({ hourlyRate: raw, sampleCount: 200 });
    expect(Math.abs(smoothed - raw)).toBeLessThan(0.1);
  });

  it('converges monotonically toward the raw rate as the sample grows', () => {
    const rates = [1, 2, 5, 10, 40, 100].map((sampleCount) =>
      calculateSmoothedHourlyRate({ hourlyRate: 45, sampleCount })
    );
    for (let i = 1; i < rates.length; i += 1) {
      expect(rates[i]).toBeGreaterThan(rates[i - 1]);
    }
    expect(rates[rates.length - 1]).toBeLessThan(45);
  });

  it('shrinks upward too when the observed rate is below the prior', () => {
    const smoothed = calculateSmoothedHourlyRate({ hourlyRate: 8, sampleCount: 1 });
    expect(smoothed).toBeGreaterThan(8);
    expect(smoothed).toBeLessThan(GLOBAL_PRIOR_RATE);
  });

  it('winsorizes at the hard cap even with a huge sample', () => {
    expect(calculateSmoothedHourlyRate({ hourlyRate: 500, sampleCount: 10_000 })).toBe(
      MAX_HOURLY_CAP
    );
  });

  it('honours a caller-supplied prior, weight and cap', () => {
    // priorWeight 0 opts out of shrinkage but keeps the cap.
    expect(
      calculateSmoothedHourlyRate({ hourlyRate: 47, sampleCount: 1 }, { priorWeight: 0 })
    ).toBe(47);
    expect(
      calculateSmoothedHourlyRate({ hourlyRate: 47, sampleCount: 1 }, { priorWeight: 0, maxRate: 40 })
    ).toBe(40);
    // A measured market average replaces the global prior.
    expect(
      calculateSmoothedHourlyRate({ hourlyRate: 60, sampleCount: 5 }, { priorRate: 20 })
    ).toBeCloseTo((5 * 20 + 5 * 60) / 10, 4);
  });

  it('falls back to defaults on non-finite inputs instead of producing NaN', () => {
    expect(calculateSmoothedHourlyRate({ hourlyRate: Number.NaN, sampleCount: 5 })).toBe(
      GLOBAL_PRIOR_RATE
    );
    expect(
      calculateSmoothedHourlyRate({ hourlyRate: Number.POSITIVE_INFINITY, sampleCount: 5 })
    ).toBe(GLOBAL_PRIOR_RATE);
    expect(calculateSmoothedHourlyRate({ hourlyRate: 40, sampleCount: Number.NaN })).toBe(
      GLOBAL_PRIOR_RATE
    );
    expect(
      calculateSmoothedHourlyRate({ hourlyRate: 40, sampleCount: 5 }, { priorRate: Number.NaN })
    ).toBeCloseTo((MIN_SAMPLE_WEIGHT * GLOBAL_PRIOR_RATE + 5 * 40) / 10, 4);
    expect(
      calculateSmoothedHourlyRate({ hourlyRate: 40, sampleCount: 5 }, { maxRate: Number.NaN })
    ).toBeCloseTo((MIN_SAMPLE_WEIGHT * GLOBAL_PRIOR_RATE + 5 * 40) / 10, 4);
    expect(
      calculateSmoothedHourlyRate({ hourlyRate: 40, sampleCount: 5 }, { priorWeight: Number.NaN })
    ).toBeCloseTo((MIN_SAMPLE_WEIGHT * GLOBAL_PRIOR_RATE + 5 * 40) / 10, 4);
  });

  it('clamps a negative observed rate to zero before shrinking', () => {
    const smoothed = calculateSmoothedHourlyRate({ hourlyRate: -50, sampleCount: 5 });
    expect(smoothed).toBeCloseTo((MIN_SAMPLE_WEIGHT * GLOBAL_PRIOR_RATE) / 10, 4);
    expect(smoothed).toBeGreaterThan(0);
  });

  it('never returns a rate above the cap for a negative prior', () => {
    expect(
      calculateSmoothedHourlyRate({ hourlyRate: 30, sampleCount: 0 }, { priorRate: -10 })
    ).toBe(0);
  });
});
