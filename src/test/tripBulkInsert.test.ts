import { insertTripsResilient } from '@/lib/tripBulkInsert';
import { describe, expect, it, vi } from 'vitest';

interface FakeRow {
  zoneId: string;
}

describe('insertTripsResilient', () => {
  it('saves every row via the fast bulk path when it succeeds', async () => {
    const insertMany = vi.fn().mockResolvedValue({ error: null });
    const insertOne = vi.fn();
    const rows = [
      { id: 'a', row: { zoneId: 'mtl-1' } },
      { id: 'b', row: { zoneId: 'mtl-2' } },
    ];

    const result = await insertTripsResilient<FakeRow>(rows, insertMany, insertOne);

    expect(result.savedIds).toEqual(new Set(['a', 'b']));
    expect(result.failedCount).toBe(0);
    expect(insertMany).toHaveBeenCalledTimes(1);
    expect(insertOne).not.toHaveBeenCalled();
  });

  it('falls back to row-by-row and isolates only the row the DB rejects', async () => {
    const insertMany = vi.fn().mockResolvedValue({ error: new Error('FK violation') });
    const insertOne = vi.fn().mockImplementation(async (row: FakeRow) =>
      row.zoneId === 'bad-zone' ? { error: new Error('FK violation') } : { error: null },
    );
    const rows = [
      { id: 'a', row: { zoneId: 'mtl-1' } },
      { id: 'b', row: { zoneId: 'bad-zone' } },
      { id: 'c', row: { zoneId: 'mtl-3' } },
    ];

    const result = await insertTripsResilient<FakeRow>(rows, insertMany, insertOne);

    expect(result.savedIds).toEqual(new Set(['a', 'c']));
    expect(result.failedCount).toBe(1);
    expect(insertOne).toHaveBeenCalledTimes(3);
  });

  it('reports every row as failed when the fallback also rejects them all', async () => {
    const insertMany = vi.fn().mockResolvedValue({ error: new Error('down') });
    const insertOne = vi.fn().mockResolvedValue({ error: new Error('down') });
    const rows = [{ id: 'a', row: { zoneId: 'mtl-1' } }];

    const result = await insertTripsResilient<FakeRow>(rows, insertMany, insertOne);

    expect(result.savedIds.size).toBe(0);
    expect(result.failedCount).toBe(1);
  });
});
