import {
  evaluateHourClusteredCandidate,
  evaluatePromotionCandidate,
  hourWindowFor,
  MIN_OCCURRENCES_FOR_AUTO_PROMOTION,
  MIN_SAMPLE_SIZE_AT_HOUR,
  MIN_SAMPLE_SIZE_FOR_AUTO_PROMOTION,
  type DiscoveryPerformance,
  type MajorZoneBenchmark,
} from '@/lib/zonePromotion';
import { describe, expect, it } from 'vitest';

const benchmark: MajorZoneBenchmark = { avgPerKm: 1.5, avgPerH: 32 };

function perf(overrides: Partial<DiscoveryPerformance> = {}): DiscoveryPerformance {
  return {
    occurrenceCount: MIN_OCCURRENCES_FOR_AUTO_PROMOTION,
    sampleSize: MIN_SAMPLE_SIZE_FOR_AUTO_PROMOTION,
    avgPerKm: 1.8,
    avgPerH: 35,
    ...overrides,
  };
}

describe('evaluatePromotionCandidate', () => {
  it('promotes a recurring spot that out-earns the major zones on both metrics', () => {
    const verdict = evaluatePromotionCandidate(perf(), benchmark);
    expect(verdict.eligible).toBe(true);
  });

  it('rejects a spot seen fewer times than the repetition threshold', () => {
    const verdict = evaluatePromotionCandidate(
      perf({ occurrenceCount: MIN_OCCURRENCES_FOR_AUTO_PROMOTION - 1 }),
      benchmark,
    );
    expect(verdict.eligible).toBe(false);
    expect(verdict.reason).toMatch(/minimum/i);
  });

  it('rejects when too few real trips back the average, even if recurring', () => {
    const verdict = evaluatePromotionCandidate(
      perf({ sampleSize: MIN_SAMPLE_SIZE_FOR_AUTO_PROMOTION - 1 }),
      benchmark,
    );
    expect(verdict.eligible).toBe(false);
    expect(verdict.reason).toMatch(/courses réelles/i);
  });

  it('rejects when there is no usable $/km or $/h average at all', () => {
    const verdict = evaluatePromotionCandidate(
      perf({ avgPerKm: null, avgPerH: null }),
      benchmark,
    );
    expect(verdict.eligible).toBe(false);
  });

  it('rejects a recurring spot whose $/km falls below the major-zone benchmark', () => {
    const verdict = evaluatePromotionCandidate(
      perf({ avgPerKm: 1.2, avgPerH: 40 }),
      benchmark,
    );
    expect(verdict.eligible).toBe(false);
    expect(verdict.reason).toMatch(/\$\/km/);
  });

  it('rejects a recurring spot whose $/h falls below the major-zone benchmark even if $/km clears it', () => {
    const verdict = evaluatePromotionCandidate(
      perf({ avgPerKm: 2.0, avgPerH: 20 }),
      benchmark,
    );
    expect(verdict.eligible).toBe(false);
    expect(verdict.reason).toMatch(/\$\/h/);
  });

  it('accepts a candidate exactly at the benchmark (>=, not strictly >)', () => {
    const verdict = evaluatePromotionCandidate(
      perf({ avgPerKm: benchmark.avgPerKm, avgPerH: benchmark.avgPerH }),
      benchmark,
    );
    expect(verdict.eligible).toBe(true);
  });

  it('rejects a spot seen many times but that never earned well (repetition alone is not enough)', () => {
    const verdict = evaluatePromotionCandidate(
      perf({ occurrenceCount: 20, sampleSize: 20, avgPerKm: 0.8, avgPerH: 18 }),
      benchmark,
    );
    expect(verdict.eligible).toBe(false);
  });
});

// Guardrail confirmed 2026-09-19 ("Algorithm Alignment"): a micro-zone may
// only outrank a major hub when its recurrence AND performance are both
// backed by the SAME hour window as right now -- never on an all-day
// average, and never on repetition alone (same failure mode as the
// zone_discoveries auto-promote trigger this mirrors).
describe('evaluateHourClusteredCandidate', () => {
  function hourPerf(overrides: Partial<DiscoveryPerformance> = {}): DiscoveryPerformance {
    return {
      occurrenceCount: MIN_SAMPLE_SIZE_AT_HOUR,
      sampleSize: MIN_SAMPLE_SIZE_AT_HOUR,
      avgPerKm: 1.8,
      avgPerH: 35,
      ...overrides,
    };
  }

  it('is eligible when 3+ real trips at this exact hour window beat the hour-window benchmark on both metrics', () => {
    const verdict = evaluateHourClusteredCandidate(hourPerf(), benchmark);
    expect(verdict.eligible).toBe(true);
  });

  it('rejects a spot with only 2 trips in this hour window, even if it earned well overall', () => {
    const verdict = evaluateHourClusteredCandidate(
      hourPerf({ sampleSize: MIN_SAMPLE_SIZE_AT_HOUR - 1 }),
      benchmark,
    );
    expect(verdict.eligible).toBe(false);
    expect(verdict.reason).toMatch(/cette heure/i);
  });

  it('rejects a spot with no usable $/km or $/h at this hour window', () => {
    const verdict = evaluateHourClusteredCandidate(
      hourPerf({ avgPerKm: null, avgPerH: null }),
      benchmark,
    );
    expect(verdict.eligible).toBe(false);
  });

  it('rejects when $/km at this hour window falls below the hour-window major-zone benchmark', () => {
    const verdict = evaluateHourClusteredCandidate(
      hourPerf({ avgPerKm: 1.2, avgPerH: 40 }),
      benchmark,
    );
    expect(verdict.eligible).toBe(false);
    expect(verdict.reason).toMatch(/\$\/km/);
  });

  it('rejects when $/h at this hour window falls below the hour-window major-zone benchmark', () => {
    const verdict = evaluateHourClusteredCandidate(
      hourPerf({ avgPerKm: 2.0, avgPerH: 20 }),
      benchmark,
    );
    expect(verdict.eligible).toBe(false);
    expect(verdict.reason).toMatch(/\$\/h/);
  });

  it('never becomes eligible on hour-window recurrence alone, no matter how many trips', () => {
    const verdict = evaluateHourClusteredCandidate(
      hourPerf({ sampleSize: 50, avgPerKm: 0.5, avgPerH: 10 }),
      benchmark,
    );
    expect(verdict.eligible).toBe(false);
  });
});

describe('hourWindowFor', () => {
  it('buckets a weekday morning into a non-weekend window starting at the current hour', () => {
    // Monday 2026-09-14 07:15 (day 1 = Monday)
    const window = hourWindowFor(new Date(2026, 8, 14, 7, 15));
    expect(window).toEqual({ startHour: 7, endHour: 8, weekend: false });
  });

  it('flags Saturday/Sunday as weekend', () => {
    // Saturday 2026-09-19
    const window = hourWindowFor(new Date(2026, 8, 19, 14, 0));
    expect(window.weekend).toBe(true);
  });

  it('wraps endHour past midnight', () => {
    const window = hourWindowFor(new Date(2026, 8, 19, 23, 30));
    expect(window).toEqual({ startHour: 23, endHour: 0, weekend: true });
  });
});
