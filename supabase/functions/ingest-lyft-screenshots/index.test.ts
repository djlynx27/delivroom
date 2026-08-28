// Deno-native tests for ingest-lyft-screenshots' pure logic. Edge Functions
// run on Deno, not the vitest/Node toolchain that tests src/ — so this uses
// `deno test`, the idiomatic runner for this code, rather than forcing it
// into vitest. Imports lyftSnapshot.ts directly (not index.ts, which calls
// serve() at module load and would bind a listener on import).
// Run with: deno test supabase/functions/ingest-lyft-screenshots/

import { assertEquals } from 'https://deno.land/std@0.168.0/testing/asserts.ts';
import { parseLyftSnapshot } from './lyftSnapshot.ts';

Deno.test('parseLyftSnapshot: accepts a well-formed snapshot', () => {
  const result = parseLyftSnapshot({
    demand_score: 8,
    wait_time_min: 4,
    nearby_drivers_count: 2,
  });
  assertEquals(result, { demand_score: 8, wait_time_min: 4, nearby_drivers_count: 2 });
});

Deno.test('parseLyftSnapshot: clamps demand_score into 1-10', () => {
  const tooHigh = parseLyftSnapshot({
    demand_score: 47,
    wait_time_min: 5,
    nearby_drivers_count: 0,
  });
  assertEquals(tooHigh?.demand_score, 10);

  const tooLow = parseLyftSnapshot({
    demand_score: -3,
    wait_time_min: 5,
    nearby_drivers_count: 0,
  });
  assertEquals(tooLow?.demand_score, 1);
});

Deno.test('parseLyftSnapshot: clamps a negative wait_time_min to 0', () => {
  const result = parseLyftSnapshot({
    demand_score: 5,
    wait_time_min: -10,
    nearby_drivers_count: 0,
  });
  assertEquals(result?.wait_time_min, 0);
});

Deno.test('parseLyftSnapshot: rounds and floors nearby_drivers_count', () => {
  const result = parseLyftSnapshot({
    demand_score: 5,
    wait_time_min: 5,
    nearby_drivers_count: 3.7,
  });
  assertEquals(result?.nearby_drivers_count, 4);

  const negative = parseLyftSnapshot({
    demand_score: 5,
    wait_time_min: 5,
    nearby_drivers_count: -2,
  });
  assertEquals(negative?.nearby_drivers_count, 0);
});

Deno.test('parseLyftSnapshot: returns null when a required field is missing', () => {
  assertEquals(parseLyftSnapshot({ demand_score: 5, wait_time_min: 5 }), null);
});

Deno.test('parseLyftSnapshot: returns null for non-object input', () => {
  assertEquals(parseLyftSnapshot(null), null);
  assertEquals(parseLyftSnapshot('not an object'), null);
  assertEquals(parseLyftSnapshot(42), null);
});

Deno.test('parseLyftSnapshot: falls back to a safe default for a non-numeric field', () => {
  const result = parseLyftSnapshot({
    demand_score: 'very high', // Gemini hallucinated a string instead of a number
    wait_time_min: 5,
    nearby_drivers_count: 1,
  });
  assertEquals(result?.demand_score, 5); // documented fallback default
});
