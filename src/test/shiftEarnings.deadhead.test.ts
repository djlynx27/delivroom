import type { LearningInsights } from '@/lib/learningEngine';
import { DEFAULT_WEIGHTS } from '@/lib/scoringEngine';
import { getLearningAdjustedEarningsPerHour } from '@/lib/shiftEarnings';
import { describe, expect, it } from 'vitest';

const PRIME_BLOCK = { startHour: 16, endHour: 18, hours: 2 };

function buildInsights(overrides: Partial<LearningInsights> = {}): LearningInsights {
  return {
    emaPatterns: [],
    beliefs: [],
    predictions: [],
    meanAbsoluteError: 0,
    accuracyPercent: 0,
    suggestedWeights: DEFAULT_WEIGHTS,
    suggestions: [],
    weightAdjustmentSuggestions: [],
    topLearnedZones: [],
    ...overrides,
  };
}

describe('getLearningAdjustedEarningsPerHour — deadhead penalty', () => {
  it('discounts the baseline projection for a zone with heavy known deadhead, even with no exact slot match', () => {
    const insights = buildInsights({
      emaPatterns: [
        {
          zoneId: 'zone-heavy-deadhead',
          zoneName: 'Zone Test',
          dayOfWeek: 2, // Tuesday — irrelevant block below is Wednesday-ish, no exact match
          slotIndex: 0,
          emaEarningsPerHour: 30,
          emaRideCount: 5,
          observationCount: 5,
          avgDeadheadKm: 6,
          deadheadPenaltyApplied: true,
        },
      ],
    });

    const withPenalty = getLearningAdjustedEarningsPerHour({
      bestScore: 70,
      block: PRIME_BLOCK,
      bestZoneId: 'zone-heavy-deadhead',
      learningInsights: insights,
      jsDay: 5, // Friday — doesn't match dayOfWeek 2, so no exact EMA hit
      realAvg: null,
    });

    const withoutPenalty = getLearningAdjustedEarningsPerHour({
      bestScore: 70,
      block: PRIME_BLOCK,
      bestZoneId: 'zone-clean',
      learningInsights: insights,
      jsDay: 5,
      realAvg: null,
    });

    expect(withPenalty).toBeLessThan(withoutPenalty);
    expect(withPenalty).toBeCloseTo(withoutPenalty * 0.85, 5);
  });

  it('leaves the projection unchanged when there is no learning history at all', () => {
    const result = getLearningAdjustedEarningsPerHour({
      bestScore: 70,
      block: PRIME_BLOCK,
      bestZoneId: 'zone-unknown',
      learningInsights: null,
      jsDay: 5,
      realAvg: null,
    });

    expect(result).toBeGreaterThan(0);
  });
});
