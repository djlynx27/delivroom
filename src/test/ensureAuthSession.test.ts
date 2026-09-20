import { beforeEach, describe, expect, it, vi } from 'vitest';

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

  it('returns null and logs when signInAnonymously fails', async () => {
    getSession.mockResolvedValue({ data: { session: null } });
    signInAnonymously.mockResolvedValue({ data: { session: null }, error: new Error('offline') });

    const session = await ensureAuthSession();

    expect(session).toBeNull();
  });
});
