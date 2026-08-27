import { useArrivalCountdown } from '@/hooks/useArrivalCountdown';
import { renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const zoneA = { id: 'zone-a', name: 'Zone A', latitude: 45.5, longitude: -73.6 };
const zoneB = { id: 'zone-b', name: 'Zone B', latitude: 45.6, longitude: -73.5 };
const insideRadius = { latitude: 45.5, longitude: -73.6 }; // same point as zoneA
const outsideRadius = { latitude: 45.55, longitude: -73.55 }; // several km away

describe('useArrivalCountdown', () => {
  beforeEach(() => {
    localStorage.clear();
  });
  afterEach(() => {
    localStorage.clear();
  });

  it('arms the countdown on arrival, and does not immediately re-arm after cancel while still parked', () => {
    const onComplete = vi.fn();
    const { result, rerender } = renderHook(
      ({ zone, location }) => useArrivalCountdown(zone, location, onComplete),
      { initialProps: { zone: zoneA, location: insideRadius } }
    );

    expect(result.current.isCountingDown).toBe(true);

    result.current.cancel();
    rerender({ zone: zoneA, location: insideRadius });

    // Bug this guards: cancel() clearing countdownState used to immediately
    // re-trigger arrival detection since the driver never left the radius,
    // making the "X" button look like it did nothing.
    expect(result.current.isCountingDown).toBe(false);
  });

  it('re-arms for the same zone once the driver leaves and returns', () => {
    const onComplete = vi.fn();
    const { result, rerender } = renderHook(
      ({ zone, location }) => useArrivalCountdown(zone, location, onComplete),
      { initialProps: { zone: zoneA, location: insideRadius } }
    );

    result.current.cancel();
    rerender({ zone: zoneA, location: outsideRadius });
    expect(result.current.isCountingDown).toBe(false);

    rerender({ zone: zoneA, location: insideRadius });
    expect(result.current.isCountingDown).toBe(true);
  });

  it('arms for a different zone right after dismissing the first', () => {
    const onComplete = vi.fn();
    const { result, rerender } = renderHook(
      ({ zone, location }) => useArrivalCountdown(zone, location, onComplete),
      { initialProps: { zone: zoneA, location: insideRadius } }
    );

    result.current.cancel();
    rerender({ zone: zoneB, location: zoneB });
    expect(result.current.isCountingDown).toBe(true);
    expect(result.current.arrivedZoneName).toBe('Zone B');
  });
});
