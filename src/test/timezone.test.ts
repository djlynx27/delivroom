import { getMontrealDayStart } from '@/lib/timezone';
import { describe, expect, it } from 'vitest';

describe('getMontrealDayStart', () => {
  it('resolves to the Montreal calendar day, not the device/UTC one (EST, winter)', () => {
    // 2026-01-15T03:30:00Z = 2026-01-14T22:30:00-05:00 in Montreal (EST) --
    // "today" in Montreal is still Jan 14 even though UTC has already
    // rolled over to Jan 15.
    const now = new Date('2026-01-15T03:30:00Z');
    const start = getMontrealDayStart(now);
    expect(start.toISOString()).toBe('2026-01-14T05:00:00.000Z');
  });

  it('resolves correctly during EDT (summer, UTC-4)', () => {
    const now = new Date('2026-07-15T13:00:00Z'); // 09:00 EDT, same calendar day
    const start = getMontrealDayStart(now);
    expect(start.toISOString()).toBe('2026-07-15T04:00:00.000Z');
  });

  it('is independent of the JS runtime/device timezone', () => {
    // Simulates a device with a bogus system timezone by just calling with a
    // fixed instant -- getMontrealDayStart must not depend on Date's own
    // implicit local-timezone getters (getHours/setHours).
    const now = new Date('2026-03-01T04:00:00Z'); // 23:00 EST Feb 28
    const start = getMontrealDayStart(now);
    expect(start.toISOString()).toBe('2026-02-28T05:00:00.000Z');
  });
});
