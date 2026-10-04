// supabase/functions/score-calculator/yulFlightBoost.test.ts
import { assertEquals } from 'https://deno.land/std@0.168.0/testing/asserts.ts';
import {
  computeYulFlightBoost,
  isYulSnapshotFresh,
  YUL_CACHE_TTL_MS,
  YUL_FLIGHT_BOOST_CAP,
} from './yulFlightBoost.ts';

Deno.test('computeYulFlightBoost: no signal (key missing / fetch failed) gives zero boost', () => {
  assertEquals(computeYulFlightBoost(null), 0);
});

Deno.test('computeYulFlightBoost: zero live arrivals gives zero boost', () => {
  assertEquals(computeYulFlightBoost(0), 0);
});

Deno.test('computeYulFlightBoost: scales with incoming flight count', () => {
  assertEquals(computeYulFlightBoost(5), 6); // round(5 * 1.2)
  assertEquals(computeYulFlightBoost(10), 12);
});

Deno.test('computeYulFlightBoost: caps at YUL_FLIGHT_BOOST_CAP for a large surge', () => {
  assertEquals(computeYulFlightBoost(50), YUL_FLIGHT_BOOST_CAP);
});

Deno.test('isYulSnapshotFresh: recent snapshot is fresh, expired one is not', () => {
  const now = Date.parse('2026-10-04T12:00:00Z');
  assertEquals(isYulSnapshotFresh('2026-10-04T11:00:00Z', now), true);
  assertEquals(isYulSnapshotFresh(new Date(now - YUL_CACHE_TTL_MS).toISOString(), now), false);
});

Deno.test('isYulSnapshotFresh: missing, invalid or future timestamp is never fresh', () => {
  const now = Date.parse('2026-10-04T12:00:00Z');
  assertEquals(isYulSnapshotFresh(null, now), false);
  assertEquals(isYulSnapshotFresh('not-a-date', now), false);
  assertEquals(isYulSnapshotFresh('2026-10-04T13:00:00Z', now), false); // clock skew: don't trust
});
