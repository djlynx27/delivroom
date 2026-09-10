// supabase/functions/score-calculator/eventBoost.test.ts
import { assertAlmostEquals, assertEquals } from 'https://deno.land/std@0.168.0/testing/asserts.ts';
import { computeEventBoost, gaussianDecay, haversineKm, type EventBoostInput } from './eventBoost.ts';

Deno.test('gaussianDecay: full boost at zero distance', () => {
  assertEquals(gaussianDecay(0, 2), 1);
});

Deno.test('gaussianDecay: ~13.5% remains at dist === boost_radius_km (sigma = radius/2)', () => {
  const decay = gaussianDecay(2, 2);
  assertAlmostEquals(decay, Math.exp(-2), 0.0001);
});

Deno.test('gaussianDecay: decays smoothly past the nominal radius instead of hard-cutting to zero', () => {
  const atRadius = gaussianDecay(2, 2);
  const beyondRadius = gaussianDecay(3, 2);
  assertEquals(beyondRadius > 0, true);
  assertEquals(beyondRadius < atRadius, true);
});

Deno.test('computeEventBoost: sums decayed contributions across multiple events, capped at 25', () => {
  const zone = { latitude: 45.5, longitude: -73.5 };
  const events = [
    { latitude: 45.5, longitude: -73.5, boost_multiplier: 2.0, boost_radius_km: 2 }, // at the zone itself
    { latitude: 45.5, longitude: -73.5, boost_multiplier: 2.0, boost_radius_km: 2 },
  ];
  const boost = computeEventBoost(zone, events);
  assertEquals(boost, 25); // two max-strength events would sum past 25 without the cap
});

Deno.test('computeEventBoost: zero for an event far outside its own boost radius', () => {
  const zone = { latitude: 45.5, longitude: -73.5 };
  const farEvent = { latitude: 46.0, longitude: -73.5, boost_multiplier: 2.0, boost_radius_km: 1 };
  const boost = computeEventBoost(zone, [farEvent]);
  assertEquals(boost < 0.01, true); // Gaussian never hits exactly 0, but it's negligible
});

Deno.test('gaussianDecay: returns 0 without crashing for a non-positive boost radius', () => {
  assertEquals(gaussianDecay(0.5, 0), 0);
  assertEquals(gaussianDecay(0.5, -1), 0);
});

Deno.test('computeEventBoost: zero boost when boost_radius_km <= 0 and the event is not co-located with the zone', () => {
  const zone = { latitude: 45.5, longitude: -73.5 };
  const zeroRadiusEvent = { latitude: 45.51, longitude: -73.5, boost_multiplier: 2.0, boost_radius_km: 0 };
  const boost = computeEventBoost(zone, [zeroRadiusEvent]);
  assertEquals(boost, 0);
});

Deno.test('computeEventBoost: falls back to a 3km boost_radius_km when the value is null', () => {
  const zone = { latitude: 45.5, longitude: -73.5 };
  const nullRadiusEvent = {
    latitude: 45.5,
    longitude: -73.52, // ~1.57km away — inside the 3km fallback radius
    boost_multiplier: 2.0,
    boost_radius_km: null,
  } as unknown as EventBoostInput;
  const explicit3kmEvent: EventBoostInput = { ...nullRadiusEvent, boost_radius_km: 3 };

  const withFallback = computeEventBoost(zone, [nullRadiusEvent]);
  const withExplicit3km = computeEventBoost(zone, [explicit3kmEvent]);

  assertEquals(withFallback, withExplicit3km);
  assertEquals(withFallback > 0, true);
});
