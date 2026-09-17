import { describe, expect, it } from 'vitest';
import {
  evaluateZoneStay,
  ZONE_STAY_TIMER_MS,
  evaluateCaptureTrigger,
  CAPTURE_AWAY_GRACE_MS,
} from '@/lib/shiftGeoWatcher';

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

describe('evaluateCaptureTrigger', () => {
  const T0 = 1_000_000;

  it('does nothing when there is no hero zone set yet', () => {
    const result = evaluateCaptureTrigger(null, T0, 'z1', null);
    expect(result.shouldCapture).toBe(false);
    expect(result.state.capturedZoneId).toBe(null);
  });

  it('does nothing on the first callback outside the hero zone (grace period)', () => {
    const result = evaluateCaptureTrigger(null, T0, 'z1', 'z2');
    expect(result.shouldCapture).toBe(false);
    expect(result.state).toEqual({ capturedZoneId: null, awayFromHeroSince: T0 });
  });

  it('fires once on arrival in the hero zone', () => {
    const result = evaluateCaptureTrigger(null, T0, 'z1', 'z1');
    expect(result).toEqual({
      state: { capturedZoneId: 'z1', awayFromHeroSince: null },
      shouldCapture: true,
    });
  });

  it('does not re-fire on later callbacks in the same hero-zone stay', () => {
    const prev = { capturedZoneId: 'z1', awayFromHeroSince: null };
    const result = evaluateCaptureTrigger(prev, T0 + 60_000, 'z1', 'z1');
    expect(result).toEqual({ state: prev, shouldCapture: false });
  });

  it('does not clear the captured mark on a brief excursion within the grace period', () => {
    const prev = { capturedZoneId: 'z1', awayFromHeroSince: null };
    const jitter = evaluateCaptureTrigger(prev, T0, 'z2', 'z1');
    expect(jitter.state).toEqual({ capturedZoneId: 'z1', awayFromHeroSince: T0 });

    const back = evaluateCaptureTrigger(jitter.state, T0 + 30_000, 'z1', 'z1');
    expect(back).toEqual({
      state: { capturedZoneId: 'z1', awayFromHeroSince: null },
      shouldCapture: false,
    });
  });

  it('clears the captured mark once the driver has been away past the grace period', () => {
    const prev = { capturedZoneId: 'z1', awayFromHeroSince: T0 };
    const result = evaluateCaptureTrigger(prev, T0 + CAPTURE_AWAY_GRACE_MS, 'z2', 'z1');
    expect(result.state).toEqual({ capturedZoneId: null, awayFromHeroSince: T0 });
    expect(result.shouldCapture).toBe(false);
  });

  it('re-fires on a later real re-entry into the hero zone', () => {
    const left = { capturedZoneId: null, awayFromHeroSince: T0 };
    const reentered = evaluateCaptureTrigger(left, T0 + CAPTURE_AWAY_GRACE_MS + 1000, 'z1', 'z1');
    expect(reentered).toEqual({
      state: { capturedZoneId: 'z1', awayFromHeroSince: null },
      shouldCapture: true,
    });
  });
});
