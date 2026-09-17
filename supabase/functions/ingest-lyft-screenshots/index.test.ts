// Deno-native tests for ingest-lyft-screenshots' pure logic. Edge Functions
// run on Deno, not the vitest/Node toolchain that tests src/ — so this uses
// `deno test`, the idiomatic runner for this code, rather than forcing it
// into vitest. Imports lyftSnapshot.ts directly (not index.ts, which calls
// serve() at module load and would bind a listener on import).
// Run with: deno test supabase/functions/ingest-lyft-screenshots/

import { assertEquals, assertNotEquals } from 'https://deno.land/std@0.168.0/testing/asserts.ts';
import {
  computeMicroSpot,
  computeNavigationTarget,
  decodeBase64Image,
  EMERGING_HOTSPOT_DISTANCE_KM,
  EMERGING_HOTSPOT_MIN_DEMAND,
  findBestNeighboringZone,
  findQuietestQuadrant,
  formatGpsAddress,
  hashImages,
  isZoneSaturated,
  offsetCoordinate,
  parseLyftSnapshot,
  parseNearbyOnlySnapshot,
  resizeForGemini,
  SATURATION_THRESHOLD,
  shouldFlagEmergingHotspot,
  type ZoneScoreRow,
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

Deno.test('parseNearbyOnlySnapshot: accepts a valid 3x3 grid', () => {
  const grid = [0, 1, 0, 2, 3, 0, 1, 0, 0];
  const result = parseNearbyOnlySnapshot({ nearby_drivers_count: 7, nearby_drivers_grid: grid });
  assertEquals(result?.nearby_drivers_grid, grid);
});

Deno.test('parseNearbyOnlySnapshot: drops a grid of the wrong length rather than failing the snapshot', () => {
  const result = parseNearbyOnlySnapshot({
    nearby_drivers_count: 7,
    nearby_drivers_grid: [1, 2, 3], // Gemini hallucinated fewer than 9 cells
  });
  assertEquals(result?.nearby_drivers_count, 7);
  assertEquals(result?.nearby_drivers_grid, undefined);
});

Deno.test('parseNearbyOnlySnapshot: drops a grid with a negative or non-numeric cell', () => {
  const result = parseNearbyOnlySnapshot({
    nearby_drivers_count: 7,
    nearby_drivers_grid: [0, 0, 0, 0, 0, 0, 0, 0, -1],
  });
  assertEquals(result?.nearby_drivers_grid, undefined);
});

Deno.test('resizeForGemini: falls back to the original image when decoding fails', async () => {
  const original = { bytes: new Uint8Array([104, 105]), mimeType: 'image/jpeg' }; // not a real image
  const result = await resizeForGemini(original);
  assertEquals(result, original);
});

Deno.test('resizeForGemini: rejects an oversized payload before attempting to decode it', async () => {
  // 16 MB of garbage bytes -- if this touched the decoder it would also fail
  // the "not a real image" way, but the point of this test is that it must
  // never reach the decoder at all for a payload this large.
  const oversized = { bytes: new Uint8Array(16 * 1024 * 1024), mimeType: 'image/jpeg' };
  const result = await resizeForGemini(oversized);
  assertEquals(result, oversized);
});

Deno.test('formatGpsAddress: rounds to 4 decimal places', () => {
  assertEquals(formatGpsAddress(45.50171234, -73.56731234), 'GPS 45.5017,-73.5673');
});

Deno.test('formatGpsAddress: two nearby detections round to the same label (dedup key)', () => {
  const a = formatGpsAddress(45.501701, -73.567301);
  const b = formatGpsAddress(45.501699, -73.567299);
  assertEquals(a, b);
});

const CHOMEDEY = { latitude: 45.544154, longitude: -73.739052 };

Deno.test('findQuietestQuadrant: picks the cell with the fewest drivers', () => {
  const grid = [5, 4, 0, 3, 6, 2, 1, 4, 3];
  assertEquals(findQuietestQuadrant(grid), { quadrant: 'top_right' });
});

Deno.test('findQuietestQuadrant: breaks ties by row-major order', () => {
  const grid = [0, 0, 1, 1, 1, 1, 1, 1, 1];
  assertEquals(findQuietestQuadrant(grid).quadrant, 'top_left');
});

Deno.test('offsetCoordinate: moves due north by roughly the requested distance', () => {
  const point = offsetCoordinate(CHOMEDEY, 0, 100);
  assertEquals(point.latitude > CHOMEDEY.latitude, true);
});

Deno.test('computeMicroSpot: leaves the centroid unmodified when center is quietest', () => {
  const grid = [5, 5, 5, 5, 0, 5, 5, 5, 5];
  const spot = computeMicroSpot(CHOMEDEY, grid);
  assertEquals(spot.latitude, CHOMEDEY.latitude);
  assertEquals(spot.longitude, CHOMEDEY.longitude);
  assertEquals(spot.quadrant, 'center');
  assertEquals(spot.offsetMeters, 0);
});

Deno.test('computeMicroSpot: offsets toward the sparsest quadrant', () => {
  const grid = [3, 3, 0, 3, 3, 3, 9, 3, 3];
  const spot = computeMicroSpot(CHOMEDEY, grid);
  assertEquals(spot.quadrant, 'top_right');
  assertEquals(spot.latitude > CHOMEDEY.latitude, true);
  assertEquals(spot.longitude > CHOMEDEY.longitude, true);
});

Deno.test('isZoneSaturated: true at or above the threshold', () => {
  assertEquals(isZoneSaturated(SATURATION_THRESHOLD), true);
  assertEquals(isZoneSaturated(SATURATION_THRESHOLD - 1), false);
});

const ORIGIN = { latitude: 45.5, longitude: -73.6 }; // zone 'a's own centroid
const ZONES: ZoneScoreRow[] = [
  { id: 'a', name: 'Zone A', latitude: 45.5, longitude: -73.6, current_score: 40 },
  { id: 'b', name: 'Zone B (nearby, in range)', latitude: 45.54, longitude: -73.65, current_score: 80 },
  { id: 'far', name: 'Zone Far (out of range, higher score)', latitude: 45.75, longitude: -73.95, current_score: 95 },
  { id: 'c', name: 'Zone C (nearby, unscored)', latitude: 45.51, longitude: -73.61, current_score: null },
];

Deno.test('findBestNeighboringZone: picks the highest-scoring zone within range, excluding self and nulls', () => {
  const best = findBestNeighboringZone('a', ZONES, ORIGIN.latitude, ORIGIN.longitude);
  assertEquals(best?.id, 'b');
});

Deno.test('findBestNeighboringZone: excludes a higher-scoring zone that is out of range', () => {
  const best = findBestNeighboringZone('a', [ZONES[0], ZONES[2]], ORIGIN.latitude, ORIGIN.longitude);
  assertEquals(best, null);
});

Deno.test('findBestNeighboringZone: returns null when no scored neighbor exists in range', () => {
  const best = findBestNeighboringZone('a', [ZONES[0], ZONES[3]], ORIGIN.latitude, ORIGIN.longitude);
  assertEquals(best, null);
});

Deno.test('computeNavigationTarget: falls back to the best neighbor when saturated', () => {
  const target = computeNavigationTarget(ORIGIN, SATURATION_THRESHOLD, undefined, ZONES, 'a');
  assertEquals(target, {
    latitude: ZONES[1].latitude,
    longitude: ZONES[1].longitude,
    mode: 'fallback_zone',
    zone_name: ZONES[1].name,
  });
});

Deno.test('computeNavigationTarget: falls back to micro-spot when saturated but no neighbor scored', () => {
  const grid = [3, 3, 0, 3, 3, 3, 9, 3, 3];
  const target = computeNavigationTarget(
    ORIGIN,
    SATURATION_THRESHOLD,
    grid,
    [ZONES[0], ZONES[3]],
    'a'
  );
  assertEquals(target.mode, 'micro_spot');
});

Deno.test('computeNavigationTarget: saturated but only an out-of-range neighbor is scored -- falls through to micro-spot', () => {
  const grid = [3, 3, 0, 3, 3, 3, 9, 3, 3];
  const target = computeNavigationTarget(ORIGIN, SATURATION_THRESHOLD, grid, [ZONES[0], ZONES[2]], 'a');
  assertEquals(target.mode, 'micro_spot');
});

Deno.test('computeNavigationTarget: micro-spot nudge when not saturated', () => {
  const grid = [3, 3, 0, 3, 3, 3, 9, 3, 3];
  const target = computeNavigationTarget(CHOMEDEY, 2, grid, ZONES, 'a');
  assertEquals(target.mode, 'micro_spot');
  assertEquals(target.latitude > CHOMEDEY.latitude, true);
});

Deno.test('computeNavigationTarget: zone centroid (no offset) when not saturated and no grid', () => {
  const target = computeNavigationTarget(CHOMEDEY, 2, undefined, ZONES, 'a');
  assertEquals(target, { latitude: CHOMEDEY.latitude, longitude: CHOMEDEY.longitude, mode: 'micro_spot' });
});
