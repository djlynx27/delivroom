// supabase/functions/score-calculator/scoreFreshness.test.ts
import { assertEquals } from 'https://deno.land/std@0.168.0/testing/asserts.ts';
import { freshnessRemainingSeconds, SCORE_FRESHNESS_WINDOW_MS } from './scoreFreshness.ts';

const NOW = Date.parse('2026-10-05T12:00:00.000Z');
const ago = (ms: number) => new Date(NOW - ms).toISOString();

Deno.test('fresh row (2 min old) -> 180 s remaining of the 5 min window', () => {
  assertEquals(freshnessRemainingSeconds(ago(2 * 60_000), NOW), 180);
});

Deno.test('exactly at the window boundary -> allowed (0)', () => {
  assertEquals(freshnessRemainingSeconds(ago(SCORE_FRESHNESS_WINDOW_MS), NOW), 0);
});

Deno.test('stale row (7 min old) -> allowed (0)', () => {
  assertEquals(freshnessRemainingSeconds(ago(7 * 60_000), NOW), 0);
});

Deno.test('no rows / null / garbage timestamp -> fail open (0)', () => {
  assertEquals(freshnessRemainingSeconds(null, NOW), 0);
  assertEquals(freshnessRemainingSeconds(undefined, NOW), 0);
  assertEquals(freshnessRemainingSeconds('not-a-date', NOW), 0);
});

Deno.test('timestamp in the future (clock skew) never locks out longer than one window', () => {
  assertEquals(freshnessRemainingSeconds(new Date(NOW + 3_600_000).toISOString(), NOW), 300);
});

Deno.test('rounds partial seconds up', () => {
  assertEquals(freshnessRemainingSeconds(ago(WINDOW_MINUS_500MS()), NOW), 1);
});
function WINDOW_MINUS_500MS() { return SCORE_FRESHNESS_WINDOW_MS - 500; }
