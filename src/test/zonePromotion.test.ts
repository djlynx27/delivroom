import {
  evaluatePromotionCandidate,
  MIN_OCCURRENCES_FOR_AUTO_PROMOTION,
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
