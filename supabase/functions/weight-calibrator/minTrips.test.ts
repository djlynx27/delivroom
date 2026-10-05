// supabase/functions/weight-calibrator/minTrips.test.ts
import { assertEquals } from 'https://deno.land/std@0.168.0/testing/asserts.ts';
import { enforceMinTripsFloor, MIN_TRIPS_FLOOR } from './minTrips.ts';

Deno.test('floor is 10', () => {
  assertEquals(MIN_TRIPS_FLOOR, 10);
});

Deno.test('a caller asking for fewer than 10 gets 10', () => {
  assertEquals(enforceMinTripsFloor(1), 10);
  assertEquals(enforceMinTripsFloor(9), 10);
});

Deno.test('10 stays 10 and callers may require MORE trips', () => {
  assertEquals(enforceMinTripsFloor(10), 10);
  assertEquals(enforceMinTripsFloor(25), 25);
});
