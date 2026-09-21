import { requestPersistentStorage } from '@/lib/storagePersistence';
import { afterEach, describe, expect, it, vi } from 'vitest';

const originalStorage = navigator.storage;

afterEach(() => {
  Object.defineProperty(navigator, 'storage', {
    value: originalStorage,
    configurable: true,
  });
  vi.restoreAllMocks();
});

function stubNavigatorStorage(value: unknown) {
  Object.defineProperty(navigator, 'storage', {
    value,
    configurable: true,
  });
}

describe('requestPersistentStorage', () => {
  it('returns "unsupported" when navigator.storage is absent', async () => {
    stubNavigatorStorage(undefined);
    const result = await requestPersistentStorage();
    expect(result).toBe('unsupported');
  });

  it('returns "unsupported" when persist() is absent', async () => {
    stubNavigatorStorage({});
    const result = await requestPersistentStorage();
    expect(result).toBe('unsupported');
  });

  it('returns "granted" when persist() resolves true', async () => {
    stubNavigatorStorage({ persist: vi.fn().mockResolvedValue(true) });
    const result = await requestPersistentStorage();
    expect(result).toBe('granted');
  });

  it('returns "denied" when persist() resolves false', async () => {
    stubNavigatorStorage({ persist: vi.fn().mockResolvedValue(false) });
    const result = await requestPersistentStorage();
    expect(result).toBe('denied');
  });

  it('returns "denied" (not throw) when persist() rejects', async () => {
    stubNavigatorStorage({ persist: vi.fn().mockRejectedValue(new Error('boom')) });
    const result = await requestPersistentStorage();
    expect(result).toBe('denied');
  });
});
