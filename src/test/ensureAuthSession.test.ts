import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { getSession, signInAnonymously } = vi.hoisted(() => ({
  getSession: vi.fn(),
  signInAnonymously: vi.fn(),
}));

vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    auth: { getSession, signInAnonymously },
  },
}));

import { ensureAuthSession } from '@/hooks/useAnonAuth';

describe('ensureAuthSession', () => {
  beforeEach(() => {
    getSession.mockReset();
    signInAnonymously.mockReset();
  });

  it('returns the existing session without signing in when one is already present', async () => {
    const existing = { user: { id: 'user-1' } };
    getSession.mockResolvedValue({ data: { session: existing } });

    const session = await ensureAuthSession();

    expect(session).toBe(existing);
    expect(signInAnonymously).not.toHaveBeenCalled();
  });

  it('signs in once and shares the same in-flight promise across concurrent callers', async () => {
    getSession.mockResolvedValue({ data: { session: null } });
    const fresh = { user: { id: 'user-new' } };
    signInAnonymously.mockResolvedValue({ data: { session: fresh }, error: null });

    // Two callers racing at once (mirrors useAnonAuth's own background
    // attempt racing an on-demand getAuthedUserId call from a bulk batch).
    const [a, b] = await Promise.all([ensureAuthSession(), ensureAuthSession()]);

    expect(a).toBe(fresh);
    expect(b).toBe(fresh);
    expect(signInAnonymously).toHaveBeenCalledTimes(1);
  });

  describe('transient failures (fake timers for the backoff delays)', () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });
    afterEach(() => {
      vi.useRealTimers();
    });

    it('retries with backoff and succeeds on a later attempt (PgBouncer-style transient 504)', async () => {
      getSession.mockResolvedValue({ data: { session: null } });
      const fresh = { user: { id: 'user-new' } };
      signInAnonymously
        .mockResolvedValueOnce({ data: { session: null }, error: new Error('504 timeout') })
        .mockResolvedValueOnce({ data: { session: fresh }, error: null });

      const promise = ensureAuthSession();
      await vi.advanceTimersByTimeAsync(5_000); // first retry delay
      const session = await promise;

      expect(session).toBe(fresh);
      expect(signInAnonymously).toHaveBeenCalledTimes(2);
    });

    it('gives up and returns null after exhausting all retries', async () => {
      getSession.mockResolvedValue({ data: { session: null } });
      signInAnonymously.mockResolvedValue({ data: { session: null }, error: new Error('504 timeout') });

      const promise = ensureAuthSession();
      await vi.advanceTimersByTimeAsync(5_000);
      await vi.advanceTimersByTimeAsync(10_000);
      const session = await promise;

      expect(session).toBeNull();
      expect(signInAnonymously).toHaveBeenCalledTimes(3);
    });
  });
});
