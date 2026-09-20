import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createPacer } from '@/lib/requestPacing';

describe('createPacer', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('does not delay the first call', async () => {
    const pace = createPacer(1_000);
    const start = Date.now();

    await pace();

    expect(Date.now() - start).toBe(0);
  });

  it('delays a second call to respect the minimum interval', async () => {
    const pace = createPacer(1_000);
    await pace();

    let resolved = false;
    const promise = pace().then(() => {
      resolved = true;
    });

    await vi.advanceTimersByTimeAsync(999);
    expect(resolved).toBe(false);

    await vi.advanceTimersByTimeAsync(1);
    await promise;
    expect(resolved).toBe(true);
  });

  it('does not delay a call that already arrives after the interval has elapsed', async () => {
    const pace = createPacer(1_000);
    await pace();

    await vi.advanceTimersByTimeAsync(1_000);
    const start = Date.now();
    await pace();

    expect(Date.now() - start).toBe(0);
  });
});
