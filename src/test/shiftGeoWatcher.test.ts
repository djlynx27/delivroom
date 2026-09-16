import { describe, expect, it } from 'vitest';
import { evaluateZoneStay, ZONE_STAY_TIMER_MS } from '@/lib/shiftGeoWatcher';

describe('evaluateZoneStay', () => {
  it('clears state when no zone is in range', () => {
    const result = evaluateZoneStay({ zoneId: 'z1', enteredAt: 0, notified: false }, 1000, null);
    expect(result).toEqual({ state: null, shouldNotify: false });
  });

  it('starts a fresh timer on first entry into a zone', () => {
    const result = evaluateZoneStay(null, 1000, 'z1');
    expect(result).toEqual({
      state: { zoneId: 'z1', enteredAt: 1000, notified: false },
      shouldNotify: false,
    });
  });

  it('resets the timer when the nearest zone changes', () => {
    const prev = { zoneId: 'z1', enteredAt: 0, notified: false };
    const result = evaluateZoneStay(prev, 5000, 'z2');
    expect(result).toEqual({
      state: { zoneId: 'z2', enteredAt: 5000, notified: false },
      shouldNotify: false,
    });
  });

  it('does not notify before the 15-minute threshold', () => {
    const prev = { zoneId: 'z1', enteredAt: 0, notified: false };
    const result = evaluateZoneStay(prev, ZONE_STAY_TIMER_MS - 1, 'z1');
    expect(result.shouldNotify).toBe(false);
    expect(result.state).toEqual(prev);
  });

  it('notifies exactly once when the timer elapses in the same zone', () => {
    const prev = { zoneId: 'z1', enteredAt: 0, notified: false };
    const result = evaluateZoneStay(prev, ZONE_STAY_TIMER_MS, 'z1');
    expect(result).toEqual({
      state: { zoneId: 'z1', enteredAt: 0, notified: true },
      shouldNotify: true,
    });
  });

  it('does not re-notify on later callbacks in the same stay', () => {
    const prev = { zoneId: 'z1', enteredAt: 0, notified: true };
    const result = evaluateZoneStay(prev, ZONE_STAY_TIMER_MS + 60_000, 'z1');
    expect(result).toEqual({ state: prev, shouldNotify: false });
  });
});
