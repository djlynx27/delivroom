import { computeEndedAt, resolveDurationMinutes } from '@/lib/tripSave';
import { describe, expect, it } from 'vitest';

describe('resolveDurationMinutes', () => {
  it('sums pickup + ride legs when both are present', () => {
    expect(resolveDurationMinutes({ pickup_time_minutes: 3, ride_time_minutes: 12 })).toBe(15);
  });

  it('falls back to the ride leg alone when pickup time is missing', () => {
    expect(resolveDurationMinutes({ ride_time_minutes: 12 })).toBe(12);
  });

  it('falls back to hours_worked for shift-summary screenshots', () => {
    expect(resolveDurationMinutes({ hours_worked: 2 })).toBe(120);
  });

  it('returns null when nothing usable was extracted', () => {
    expect(resolveDurationMinutes({})).toBeNull();
  });
});

describe('computeEndedAt', () => {
  it('adds duration_minutes onto started_at', () => {
    const result = computeEndedAt('2026-09-09T10:00:00.000Z', 30);
    expect(result).toBe('2026-09-09T10:30:00.000Z');
  });

  it('returns null when duration is unknown', () => {
    expect(computeEndedAt('2026-09-09T10:00:00.000Z', null)).toBeNull();
  });

  it('returns null when duration is zero or negative rather than guessing', () => {
    expect(computeEndedAt('2026-09-09T10:00:00.000Z', 0)).toBeNull();
    expect(computeEndedAt('2026-09-09T10:00:00.000Z', -5)).toBeNull();
  });
});
