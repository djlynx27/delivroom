import {
  applyOvernightRealityCap,
  buildTripHistory,
  toFiniteNumber,
} from '@/hooks/useDemandScores';
import type { Zone } from '@/hooks/useSupabase';
import type { TripWithZone } from '@/hooks/useTrips';
import { makeLocalDate } from '@/test/dateTestUtils';
import { TRIP_DEFAULTS } from '@/test/tripFixtures';
import { describe, expect, it } from 'vitest';

const zones: Zone[] = [
  {
    id: 'zone-1',
    city_id: 'city-1',
    name: 'Centre Bell',
    latitude: 45.4969,
    longitude: -73.5698,
    created_at: '2026-03-20T00:00:00.000Z',
    updated_at: '2026-03-20T00:00:00.000Z',
    type: 'événements',
    current_score: 64,
    base_score: 52,
    address: null,
    category: null,
    territory: null,
    event_id: null,
    is_temporal: false,
    active_windows: [],
  },
];

const completeTrip: TripWithZone = {
  ...TRIP_DEFAULTS,
  id: 'trip-1',
  created_at: '2026-03-20T00:00:00.000Z',
  distance_km: 12,
  earnings: 30,
  ended_at: '2026-03-20T12:30:00.000Z',
  experiment: false,
  notes: null,
  started_at: '2026-03-20T12:00:00.000Z',
  tips: 6,
  zone_id: 'zone-1',
  zone_score: 58,
  platform: 'lyft',
  source: 'real',
  user_id: null,
  zones: {
    name: 'Centre Bell',
    type: 'événements',
    current_score: 64,
  },
};

describe('buildTripHistory', () => {
  it('skips incomplete trips without ended_at', () => {
    const history = buildTripHistory(
      [
        completeTrip,
        {
          ...completeTrip,
          id: 'trip-2',
          ended_at: null,
          earnings: 48,
          tips: 4,
        },
      ],
      zones
    );

    expect(history).toHaveLength(1);
    expect(history[0]).toMatchObject({
      zoneId: 'zone-1',
      expectedScore: 58,
      observedScore: 100,
    });
  });

  it('skips trips whose zone is not present in the active city', () => {
    const history = buildTripHistory(
      [
        {
          ...completeTrip,
          id: 'trip-3',
          zone_id: 'zone-other-city',
          zones: {
            name: 'Old Port',
            type: 'tourisme',
            current_score: 71,
          },
        },
      ],
      zones
    );

    expect(history).toEqual([]);
  });
});

describe('applyOvernightRealityCap', () => {
  it('caps unsupported overnight commercial scores', () => {
    const capped = applyOvernightRealityCap({
      score: 100,
      zoneType: 'commercial',
      now: makeLocalDate(2026, 2, 21, 2),
      hasRelevantEvent: false,
      weatherBoostPoints: 0,
      lyftDemandLevel: 3,
      estimatedWaitMin: 8,
      surgeActive: false,
    });

    expect(capped).toBe(60);
  });

  it('keeps overnight nightlife scores when a real event backs the zone', () => {
    const capped = applyOvernightRealityCap({
      score: 92,
      zoneType: 'nightlife',
      now: makeLocalDate(2026, 2, 21, 2),
      hasRelevantEvent: true,
      weatherBoostPoints: 0,
      lyftDemandLevel: 4,
      estimatedWaitMin: 7,
      surgeActive: false,
    });

    expect(capped).toBe(92);
  });

  it('does not cap daytime scores', () => {
    const capped = applyOvernightRealityCap({
      score: 95,
      zoneType: 'commercial',
      now: makeLocalDate(2026, 2, 21, 14),
      hasRelevantEvent: false,
      weatherBoostPoints: 0,
      lyftDemandLevel: 3,
      estimatedWaitMin: 8,
      surgeActive: false,
    });

    expect(capped).toBe(95);
  });
});

describe('toFiniteNumber', () => {
  // Regression: scores.final_score/weather_boost/event_boost are Postgres
  // NUMERIC(6,2) columns -- PostgREST serializes NUMERIC as a JSON string
  // ("69.00", not 69) even though the generated Supabase types (incorrectly)
  // claim `number | null`. Left uncoerced, "69.00" + 3.2 concatenates into
  // "69.003.2" instead of adding -- this is what produced the garbled
  // zone-score display bug (e.g. Station Montmorency showing "088342").
  it('parses a NUMERIC-column string into a real number', () => {
    expect(toFiniteNumber('69.00', 0)).toBe(69);
    expect(toFiniteNumber('0.00', 50)).toBe(0);
  });

  it('passes a genuine number through unchanged', () => {
    expect(toFiniteNumber(86, 0)).toBe(86);
  });

  it('falls back on null/undefined', () => {
    expect(toFiniteNumber(null, 50)).toBe(50);
    expect(toFiniteNumber(undefined, 50)).toBe(50);
  });

  it('falls back on a non-numeric or malformed string instead of returning NaN', () => {
    expect(toFiniteNumber('not-a-number', 42)).toBe(42);
    expect(toFiniteNumber('69.003.2', 42)).toBe(42); // the exact double-decimal shape the bug produced
  });

  it('demonstrates the bug this guards against: unguarded "+" on the raw string', () => {
    const rawFromPostgrest = '69.00'; // what dbRow.final_score actually is at runtime
    const concatenated = rawFromPostgrest + 3.2;
    expect(concatenated).toBe('69.003.2'); // string concatenation, not 72.2

    const fixed = toFiniteNumber(rawFromPostgrest, 0) + 3.2;
    expect(fixed).toBeCloseTo(72.2, 5);
  });
});
