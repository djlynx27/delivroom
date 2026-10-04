// supabase/functions/score-calculator/yulFlightBoost.test.ts
import { assertEquals } from 'https://deno.land/std@0.168.0/testing/asserts.ts';
import { computeYulFlightBoost, YUL_FLIGHT_BOOST_CAP } from './yulFlightBoost.ts';

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
