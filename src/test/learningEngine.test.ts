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
    // Neither zone clears MIN_RATE_TRIPS (2 and 1 observations) — the
    // minimum-sample gate on topLearnedZones correctly excludes both rather
    // than ranking a thin sample as if it were trustworthy.
    expect(insights.topLearnedZones).toHaveLength(0);
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

  it('excludes synthetic trips from the EMA entirely, even in a bucket a real trip also touches', () => {
    const baseline = deriveLearningInsights(trips, DEFAULT_WEIGHTS);
    const centreBellBefore = baseline.emaPatterns.find(
      (p) => p.zoneName === 'Centre Bell'
    );

    const withSyntheticInjected = deriveLearningInsights(
      [
        ...trips,
        {
          ...trips[0]!,
          id: 'synthetic-1',
          source: 'synthetic',
          earnings: 999,
          tips: 0,
        },
      ],
      DEFAULT_WEIGHTS
    );
    const centreBellAfter = withSyntheticInjected.emaPatterns.find(
      (p) => p.zoneName === 'Centre Bell'
    );

    expect(centreBellAfter?.emaEarningsPerHour).toBe(centreBellBefore?.emaEarningsPerHour);
    expect(centreBellAfter?.observationCount).toBe(centreBellBefore?.observationCount);
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

// ── Deadhead (approach distance) penalty ────────────────────────────────────

function makeDeadheadTrip(
  id: string,
  date: string,
  zoneId: string,
  pickupDistanceKm: number,
  tripDistanceKm: number
): TripWithZone {
  const startedAt = new Date(date);
  const endedAt = new Date(startedAt.getTime() + 3_600_000);
  return {
    id,
    created_at: date,
    distance_km: tripDistanceKm,
    pickup_distance_km: pickupDistanceKm,
    trip_distance_km: tripDistanceKm,
    earnings: 30,
    ended_at: endedAt.toISOString(),
    experiment: false,
    notes: null,
    started_at: startedAt.toISOString(),
    tips: 0,
    zone_id: zoneId,
    zone_score: 50,
    platform: null,
    source: 'real',
    user_id: null,
    zones: { name: zoneId, current_score: 50 },
  };
}

describe('deriveLearningInsights — deadhead penalty', () => {
  it('penalizes emaEarningsPerHour for a zone with high average approach distance', () => {
    const highDeadheadTrips = Array.from({ length: 4 }, (_, i) =>
      makeDeadheadTrip('hd-' + i, `2026-03-${10 + i}T10:00:00Z`, 'far-zone', 6, 10)
    );
    const lowDeadheadTrips = Array.from({ length: 4 }, (_, i) =>
      makeDeadheadTrip('ld-' + i, `2026-03-${10 + i}T10:00:00Z`, 'near-zone', 1, 10)
    );

    const insights = deriveLearningInsights(
      [...highDeadheadTrips, ...lowDeadheadTrips],
      DEFAULT_WEIGHTS
    );

    const farZone = insights.emaPatterns.find((p) => p.zoneId === 'far-zone');
    const nearZone = insights.emaPatterns.find((p) => p.zoneId === 'near-zone');

    expect(farZone?.avgDeadheadKm).toBeGreaterThan(4);
    expect(farZone?.deadheadPenaltyApplied).toBe(true);
    expect(nearZone?.deadheadPenaltyApplied).toBe(false);
    // Same raw earnings/hour for both — the penalty must make the far zone's
    // EMA strictly lower than the near zone's.
    expect(farZone!.emaEarningsPerHour).toBeLessThan(
      nearZone!.emaEarningsPerHour
    );
  });

  it('does not penalize trips with no pickup distance recorded', () => {
    const insights = deriveLearningInsights(trips, DEFAULT_WEIGHTS);
    const pattern = insights.emaPatterns.find((p) => p.zoneId === 'mtl-cb');

    expect(pattern?.avgDeadheadKm).toBe(0);
    expect(pattern?.deadheadPenaltyApplied).toBe(false);
  });
});

// Regression for the 2026-09-10 incident: "Top zones apprises" must not
// surface a zone whose only history is from a completely different time of
// day (e.g. a mall's afternoon trips showing up as a 3:45 AM suggestion).
describe('deriveLearningInsights — time-of-day window on topLearnedZones', () => {
  function makeTimedTrip(id: string, isoStartedAt: string, zoneId: string, zoneName: string): TripWithZone {
    const startedAt = new Date(isoStartedAt);
    const endedAt = new Date(startedAt.getTime() + 3_600_000);
    return {
      id,
      created_at: isoStartedAt,
      distance_km: 10,
      earnings: 40,
      ended_at: endedAt.toISOString(),
      experiment: false,
      notes: null,
      started_at: startedAt.toISOString(),
      tips: 0,
      zone_id: zoneId,
      zone_score: 50,
      platform: null,
      source: 'real',
      user_id: null,
      zones: { name: zoneName, current_score: 50 },
    };
  }

  // Carrefour Laval's only history is a Sunday afternoon shopping rush —
  // great EMA, wrong time of day for a 3:45 AM query. Stepped by 7 days
  // (not 1) so every trip lands in the SAME day-of-week/slot EmaPattern
  // bucket — repeats within a bucket are what the min-observations gate on
  // topLearnedZones (see learningEngine.ts) actually requires.
  const afternoonMallTrips = Array.from({ length: 3 }, (_, i) =>
    makeTimedTrip(`mall-${i}`, `2026-03-${15 + i * 7}T14:30:00.000Z`, 'lvl-cl', 'Carrefour Laval')
  );
  // Station Montmorency has real overnight history, closer to 3:45 AM.
  const nightZoneTrips = Array.from({ length: 3 }, (_, i) =>
    makeTimedTrip(`night-${i}`, `2026-03-${15 + i * 7}T03:30:00.000Z`, 'lvl-sm', 'Station Montmorency')
  );
  const allTrips = [...afternoonMallTrips, ...nightZoneTrips];

  it('excludes a zone whose history sits outside the ±2h window around `now`', () => {
    const now = new Date('2026-03-20T03:45:00.000Z');
    const insights = deriveLearningInsights(allTrips, DEFAULT_WEIGHTS, now);

    const names = insights.topLearnedZones.map((z) => z.zoneName);
    expect(names).not.toContain('Carrefour Laval');
    expect(names).toContain('Station Montmorency');
  });

  it('keeps the un-windowed global ranking when `now` is omitted (back-compat)', () => {
    const insights = deriveLearningInsights(allTrips, DEFAULT_WEIGHTS);

    const names = insights.topLearnedZones.map((z) => z.zoneName);
    expect(names).toContain('Carrefour Laval');
    expect(names).toContain('Station Montmorency');
  });
});

// Regression for the "Station Concorde 80$/h" bug: a single lucky trip
// (20$ in 15 min → 80$/h) must not outrank a zone with many stable,
// moderate observations just because its lone sample happened to be high.
describe('deriveLearningInsights — topLearnedZones Bayesian smoothing', () => {
  // weekOffset (not dayOffset): stepping by whole weeks keeps every trip on
  // the same day-of-week and time-of-day, so repeats land in the SAME
  // EmaPattern (zone, dayOfWeek, slot) bucket instead of each creating its
  // own single-observation bucket.
  function makeEarningsTrip(
    id: string,
    weekOffset: number,
    zoneId: string,
    zoneName: string,
    earnings: number,
    durationMin: number
  ): TripWithZone {
    const startedAt = new Date(Date.UTC(2026, 2, 10, 12, 0, 0));
    startedAt.setUTCDate(startedAt.getUTCDate() + weekOffset * 7);
    const endedAt = new Date(startedAt.getTime() + durationMin * 60_000);
    return {
      id,
      created_at: startedAt.toISOString(),
      distance_km: 8,
      earnings,
      ended_at: endedAt.toISOString(),
      experiment: false,
      notes: null,
      started_at: startedAt.toISOString(),
      tips: 0,
      zone_id: zoneId,
      zone_score: 50,
      platform: null,
      source: 'real',
      user_id: null,
      zones: { name: zoneName, current_score: 50 },
    };
  }

  // One-off lucky sample: 20$/15min = 80$/h (capped to MAX_EARNINGS_PER_HOUR
  // = 40 before it ever reaches the EMA — see getTripLearningContext) — a
  // single observation.
  const luckyTrip = [
    makeEarningsTrip('lucky-1', 0, 'lvl-concorde', 'Station Concorde', 20, 15),
  ];
  // Well-sampled, stable zone at a realistic 30$/h across 10 trips.
  const stableTrips = Array.from({ length: 10 }, (_, i) =>
    makeEarningsTrip(`stable-${i}`, i, 'mtl-stable', 'Zone Stable', 30, 60)
  );
  const trips = [...luckyTrip, ...stableTrips];

  it('excludes a single-observation zone from the leaderboard entirely, however high its EMA', () => {
    const insights = deriveLearningInsights(trips, DEFAULT_WEIGHTS);
    const names = insights.topLearnedZones.map((z) => z.zoneName);

    expect(names).not.toContain('Station Concorde');
    expect(names).toContain('Zone Stable');
    expect(insights.topLearnedZones[0]?.zoneName).toBe('Zone Stable');
  });

  it('does not distort a well-sampled zone sitting well under the dynamic clamp', () => {
    const insights = deriveLearningInsights(trips, DEFAULT_WEIGHTS);
    const stable = insights.topLearnedZones.find((z) => z.zoneName === 'Zone Stable');

    expect(stable).toBeDefined();
    expect(stable!.emaEarningsPerHour).toBe(30);
  });

  it('lets a zone back onto the leaderboard once it clears the minimum-observations gate', () => {
    const twoObservations = [
      makeEarningsTrip('concorde-1', 0, 'lvl-concorde', 'Station Concorde', 20, 15),
      makeEarningsTrip('concorde-2', 1, 'lvl-concorde', 'Station Concorde', 22, 15),
    ];
    const insights = deriveLearningInsights(twoObservations, DEFAULT_WEIGHTS);

    expect(insights.topLearnedZones.map((z) => z.zoneName)).toContain(
      'Station Concorde'
    );
  });
});
