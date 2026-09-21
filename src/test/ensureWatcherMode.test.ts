import { beforeEach, describe, expect, it, vi } from 'vitest';

const { addWatcher, removeWatcher } = vi.hoisted(() => ({
  addWatcher: vi.fn(),
  removeWatcher: vi.fn(),
}));

vi.mock('@capacitor/core', () => ({
  Capacitor: { isNativePlatform: () => true },
  registerPlugin: () => ({ addWatcher, removeWatcher }),
}));

const prefsStore = new Map<string, string>();
vi.mock('@capacitor/preferences', () => ({
  Preferences: {
    get: async ({ key }: { key: string }) => ({ value: prefsStore.get(key) ?? null }),
    set: async ({ key, value }: { key: string; value: string }) => {
      prefsStore.set(key, value);
    },
    remove: async ({ key }: { key: string }) => {
      prefsStore.delete(key);
    },
  },
}));

vi.mock('@capacitor/local-notifications', () => ({
  LocalNotifications: {
    checkPermissions: async () => ({ display: 'granted' }),
    requestPermissions: async () => ({ display: 'granted' }),
    schedule: async () => {},
    registerActionTypes: async () => {},
    addListener: async () => {},
  },
}));

vi.mock('@/integrations/supabase/client', () => ({
  supabase: { from: () => ({ select: async () => ({ data: [], error: null }) }) },
}));

vi.mock('@/lib/delivroomBroadcast', () => ({
  default: { sendBroadcast: async () => {} },
}));

import { ensureWatcherMode } from '@/lib/shiftGeoWatcher';

describe('ensureWatcherMode', () => {
  beforeEach(() => {
    prefsStore.clear();
    addWatcher.mockReset();
    removeWatcher.mockReset();
    addWatcher.mockResolvedValue('watcher-1');
  });

  it('starts an idle watcher on first call', async () => {
    await ensureWatcherMode('idle');
    expect(addWatcher).toHaveBeenCalledTimes(1);
    expect(addWatcher.mock.calls[0]?.[0]).toMatchObject({ distanceFilter: 250 });
    expect(removeWatcher).not.toHaveBeenCalled();
  });

  it('is idempotent when called again with the same mode already running', async () => {
    await ensureWatcherMode('idle');
    await ensureWatcherMode('idle');
    expect(addWatcher).toHaveBeenCalledTimes(1);
    expect(removeWatcher).not.toHaveBeenCalled();
  });

  it('switches from idle to shift via removeWatcher + addWatcher', async () => {
    await ensureWatcherMode('idle');
    await ensureWatcherMode('shift');
    expect(removeWatcher).toHaveBeenCalledWith({ id: 'watcher-1' });
    expect(addWatcher).toHaveBeenCalledTimes(2);
    expect(addWatcher.mock.calls[1]?.[0]).toMatchObject({ distanceFilter: 30 });
  });

  it('reconciles a stale persisted watcher id even for a same-mode cold boot', async () => {
    // Simulates a crash: a watcher id was persisted for 'idle' but no mode
    // was ever recorded (older/partial state) — must still reconcile.
    prefsStore.set('delivroom_shift_geo_watcher_id', 'orphaned-watcher');
    await ensureWatcherMode('idle');
    expect(removeWatcher).toHaveBeenCalledWith({ id: 'orphaned-watcher' });
    expect(addWatcher).toHaveBeenCalledTimes(1);
  });
});
