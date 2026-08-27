import { formatMinutes } from '@/components/DeadTimeTimer';
import { describe, expect, it } from 'vitest';

describe('formatMinutes', () => {
  it('formats a normal elapsed duration', () => {
    expect(formatMinutes(90_000)).toEqual({ display: '01:30', mins: 1 });
  });

  it('clamps to 00:00 for a negative value', () => {
    expect(formatMinutes(-1)).toEqual({ display: '00:00', mins: 0 });
  });

  it('clamps to 00:00 for NaN', () => {
    expect(formatMinutes(NaN)).toEqual({ display: '00:00', mins: 0 });
  });

  it('clamps to 00:00 for a value beyond 24h (the 109914:02 bug)', () => {
    const twoDaysMs = 2 * 24 * 60 * 60 * 1000;
    expect(formatMinutes(twoDaysMs)).toEqual({ display: '00:00', mins: 0 });
  });

  it('accepts a duration right at the 24h boundary', () => {
    const exactly24h = 24 * 60 * 60 * 1000;
    expect(formatMinutes(exactly24h)).toEqual({ display: '1440:00', mins: 1440 });
  });

  it('clamps to 00:00 for Infinity', () => {
    expect(formatMinutes(Infinity)).toEqual({ display: '00:00', mins: 0 });
  });
});
