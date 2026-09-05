// Deno-native tests for event-sync's pure event-mapping logic.
// Run with: deno test supabase/functions/event-sync/

import { assertEquals } from 'https://deno.land/std@0.168.0/testing/asserts.ts';
import { dedupeEventRows, toEventRow, type TmApiEvent } from './eventSync.ts';

function tmEvent(overrides: Partial<TmApiEvent> = {}): TmApiEvent {
  return {
    id: 'tm-1',
    name: 'Canadiens vs Bruins',
    dates: { start: { dateTime: '2026-10-01T23:00:00Z' } },
    classifications: [{ segment: { name: 'Sports' } }],
    _embedded: { venues: [{ name: 'Centre Bell' }] },
    ...overrides,
  };
}

Deno.test('toEventRow: maps a tracked venue with sports duration (3.25h)', () => {
  const row = toEventRow(tmEvent());
  assertEquals(row?.venue, 'Centre Bell');
  assertEquals(row?.city_id, 'mtl');
  assertEquals(row?.category, 'sport');
  assertEquals(row?.end_at, new Date(
    new Date('2026-10-01T23:00:00Z').getTime() + 3.25 * 3_600_000
  ).toISOString());
});

Deno.test('toEventRow: unknown venue is skipped', () => {
  const row = toEventRow(
    tmEvent({ _embedded: { venues: [{ name: 'Some Bar Nobody Tracks' }] } })
  );
  assertEquals(row, null);
});

Deno.test('toEventRow: missing start date is skipped', () => {
  const row = toEventRow(tmEvent({ dates: {} }));
  assertEquals(row, null);
});

Deno.test('toEventRow: unknown classification falls back to default duration', () => {
  const row = toEventRow(tmEvent({ classifications: undefined }));
  assertEquals(row?.category, 'event');
  assertEquals(row?.end_at, new Date(
    new Date('2026-10-01T23:00:00Z').getTime() + 2.5 * 3_600_000
  ).toISOString());
});

Deno.test('dedupeEventRows: same external_id across two market searches keeps one row', () => {
  const rows = dedupeEventRows([[tmEvent()], [tmEvent()]]);
  assertEquals(rows.length, 1);
});

Deno.test('dedupeEventRows: skipped events across lists do not appear', () => {
  const rows = dedupeEventRows([
    [tmEvent({ id: 'tm-1' })],
    [tmEvent({ id: undefined })],
  ]);
  assertEquals(rows.length, 1);
  assertEquals(rows[0].external_id, 'tm-1');
});
