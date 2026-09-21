import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const isNativePlatform = vi.fn(() => false);
vi.mock('@capacitor/core', () => ({
  Capacitor: { isNativePlatform: () => isNativePlatform() },
}));

const preferencesGet = vi.fn();
const preferencesSet = vi.fn();
const preferencesRemove = vi.fn();
vi.mock('@capacitor/preferences', () => ({
  Preferences: {
    get: (...args: unknown[]) => preferencesGet(...args),
    set: (...args: unknown[]) => preferencesSet(...args),
    remove: (...args: unknown[]) => preferencesRemove(...args),
  },
}));

const { createNativeStorage } = await import('@/lib/nativeStorage');

beforeEach(() => {
  localStorage.clear();
  preferencesGet.mockReset();
  preferencesSet.mockReset();
  preferencesRemove.mockReset();
});

afterEach(() => {
  isNativePlatform.mockReturnValue(false);
});

describe('createNativeStorage — web (non-native)', () => {
  it('reads/writes/removes through localStorage', async () => {
    isNativePlatform.mockReturnValue(false);
    const storage = createNativeStorage();

    await storage.setItem('k', 'v');
    expect(localStorage.getItem('k')).toBe('v');
    expect(await storage.getItem('k')).toBe('v');

    await storage.removeItem('k');
    expect(localStorage.getItem('k')).toBeNull();
  });

  it('never touches Preferences', async () => {
    isNativePlatform.mockReturnValue(false);
    const storage = createNativeStorage();
    await storage.setItem('k', 'v');
    await storage.getItem('k');
    await storage.removeItem('k');

    expect(preferencesGet).not.toHaveBeenCalled();
    expect(preferencesSet).not.toHaveBeenCalled();
    expect(preferencesRemove).not.toHaveBeenCalled();
  });
});

describe('createNativeStorage — native (Capacitor)', () => {
  it('reads from Preferences when present', async () => {
    isNativePlatform.mockReturnValue(true);
    preferencesGet.mockResolvedValue({ value: 'from-prefs' });
    const storage = createNativeStorage();

    expect(await storage.getItem('anon-session')).toBe('from-prefs');
    expect(preferencesGet).toHaveBeenCalledWith({ key: 'anon-session' });
  });

  it('writes go to Preferences, not localStorage', async () => {
    isNativePlatform.mockReturnValue(true);
    preferencesSet.mockResolvedValue(undefined);
    const storage = createNativeStorage();

    await storage.setItem('anon-session', 'new-value');
    expect(preferencesSet).toHaveBeenCalledWith({
      key: 'anon-session',
      value: 'new-value',
    });
    expect(localStorage.getItem('anon-session')).toBeNull();
  });

  it('removeItem delegates to Preferences.remove', async () => {
    isNativePlatform.mockReturnValue(true);
    preferencesRemove.mockResolvedValue(undefined);
    const storage = createNativeStorage();

    await storage.removeItem('anon-session');
    expect(preferencesRemove).toHaveBeenCalledWith({ key: 'anon-session' });
  });

  it('migrates an existing localStorage value into Preferences on first read', async () => {
    isNativePlatform.mockReturnValue(true);
    localStorage.setItem('anon-session', 'legacy-value');
    preferencesGet.mockResolvedValue({ value: null });
    preferencesSet.mockResolvedValue(undefined);
    const storage = createNativeStorage();

    const result = await storage.getItem('anon-session');

    expect(result).toBe('legacy-value');
    expect(preferencesSet).toHaveBeenCalledWith({
      key: 'anon-session',
      value: 'legacy-value',
    });
  });

  it('returns null when absent from both Preferences and localStorage', async () => {
    isNativePlatform.mockReturnValue(true);
    preferencesGet.mockResolvedValue({ value: null });
    const storage = createNativeStorage();

    expect(await storage.getItem('anon-session')).toBeNull();
    expect(preferencesSet).not.toHaveBeenCalled();
  });
});
