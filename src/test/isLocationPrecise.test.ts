import {
  isLocationPrecise,
  MAX_ZONE_MATCH_ACCURACY_M,
  useHasPreciseFix,
} from '@/hooks/useUserLocation';
import { renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

describe('isLocationPrecise', () => {
  it('accepts a fix at or under the accuracy threshold', () => {
    expect(isLocationPrecise({ accuracy: MAX_ZONE_MATCH_ACCURACY_M })).toBe(true);
    expect(isLocationPrecise({ accuracy: 10 })).toBe(true);
  });

  it('rejects a coarse fix above the threshold — the Longueuil/Montmorency bug', () => {
    expect(isLocationPrecise({ accuracy: MAX_ZONE_MATCH_ACCURACY_M + 1 })).toBe(false);
    expect(isLocationPrecise({ accuracy: 1200 })).toBe(false);
  });

  it('treats missing/null accuracy as imprecise rather than trusting it', () => {
    expect(isLocationPrecise({ accuracy: null })).toBe(false);
    expect(isLocationPrecise(null)).toBe(false);
  });
});

describe('useHasPreciseFix', () => {
  it('stays false while every fix is coarse (a cold GPS lock)', () => {
    const { result, rerender } = renderHook(
      ({ accuracy }) => useHasPreciseFix({ accuracy }),
      { initialProps: { accuracy: 1200 } }
    );
    expect(result.current).toBe(false);

    rerender({ accuracy: 300 });
    expect(result.current).toBe(false);
  });

  it('requires 2 consecutive precise samples before latching — a single refining fix must not flip the zone match', () => {
    const { result, rerender } = renderHook(
      ({ accuracy }) => useHasPreciseFix({ accuracy }),
      { initialProps: { accuracy: 1200 } }
    );
    expect(result.current).toBe(false);

    // First precise sample (e.g. a cold GPS lock still refining) — not enough alone.
    rerender({ accuracy: 45 });
    expect(result.current).toBe(false);

    // Second consecutive precise sample latches it.
    rerender({ accuracy: 8 });
    expect(result.current).toBe(true);
  });

  it('resets the consecutive-precise streak on an intervening coarse sample', () => {
    const { result, rerender } = renderHook(
      ({ accuracy }) => useHasPreciseFix({ accuracy }),
      { initialProps: { accuracy: 1200 } }
    );

    rerender({ accuracy: 45 });
    expect(result.current).toBe(false);

    rerender({ accuracy: 800 }); // blip resets the streak
    expect(result.current).toBe(false);

    rerender({ accuracy: 30 });
    expect(result.current).toBe(false);

    rerender({ accuracy: 20 });
    expect(result.current).toBe(true);
  });

  it('does not revert once latched, even on a later noisy sample', () => {
    const { result, rerender } = renderHook(
      ({ accuracy }) => useHasPreciseFix({ accuracy }),
      { initialProps: { accuracy: 45 } }
    );
    rerender({ accuracy: 8 });
    expect(result.current).toBe(true);

    // A later watchPosition blip (coarse sample) must not un-latch it.
    rerender({ accuracy: 800 });
    expect(result.current).toBe(true);
  });
});
