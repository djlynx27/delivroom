// One bad row (e.g. a hallucinated/stale zone_id from the AI screenshot
// analysis, tripping the trips.zone_id FK) must not sink a whole bulk-import
// batch — a single `.insert(rows[])` is one Postgres statement, so one
// invalid row 400s every other good row along with it. Try the fast bulk
// path first (the common case: every row is clean); only fall back to
// inserting one row at a time — to isolate exactly which one(s) the DB
// rejects — when the bulk insert actually fails.
//
// Parametrized over the insert calls (rather than importing the Supabase
// client directly) so this is unit-testable with plain fakes.

export interface TripInsertRow<TRow> {
  id: string;
  row: TRow;
}

export interface TripInsertResult {
  savedIds: Set<string>;
  failedCount: number;
}

export async function insertTripsResilient<TRow>(
  rows: TripInsertRow<TRow>[],
  insertMany: (rows: TRow[]) => Promise<{ error: unknown }>,
  insertOne: (row: TRow) => Promise<{ error: unknown }>,
): Promise<TripInsertResult> {
  const { error: bulkError } = await insertMany(rows.map((r) => r.row));
  if (!bulkError) {
    return { savedIds: new Set(rows.map((r) => r.id)), failedCount: 0 };
  }

  console.error('[insertTripsResilient] bulk insert failed, retrying row-by-row:', bulkError);
  const savedIds = new Set<string>();
  let failedCount = 0;
  for (const r of rows) {
    const { error } = await insertOne(r.row);
    if (error) {
      console.error(`[insertTripsResilient] row ${r.id} rejected:`, error);
      failedCount += 1;
    } else {
      savedIds.add(r.id);
    }
  }
  return { savedIds, failedCount };
}
