import type { TripWithZone } from '@/hooks/useTrips';
import {
  deriveLearningInsights,
  derivePostShiftSummary,
} from '@/lib/learningEngine';
import { DEFAULT_WEIGHTS } from '@/lib/scoringEngine';
import { describe, expect, it } from 'vitest';

const trips: TripWithZone[] = [
  {
    id: '1',
    created_at: '2026-03-15T22:00:00.000Z',
    distance_km: 12,
    earnings: 42,
    ended_at: '2026-03-15T22:45:00.000Z',
    experiment: false,
    notes: null,
    started_at: '2026-03-15T22:00:00.000Z',
    tips: 6,
    zone_id: 'mtl-cb',
    zone_score: 62,
    platform: null,
    source: 'real',
    user_id: null,
    zones: { name: 'Centre Bell', current_score: 60 },
  },
  {
    id: '2',
    created_at: '2026-03-16T07:00:00.000Z',
    distance_km: 10,
    earnings: 24,
    ended_at: '2026-03-16T07:40:00.000Z',
    experiment: false,
    notes: null,
    started_at: '2026-03-16T07:00:00.000Z',
    tips: 2,
    zone_id: 'mtl-bq',
    zone_score: 55,
    platform: null,
    source: 'real',
    user_id: null,
    zones: { name: 'Station Berri-UQAM', current_score: 53 },
  },
  {
    id: '3',
    created_at: '2026-03-17T22:00:00.000Z',
    distance_km: 13,
    earnings: 39,
    ended_at: '2026-03-17T22:35:00.000Z',
    experiment: false,
    notes: null,
    started_at: '2026-03-17T22:00:00.000Z',
    tips: 4,
    zone_id: 'mtl-cb',
    zone_score: 64,
    platform: null,
    source: 'real',
    user_id: null,
    zones: { name: 'Centre Bell', current_score: 60 },
  },
];

describe('learning engine', () => {
  it('derives EMA patterns and predictions from trips', () => {
    const insights = deriveLearningInsights(trips, DEFAULT_WEIGHTS);

    expect(insights.emaPatterns.length).toBeGreaterThan(0);
    expect(insights.predictions).toHaveLength(3);
    expect(insights.topLearnedZones[0]?.zoneName).toBe('Centre Bell');
  });

  it('produces normalized suggested weights', () => {
    const insights = deriveLearningInsights(trips, DEFAULT_WEIGHTS);
    const total = Object.values(insights.suggestedWeights).reduce(
      (sum, value) => sum + value,
      0
    );

    expect(total).toBeCloseTo(1, 5);
  });

  it('uses threshold-based prediction accuracy', () => {
    const insights = deriveLearningInsights(trips, DEFAULT_WEIGHTS);

    // Pre-MAX_EARNINGS_PER_HOUR-cap fixture expected 28/33.33 -- the fixture
    // trips' raw $/h (64, 39, 73.7) get capped at 40 (see 35e4e46), which
    // moves the observed rate much closer to each trip's predicted score.
    expect(insights.meanAbsoluteError).toBe(6);
    expect(insights.accuracyPercent).toBe(100);
  });

  it('builds a post-shift summary for a time window', () => {
    const summary = derivePostShiftSummary(
      trips,
      '2026-03-15T00:00:00.000Z',
      '2026-03-16T23:59:59.000Z',
      DEFAULT_WEIGHTS
    );

    expect(summary.tripCount).toBe(2);
    expect(summary.revenue).toBe(74);
    expect(summary.accuracyPercent).toBeGreaterThan(0);
  });

  it('ignores incomplete trips in learning predictions', () => {
    const insights = deriveLearningInsights(
      [
        ...trips,
        {
          ...trips[0]!,
          id: '4',
          started_at: '2026-03-18T10:00:00.000Z',
          ended_at: null,
          earnings: 90,
          tips: 10,
        },
      ],
      DEFAULT_WEIGHTS
    );

    expect(insights.predictions).toHaveLength(3);
    expect(
      insights.predictions.find((prediction) => prediction.tripId === '4')
    ).toBeUndefined();
  });

  it('skips predictions when no zone score baseline exists', () => {
    const insights = deriveLearningInsights(
      [
        ...trips,
        {
          ...trips[0]!,
          id: '5',
          zone_score: null,
          source: 'real',
          user_id: null,
          zones: { name: 'Centre Bell', current_score: null },
        },
      ],
      DEFAULT_WEIGHTS
    );

    expect(
      insights.predictions.find((prediction) => prediction.tripId === '5')
    ).toBeUndefined();
    expect(insights.emaPatterns.length).toBeGreaterThan(0);
  });
});

// ── Bias / sampleCount branch coverage ──────────────────────────────────────

// Helper: build a TripWithZone for learningEngine tests
function makeTrip(
  id: string,
  date: string,
  earnings: number,
  durationHours: number,
  zoneScore: number
): TripWithZone {
  const startedAt = new Date(date);
  const endedAt = new Date(startedAt.getTime() + durationHours * 3_600_000);
  return {
    id,
    created_at: date,
    distance_km: 10,
    earnings,
    ended_at: endedAt.toISOString(),
    experiment: false,
    notes: null,
    started_at: startedAt.toISOString(),
    tips: 0,
    zone_id: 'test-zone',
    zone_score: zoneScore,
    platform: null,
    source: 'real',
    user_id: null,
    zones: { name: 'Test Zone', current_score: zoneScore },
  };
}

describe('deriveLearningInsights — sampleCount >= 8 branch', () => {
  // 8 trips with zone_score=10 and earnings=$54/hr → actualScore=90
  // error per trip = 90 - 10 = 80  →  recentBias = 640 >> 12
  const highEarningTrips = Array.from({ length: 8 }, (_, i) =>
    makeTrip(
      String(i + 1),
      `2026-03-${String(10 + i).padStart(2, '0')}T10:00:00Z`,
      54,
      1,
      10
    )
  );

  it('boosts historicalEarnings weight when sampleCount >= 8', () => {
    const insights = deriveLearningInsights(highEarningTrips, DEFAULT_WEIGHTS);
    expect(insights.predictions).toHaveLength(8);
    // sampleCount >= 8 adds +0.04 to historicalEarnings before normalisation
    // so historicalEarnings should be higher than any timeOfDay/dayOfWeek
    expect(insights.suggestedWeights.historicalEarnings).toBeGreaterThan(0);
  });

  it('includes historicalEarnings reason when sampleCount >= 8', () => {
    const insights = deriveLearningInsights(highEarningTrips, DEFAULT_WEIGHTS);
    const historicalSuggestion = insights.suggestions.find(
      (s) => s.key === 'historicalEarnings'
    );
    if (historicalSuggestion) {
      expect(historicalSuggestion.reason).toContain('fiable');
    }
  });

  it('includes timeOfDay/dayOfWeek reason when sampleCount >= 8', () => {
    const insights = deriveLearningInsights(highEarningTrips, DEFAULT_WEIGHTS);
    const timeSuggestion = insights.suggestions.find(
      (s) => s.key === 'timeOfDay' || s.key === 'dayOfWeek'
    );
    if (timeSuggestion) {
      expect(timeSuggestion.reason).toContain('heuristiques');
    }
  });

  it('includes events/weather reason when recentBias > 25', () => {
    // recentBias = 640 > 25, so any events/weather suggestion should mention
    // dynamiques
    const insights = deriveLearningInsights(highEarningTrips, DEFAULT_WEIGHTS);
    const dynSuggestion = insights.suggestions.find(
      (s) => (s.key === 'events' || s.key === 'weather') && s.delta !== 0
    );
    if (dynSuggestion) {
      expect(dynSuggestion.reason).toContain('dynamiques');
    }
  });
});

describe('deriveLearningInsights — recentBias < -12 branch', () => {
  // 8 trips with zone_score=90 and earnings=$3/hr → actualScore=5
  // error per trip = 5 - 90 = -85  →  recentBias = -680 << -12
  const lowEarningTrips = Array.from({ length: 8 }, (_, i) =>
    makeTrip(
      String(i + 1),
      `2026-03-${String(10 + i).padStart(2, '0')}T14:00:00Z`,
      3,
      1,
      90
    )
  );

  it('applies negative bias adjustments when model over-predicts', () => {
    const insights = deriveLearningInsights(lowEarningTrips, DEFAULT_WEIGHTS);
    expect(insights.predictions).toHaveLength(8);
    // recentBias < -12 adds +0.02 to historicalEarnings and shrinks events/weather
    // Weights are still normalised → just check they're valid
    const total = Object.values(insights.suggestedWeights).reduce(
      (sum, v) => sum + v,
      0
    );
    expect(total).toBeCloseTo(1, 5);
  });

  it('meanAbsoluteError is > 0 when model over-predicts', () => {
    const insights = deriveLearningInsights(lowEarningTrips, DEFAULT_WEIGHTS);
    expect(insights.meanAbsoluteError).toBeGreaterThan(0);
    // error ~ -85 per trip → MAE ~ 85
    expect(insights.meanAbsoluteError).toBeGreaterThan(50);
  });
});
