import { beforeEach, describe, expect, it, vi } from 'vitest';

const { getSession, refreshSession, ensureAuthSession } = vi.hoisted(() => ({
  getSession: vi.fn(),
  refreshSession: vi.fn(),
  ensureAuthSession: vi.fn(),
}));

vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    auth: { getSession, refreshSession },
  },
}));

vi.mock('@/hooks/useAnonAuth', () => ({ ensureAuthSession }));

import { getAuthedUserId } from '@/lib/screenshotDedup';

function session(userId: string, expiresInSec: number) {
  return {
    user: { id: userId },
    expires_at: Math.floor(Date.now() / 1000) + expiresInSec,
  };
}

describe('getAuthedUserId', () => {
  beforeEach(() => {
    getSession.mockReset();
    refreshSession.mockReset();
    ensureAuthSession.mockReset();
  });

  it('returns the user id from a valid local session without refreshing or signing in', async () => {
    getSession.mockResolvedValue({ data: { session: session('user-1', 3600) } });

    const userId = await getAuthedUserId();

    expect(userId).toBe('user-1');
    expect(refreshSession).not.toHaveBeenCalled();
    expect(ensureAuthSession).not.toHaveBeenCalled();
  });

  it('refreshes (not sign-in) when a session exists but is expired', async () => {
    getSession.mockResolvedValue({ data: { session: session('user-1', -60) } });
    refreshSession.mockResolvedValue({ data: { session: session('user-1', 3600) } });

    const userId = await getAuthedUserId();

    expect(refreshSession).toHaveBeenCalledTimes(1);
    expect(ensureAuthSession).not.toHaveBeenCalled();
    expect(userId).toBe('user-1');
  });

  it('goes through ensureAuthSession (not refreshSession) when there is no session at all', async () => {
    // A batch started right after app launch can race useAnonAuth's own
    // background signInAnonymously() — refreshSession() has no refresh
    // token to use yet in that case, it would just return null again.
    getSession.mockResolvedValue({ data: { session: null } });
    ensureAuthSession.mockResolvedValue(session('user-1', 3600));

    const userId = await getAuthedUserId();

    expect(refreshSession).not.toHaveBeenCalled();
    expect(ensureAuthSession).toHaveBeenCalledTimes(1);
    expect(userId).toBe('user-1');
  });

  it('returns null when ensureAuthSession also fails to produce a session', async () => {
    getSession.mockResolvedValue({ data: { session: null } });
    ensureAuthSession.mockResolvedValue(null);

    const userId = await getAuthedUserId();

    expect(userId).toBeNull();
  });
});
