// supabase/functions/analyze-screenshot/preAnalyzed.test.ts
import { assertEquals } from 'https://deno.land/std@0.168.0/testing/asserts.ts';
import { sanitizePreAnalysis, tokensMatch } from './preAnalyzed.ts';

const NOW = new Date('2026-10-05T12:00:00Z');

const goodOffer = {
  zones_detected: [{ area: 'Laval', demand: 'high', surge_multiplier: 2, color_intensity: 'dark' }],
  overall_demand: 'medium',
  time_context: 'afternoon',
  notes: 'Offre de course Lyft de 13,07 $ à Laval, taux estimé 24,50 $/h.',
  recommended_target: 'shift',
  matched_zone_id: 'mtl-evil',
  is_fallback: true,
  extracted_data: {
    earnings: 13.07,
    tips: null,
    distance_km: 15,
    date: '2026-10-02',
    pickup_address: 'Boulevard Notre-Dame & Rue Charles-Best, Laval',
    dropoff_address: 'Chemin Côte-Ste-Catherine & Chemin Hudson, Côte-des-Neiges',
    pickup_zone_id: 'lvl-injected',
    dropoff_zone_id: 'mtl-injected',
    pickup_time_minutes: 4,
    pickup_distance_km: 1,
    ride_time_minutes: 28,
    ride_distance_km: 14,
    active_trip_payout: 999,
  },
};

Deno.test('tokensMatch: equal tokens match', () => {
  assertEquals(tokensMatch('s3cret-token', 's3cret-token'), true);
});

Deno.test('tokensMatch: different token, different length, empty, null all fail', () => {
  assertEquals(tokensMatch('s3cret-tokeN', 's3cret-token'), false);
  assertEquals(tokensMatch('s3cret', 's3cret-token'), false);
  assertEquals(tokensMatch('', 's3cret-token'), false);
  assertEquals(tokensMatch(null, 's3cret-token'), false);
});

Deno.test('tokensMatch: fails closed when no token is configured on the server', () => {
  assertEquals(tokensMatch('anything', null), false);
  assertEquals(tokensMatch('anything', ''), false);
  assertEquals(tokensMatch('', ''), false);
});

Deno.test('sanitize: a good offer card keeps its real fields', () => {
  const out = sanitizePreAnalysis(goodOffer, NOW)!;
  assertEquals(out.extracted_data?.earnings, 13.07);
  assertEquals(out.extracted_data?.pickup_time_minutes, 4);
  assertEquals(out.extracted_data?.ride_distance_km, 14);
  assertEquals(out.extracted_data?.date, '2026-10-02');
  assertEquals(out.extracted_data?.pickup_address, 'Boulevard Notre-Dame & Rue Charles-Best, Laval');
  assertEquals(out.recommended_target, 'shift');
  assertEquals(out.time_context, 'afternoon');
});

Deno.test('sanitize: caller-supplied zone ids, live-overlay fields and fallback flags are dropped', () => {
  const out = sanitizePreAnalysis(goodOffer, NOW)!;
  assertEquals(out.extracted_data?.pickup_zone_id, null);
  assertEquals(out.extracted_data?.dropoff_zone_id, null);
  assertEquals(out.extracted_data?.active_trip_payout, null);
  assertEquals(out.matched_zone_id, undefined);
  assertEquals(out.zones_detected, []);
  assertEquals(out.is_fallback, undefined);
});

Deno.test('sanitize: absurd numbers become null (poisoning guard)', () => {
  const out = sanitizePreAnalysis(
    { extracted_data: { earnings: 1e9, tips: -5, distance_km: Infinity, pickup_time_minutes: 99999, ride_distance_km: '14' } },
    NOW,
  )!;
  assertEquals(out.extracted_data?.earnings, null);
  assertEquals(out.extracted_data?.tips, null);
  assertEquals(out.extracted_data?.distance_km, null);
  assertEquals(out.extracted_data?.pickup_time_minutes, null);
  assertEquals(out.extracted_data?.ride_distance_km, null);
});

Deno.test('sanitize: implausible or malformed dates become null', () => {
  const date = (d: unknown) => sanitizePreAnalysis({ extracted_data: { date: d } }, NOW)!.extracted_data?.date;
  assertEquals(date('2026-10-02'), '2026-10-02');
  assertEquals(date('2019-05-01'), null);
  assertEquals(date('2031-01-01'), null);
  assertEquals(date('2026-02-31'), null);
  assertEquals(date('02/10/2026'), null);
  assertEquals(date(20261002), null);
});

Deno.test('sanitize: unknown enums fall back to safe defaults, long strings are truncated', () => {
  const out = sanitizePreAnalysis(
    {
      overall_demand: 'EXTREME',
      time_context: 'dusk',
      recommended_target: 'hack',
      notes: 'x'.repeat(500),
      extracted_data: { pickup_address: 'y'.repeat(900) },
    },
    NOW,
  )!;
  assertEquals(out.overall_demand, 'medium');
  assertEquals(out.time_context, null);
  assertEquals(out.recommended_target, 'unknown');
  assertEquals(out.notes?.length, 160);
  assertEquals(out.extracted_data?.pickup_address?.length, 200);
});

Deno.test('sanitize: waypoints need exactly one pickup first and one dropoff last', () => {
  const wp = (arr: unknown) => sanitizePreAnalysis({ extracted_data: { trip_waypoints: arr } }, NOW)!.extracted_data?.trip_waypoints;
  const ok = [
    { type: 'pickup', address: 'A' },
    { type: 'stop', address: 'B' },
    { type: 'dropoff', address: 'C' },
  ];
  assertEquals(wp(ok)?.length, 3);
  assertEquals(wp([ok[1], ok[0], ok[2]]), null);
  assertEquals(wp([ok[0], ok[2]]), null);
  assertEquals(wp('nope'), null);
});

Deno.test('sanitize: non-analysis payloads are rejected', () => {
  assertEquals(sanitizePreAnalysis(null, NOW), null);
  assertEquals(sanitizePreAnalysis('{"extracted_data":{}}', NOW), null);
  assertEquals(sanitizePreAnalysis([], NOW), null);
  assertEquals(sanitizePreAnalysis({ notes: 'no extracted_data' }, NOW), null);
});
