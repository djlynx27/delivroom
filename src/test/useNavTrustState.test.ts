import { computeNavTrustState } from '@/hooks/useNavTrustState';
import { describe, expect, it } from 'vitest';

describe('computeNavTrustState', () => {
  it('blocks NAVIGUER while unconfirmed and grace period has not elapsed', () => {
    expect(computeNavTrustState(false, false, false)).toBe('confirming');
    expect(computeNavTrustState(true, false, false)).toBe('confirming');
    expect(computeNavTrustState(false, true, false)).toBe('confirming');
  });

  it('is live once both GPS and scores are confirmed live, even past grace', () => {
    expect(computeNavTrustState(true, true, false)).toBe('live');
    expect(computeNavTrustState(true, true, true)).toBe('live');
  });

  it('falls back to offline once the grace period elapses without confirmation', () => {
    expect(computeNavTrustState(false, false, true)).toBe('offline');
    expect(computeNavTrustState(true, false, true)).toBe('offline');
  });
});
