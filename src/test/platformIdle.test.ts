import {
  formatIdleTime,
  idleMinutes,
  MAX_IDLE_MINUTES,
  type PlatformState,
} from '@/lib/platformIdle';
import { describe, expect, it } from 'vitest';

const NOW = new Date('2026-08-27T12:00:00Z').getTime();

function state(overrides: Partial<PlatformState> = {}): PlatformState {
  return { online: true, lastRideAt: null, onlineSince: null, ...overrides };
}

describe('idleMinutes', () => {
  it('returns null when offline', () => {
    expect(idleMinutes(state({ online: false, onlineSince: NOW }), NOW)).toBeNull();
  });

  it('returns null when there is no anchor at all', () => {
    expect(idleMinutes(state(), NOW)).toBeNull();
  });

  it('prefers lastRideAt over onlineSince', () => {
    const tenMinAgo = NOW - 10 * 60_000;
    const thirtyMinAgo = NOW - 30 * 60_000;
    expect(
      idleMinutes(state({ lastRideAt: tenMinAgo, onlineSince: thirtyMinAgo }), NOW)
    ).toBe(10);
  });

  it('treats an anchor of 0 (Unix Epoch) as garbage, not a real timestamp', () => {
    expect(idleMinutes(state({ onlineSince: 0 }), NOW)).toBeNull();
  });

  it('treats a negative anchor as garbage', () => {
    expect(idleMinutes(state({ onlineSince: -1 }), NOW)).toBeNull();
  });

  it('returns null when the computed duration exceeds 24h', () => {
    const twoDaysAgo = NOW - 2 * 24 * 60 * 60_000;
    expect(idleMinutes(state({ onlineSince: twoDaysAgo }), NOW)).toBeNull();
  });

  it('accepts a duration right at the 24h boundary', () => {
    const exactly24h = NOW - MAX_IDLE_MINUTES * 60_000;
    expect(idleMinutes(state({ onlineSince: exactly24h }), NOW)).toBe(MAX_IDLE_MINUTES);
  });

  it('returns null when the anchor is in the future (negative duration)', () => {
    const future = NOW + 60_000;
    expect(idleMinutes(state({ onlineSince: future }), NOW)).toBeNull();
  });
});

describe('formatIdleTime', () => {
  it('renders "live" for 0 minutes', () => {
    expect(formatIdleTime(0)).toBe('live');
  });

  it('renders "X min" for a normal value', () => {
    expect(formatIdleTime(12)).toBe('12 min');
  });

  it('renders "0 min" for null', () => {
    expect(formatIdleTime(null)).toBe('0 min');
  });

  it('renders "0 min" for a negative value', () => {
    expect(formatIdleTime(-5)).toBe('0 min');
  });

  it('renders "0 min" for a value beyond the 24h cap', () => {
    expect(formatIdleTime(MAX_IDLE_MINUTES + 1)).toBe('0 min');
  });
});
