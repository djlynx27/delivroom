import {
  isSavableAsTrip,
  LEARNING_REFRESH_QUERY_KEYS,
  runAutoPipeline,
  type PipelineItem,
} from '@/lib/bulkImportPipeline';
import { describe, expect, it, vi } from 'vitest';

function item(overrides: Partial<PipelineItem> = {}): PipelineItem {
  return {
    status: 'done',
    tripSaved: false,
    analysis: { extracted_data: { earnings: 25 } },
    ...overrides,
  };
}

describe('isSavableAsTrip', () => {
  it('accepts a freshly analyzed screenshot with a fare', () => {
    expect(isSavableAsTrip(item())).toBe(true);
  });

  it('accepts a duplicate carrying analysis from a prior session', () => {
    expect(isSavableAsTrip(item({ status: 'duplicate' }))).toBe(true);
  });

  it('rejects an item still mid-processing', () => {
    expect(isSavableAsTrip(item({ status: 'analyzing' }))).toBe(false);
  });

  it('rejects an item already saved as a trip', () => {
    expect(isSavableAsTrip(item({ tripSaved: true }))).toBe(false);
  });

  it('rejects a fallback analysis (Gemini unavailable)', () => {
    expect(
      isSavableAsTrip(item({ analysis: { is_fallback: true, extracted_data: { earnings: 25 } } })),
    ).toBe(false);
  });

  it('rejects a screenshot with no earnings extracted', () => {
    expect(isSavableAsTrip(item({ analysis: { extracted_data: { earnings: null } } }))).toBe(false);
  });

  it('rejects an item with no analysis at all', () => {
    expect(isSavableAsTrip(item({ analysis: null }))).toBe(false);
  });
});

// [Import terminé -> Auto-Save -> Auto-Sync -> Auto-Train] end to end, with
// no click in between — the exact flow requested. Dependencies are injected
// spies so this exercises the real orchestration in bulkImportPipeline.ts
// without touching Supabase/React Query.
describe('runAutoPipeline', () => {
  it('saves, then refreshes every learning-loop query, then retrains — in that order', async () => {
    const calls: string[] = [];
    const saveTrips = vi.fn(async () => {
      calls.push('save');
      return 2;
    });
    const invalidate = vi.fn((key: string) => calls.push(`invalidate:${key}`));
    const retrain = vi.fn(async (count: number) => {
      calls.push(`retrain:${count}`);
    });

    const result = await runAutoPipeline([item(), item()], { saveTrips, invalidate, retrain });

    expect(result.savedCount).toBe(2);
    expect(saveTrips).toHaveBeenCalledTimes(1);
    expect(retrain).toHaveBeenCalledWith(2);
    // save happens before any invalidate, every learning key gets
    // invalidated, retrain happens last
    expect(calls[0]).toBe('save');
    expect(calls.slice(1, -1)).toEqual(
      LEARNING_REFRESH_QUERY_KEYS.map((k) => `invalidate:${k}`),
    );
    expect(calls.at(-1)).toBe('retrain:2');
  });

  it('skips saveTrips entirely when nothing in the batch is savable, but still refreshes and retrains(0)', async () => {
    const saveTrips = vi.fn(async () => 5);
    const invalidate = vi.fn();
    const retrain = vi.fn(async () => {});

    const result = await runAutoPipeline(
      [item({ status: 'failed' }), item({ status: 'pending' })],
      { saveTrips, invalidate, retrain },
    );

    expect(result.savedCount).toBe(0);
    expect(saveTrips).not.toHaveBeenCalled();
    expect(invalidate).toHaveBeenCalledTimes(LEARNING_REFRESH_QUERY_KEYS.length);
    expect(retrain).toHaveBeenCalledWith(0);
  });

  it('retrains on how many trips were actually saved, not how many items were candidates', async () => {
    // 3 candidates, but persistTrips only actually inserted 1 (2 skipped —
    // already saved / no zone). Retrain must reflect the real DB change.
    const saveTrips = vi.fn(async () => 1);
    const retrain = vi.fn(async () => {});

    const result = await runAutoPipeline([item(), item(), item()], {
      saveTrips,
      invalidate: vi.fn(),
      retrain,
    });

    expect(result.savedCount).toBe(1);
    expect(retrain).toHaveBeenCalledWith(1);
  });

  it('still runs the whole flow when saveTrips finds nothing to insert (all duplicates already saved)', async () => {
    const saveTrips = vi.fn(async () => 0);
    const invalidate = vi.fn();
    const retrain = vi.fn(async () => {});

    await runAutoPipeline([item()], { saveTrips, invalidate, retrain });

    expect(saveTrips).toHaveBeenCalledTimes(1);
    expect(invalidate).toHaveBeenCalledTimes(LEARNING_REFRESH_QUERY_KEYS.length);
    expect(retrain).toHaveBeenCalledWith(0);
  });

  it('propagates a saveTrips failure without invalidating or retraining on stale data', async () => {
    const saveTrips = vi.fn(async () => {
      throw new Error('network down');
    });
    const invalidate = vi.fn();
    const retrain = vi.fn(async () => {});

    await expect(
      runAutoPipeline([item()], { saveTrips, invalidate, retrain }),
    ).rejects.toThrow('network down');
    expect(invalidate).not.toHaveBeenCalled();
    expect(retrain).not.toHaveBeenCalled();
  });
});
