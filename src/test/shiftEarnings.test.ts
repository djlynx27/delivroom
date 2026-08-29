import type { TripWithZone } from '@/hooks/useTrips';
import {
  blend,
  CONSERVATIVE_MAX_PER_H,
  CONSERVATIVE_MIN_PER_H,
  getRealAvgEarningsPerHour,
  sanitizeTargetRevenueInput,
  scoreToEarningsPerH,
} from '@/lib/shiftEarnings';
import { describe, expect, it } from 'vitest';

function trip(
  id: string,
  startedAt: string,
  endedAt: string,
  earnings: number,
  tips = 0
): TripWithZone {
  return {
    id,
    created_at: startedAt,
    distance_km: 5,
    earnings,
    ended_at: endedAt,
    experiment: false,
    notes: null,
    started_at: startedAt,
    tips,
    zone_id: 'downtown',
    zone_score: null,
    platform: 'lyft',
    source: 'real',
    user_id: null,
    zones: { name: 'Downtown' },
  } as TripWithZone;
}

describe('scoreToEarningsPerH', () => {
  it('stays within the conservative $22–25/h band across the whole score range', () => {
    for (const score of [0, 20, 40, 60, 80, 100]) {
      const value = scoreToEarningsPerH(score);
      expect(value).toBeGreaterThanOrEqual(CONSERVATIVE_MIN_PER_H);
      expect(value).toBeLessThanOrEqual(CONSERVATIVE_MAX_PER_H);
    }
  });

  it('scales with zone score', () => {
    expect(scoreToEarningsPerH(100)).toBeGreaterThan(scoreToEarningsPerH(0));
  });
});

describe('getRealAvgEarningsPerHour', () => {
  it('returns null below the minimum trip-count threshold', () => {
    const trips = [trip('1', '2026-03-15T08:00:00', '2026-03-15T09:00:00', 30)];
    expect(getRealAvgEarningsPerHour(trips)).toBeNull();
  });

  it('computes revenue-per-hour (earnings + tips) once there is enough history', () => {
    // 5 one-hour trips at $30 earnings + $5 tips = $35/h each.
    const trips = Array.from({ length: 5 }, (_, i) =>
      trip(
        String(i),
        `2026-03-1${i}T08:00:00`,
        `2026-03-1${i}T09:00:00`,
        30,
        5
      )
    );
    const result = getRealAvgEarningsPerHour(trips);
    expect(result).not.toBeNull();
    expect(result?.perHour).toBe(35);
    expect(result?.tripCount).toBe(5);
  });
});

describe('blend', () => {
  it('returns the preferred value at full trust', () => {
    expect(blend(40, 20, 1)).toBe(40);
  });

  it('returns the fallback value at zero trust', () => {
    expect(blend(40, 20, 0)).toBe(20);
  });

  it('interpolates at partial trust', () => {
    expect(blend(40, 20, 0.5)).toBe(30);
  });
});

describe('sanitizeTargetRevenueInput', () => {
  it('strips leading zeros', () => {
    expect(sanitizeTargetRevenueInput('02100')).toBe('2100');
  });

  it('allows the field to go fully empty', () => {
    expect(sanitizeTargetRevenueInput('')).toBe('');
  });

  it('collapses a lone zero to "0" rather than getting stuck', () => {
    expect(sanitizeTargetRevenueInput('00')).toBe('0');
  });

  it('strips non-digit characters', () => {
    expect(sanitizeTargetRevenueInput('2,100$')).toBe('2100');
  });
});
