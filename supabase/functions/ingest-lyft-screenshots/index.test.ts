// Deno-native tests for ingest-lyft-screenshots' pure logic. Edge Functions
// run on Deno, not the vitest/Node toolchain that tests src/ — so this uses
// `deno test`, the idiomatic runner for this code, rather than forcing it
// into vitest. Imports lyftSnapshot.ts directly (not index.ts, which calls
// serve() at module load and would bind a listener on import).
// Run with: deno test supabase/functions/ingest-lyft-screenshots/

import { assertEquals, assertNotEquals } from 'https://deno.land/std@0.168.0/testing/asserts.ts';
import {
  decodeBase64Image,
  EMERGING_HOTSPOT_DISTANCE_KM,
  EMERGING_HOTSPOT_MIN_DEMAND,
  formatGpsAddress,
  hashImages,
  parseLyftSnapshot,
  resizeForGemini,
  shouldFlagEmergingHotspot,
} from './lyftSnapshot.ts';

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

Deno.test('decodeBase64Image: decodes a data:image/... URI and extracts its mimeType', () => {
  const result = decodeBase64Image('data:image/png;base64,aGk=');
  assertEquals(result?.mimeType, 'image/png');
  assertEquals(Array.from(result!.bytes), [104, 105]); // "hi"
});

Deno.test('decodeBase64Image: decodes a raw base64 string, defaulting to image/jpeg', () => {
  const result = decodeBase64Image('aGk=');
  assertEquals(result?.mimeType, 'image/jpeg');
  assertEquals(Array.from(result!.bytes), [104, 105]);
});

Deno.test('decodeBase64Image: tolerates embedded whitespace/newlines in the base64 body', () => {
  const result = decodeBase64Image('data:image/jpeg;base64,aG k=');
  assertEquals(Array.from(result!.bytes), [104, 105]);
});

Deno.test('decodeBase64Image: returns null for invalid base64', () => {
  assertEquals(decodeBase64Image('not-valid-base64!!!'), null);
});

Deno.test('hashImages: identical byte content produces the same hash (retry dedup)', async () => {
  const img = { bytes: new Uint8Array([1, 2, 3]), mimeType: 'image/jpeg' };
  const a = await hashImages([img, img, img]);
  const b = await hashImages([
    { bytes: new Uint8Array([1, 2, 3]), mimeType: 'image/jpeg' },
    { bytes: new Uint8Array([1, 2, 3]), mimeType: 'image/jpeg' },
    { bytes: new Uint8Array([1, 2, 3]), mimeType: 'image/jpeg' },
  ]);
  assertEquals(a, b);
});

Deno.test('hashImages: different byte content produces a different hash', async () => {
  const a = await hashImages([{ bytes: new Uint8Array([1, 2, 3]), mimeType: 'image/jpeg' }]);
  const b = await hashImages([{ bytes: new Uint8Array([1, 2, 4]), mimeType: 'image/jpeg' }]);
  assertNotEquals(a, b);
});

Deno.test('shouldFlagEmergingHotspot: flags far + high demand', () => {
  assertEquals(
    shouldFlagEmergingHotspot(EMERGING_HOTSPOT_DISTANCE_KM, EMERGING_HOTSPOT_MIN_DEMAND),
    true
  );
});

Deno.test('shouldFlagEmergingHotspot: does not flag when close to a known zone', () => {
  assertEquals(shouldFlagEmergingHotspot(0.3, 10), false);
});

Deno.test('shouldFlagEmergingHotspot: does not flag low demand even when far', () => {
  assertEquals(shouldFlagEmergingHotspot(5, EMERGING_HOTSPOT_MIN_DEMAND - 1), false);
});

Deno.test('shouldFlagEmergingHotspot: does not flag when distance is unknown (explicit zone_id override)', () => {
  assertEquals(shouldFlagEmergingHotspot(null, 10), false);
});

Deno.test('resizeForGemini: falls back to the original image when decoding fails', async () => {
  const original = { bytes: new Uint8Array([104, 105]), mimeType: 'image/jpeg' }; // not a real image
  const result = await resizeForGemini(original);
  assertEquals(result, original);
});

Deno.test('formatGpsAddress: rounds to 4 decimal places', () => {
  assertEquals(formatGpsAddress(45.50171234, -73.56731234), 'GPS 45.5017,-73.5673');
});

Deno.test('formatGpsAddress: two nearby detections round to the same label (dedup key)', () => {
  const a = formatGpsAddress(45.501701, -73.567301);
  const b = formatGpsAddress(45.501699, -73.567299);
  assertEquals(a, b);
});
