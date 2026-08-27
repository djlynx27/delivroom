import { formatHoursMinutes, formatMoney, toValidDate } from '@/pages/TodayScreen';
import { describe, expect, it } from 'vitest';

describe('formatMoney', () => {
  it('rounds and appends the $ sign', () => {
    expect(formatMoney(42.7)).toBe('43 $');
  });

  it('renders "0 $" for null/undefined via ?? guard', () => {
    expect(formatMoney(null as unknown as number)).toBe('0 $');
    expect(formatMoney(undefined as unknown as number)).toBe('0 $');
  });

  it('renders "0 $" for zero', () => {
    expect(formatMoney(0)).toBe('0 $');
  });
});

describe('formatHoursMinutes', () => {
  it('formats a normal duration', () => {
    expect(formatHoursMinutes(1.5)).toBe('1h30');
  });

  it('formats zero hours', () => {
    expect(formatHoursMinutes(0)).toBe('0h00');
  });

  it('guards null/undefined to 0h00', () => {
    expect(formatHoursMinutes(null as unknown as number)).toBe('0h00');
    expect(formatHoursMinutes(undefined as unknown as number)).toBe('0h00');
  });

  it('clamps a negative value to 0h00', () => {
    expect(formatHoursMinutes(-2)).toBe('0h00');
  });
});

describe('toValidDate', () => {
  it('parses a valid ISO string', () => {
    const d = toValidDate('2026-08-27T12:00:00Z');
    expect(d).toBeInstanceOf(Date);
    expect(d?.getTime()).toBe(new Date('2026-08-27T12:00:00Z').getTime());
  });

  it('returns null for null/undefined/empty', () => {
    expect(toValidDate(null)).toBeNull();
    expect(toValidDate(undefined)).toBeNull();
    expect(toValidDate('')).toBeNull();
  });

  it('returns null for an unparseable string', () => {
    expect(toValidDate('not-a-date')).toBeNull();
  });
});
