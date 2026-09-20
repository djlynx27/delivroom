import { beforeEach, describe, expect, it, vi } from 'vitest';

const { getSession, refreshSession } = vi.hoisted(() => ({
  getSession: vi.fn(),
  refreshSession: vi.fn(),
}));

vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    auth: { getSession, refreshSession },
  },
}));

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
  });

  it('returns the user id from a valid local session without refreshing', async () => {
    getSession.mockResolvedValue({ data: { session: session('user-1', 3600) } });

    const userId = await getAuthedUserId();

    expect(userId).toBe('user-1');
    expect(refreshSession).not.toHaveBeenCalled();
  });

  it('refreshes once when the local session is expired', async () => {
    getSession.mockResolvedValue({ data: { session: session('user-1', -60) } });
    refreshSession.mockResolvedValue({ data: { session: session('user-1', 3600) } });

    const userId = await getAuthedUserId();

    expect(refreshSession).toHaveBeenCalledTimes(1);
    expect(userId).toBe('user-1');
  });

  it('refreshes once when there is no local session at all', async () => {
    getSession.mockResolvedValue({ data: { session: null } });
    refreshSession.mockResolvedValue({ data: { session: session('user-1', 3600) } });

    const userId = await getAuthedUserId();

    expect(refreshSession).toHaveBeenCalledTimes(1);
    expect(userId).toBe('user-1');
  });

  it('returns null when refreshing also fails to produce a session', async () => {
    getSession.mockResolvedValue({ data: { session: null } });
    refreshSession.mockResolvedValue({ data: { session: null } });

    const userId = await getAuthedUserId();

    expect(userId).toBeNull();
  });
});
