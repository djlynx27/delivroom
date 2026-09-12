// Deno-native tests for analyze-screenshot's auto-save gating logic.
// Run with: deno test supabase/functions/analyze-screenshot/

import { assertEquals } from 'https://deno.land/std@0.168.0/testing/asserts.ts';
import {
  autoSaveNotesTag,
  buildOfferSignalInsert,
  computeEndedAt,
  extractUserIdFromStorageUrl,
  hasAutoSaveConfidence,
  normalizeStartedAt,
  resolveDurationMinutes,
} from './autoSave.ts';
import type { AnalysisResult } from './index.ts';

Deno.test('hasAutoSaveConfidence: rejects a demand/heatmap screenshot (no zone, no revenue)', () => {
  assertEquals(hasAutoSaveConfidence({ extracted_data: {} }), false);
});

Deno.test('hasAutoSaveConfidence: rejects a matched zone with zero revenue', () => {
  const analysis: AnalysisResult = {
    matched_zone_id: 'mtl-anjou',
    extracted_data: { earnings: 0, tips: 0 },
  };
  assertEquals(hasAutoSaveConfidence(analysis), false);
});

Deno.test('hasAutoSaveConfidence: rejects revenue with no catalog-verified zone', () => {
  const analysis: AnalysisResult = {
    extracted_data: { earnings: 12.5 },
  };
  assertEquals(hasAutoSaveConfidence(analysis), false);
});

Deno.test('hasAutoSaveConfidence: rejects a pre-accept offer card (fare shown, but no confirmed-activity signal)', () => {
  // Exactly the shape of a Lyft ride-offer card: pickup/ride time+distance
  // for rideDecision.ts's accept/skip agent, plus the offered fare — no
  // active_trip_payout (not mid-ride yet) and no hours_worked/trips_count
  // (not a shift summary). Must NOT auto-save just because earnings>0.
  const analysis: AnalysisResult = {
    matched_zone_id: 'mtl-anjou',
    extracted_data: {
      earnings: 14.5,
      pickup_time_minutes: 3,
      pickup_distance_km: 1.2,
      ride_time_minutes: 12,
      ride_distance_km: 6,
    },
  };
  assertEquals(hasAutoSaveConfidence(analysis), false);
});

Deno.test('hasAutoSaveConfidence: accepts a matched zone with earnings + the live Trip Tracking overlay', () => {
  const analysis: AnalysisResult = {
    matched_zone_id: 'mtl-anjou',
    extracted_data: { earnings: 12.5, tips: 0, active_trip_payout: 12.5 },
  };
  assertEquals(hasAutoSaveConfidence(analysis), true);
});

Deno.test('hasAutoSaveConfidence: accepts tips-only on a shift summary screen (trips_count present)', () => {
  const analysis: AnalysisResult = {
    matched_zone_id: 'mtl-anjou',
    extracted_data: { earnings: 0, tips: 3, trips_count: 4 },
  };
  assertEquals(hasAutoSaveConfidence(analysis), true);
});

Deno.test('hasAutoSaveConfidence: rejects revenue with neither active-trip nor shift-summary signal', () => {
  const analysis: AnalysisResult = {
    matched_zone_id: 'mtl-anjou',
    extracted_data: { earnings: 12.5 },
  };
  assertEquals(hasAutoSaveConfidence(analysis), false);
});

Deno.test('extractUserIdFromStorageUrl: reads the userId path segment', () => {
  const url =
    'https://hibzhsjgipybfihhzpxr.supabase.co/storage/v1/object/sign/driver-screenshots/' +
    '3fa85f64-5717-4562-b3fc-2c963f66afa6/1757600000-lyft.jpg?token=abc';
  assertEquals(extractUserIdFromStorageUrl(url), '3fa85f64-5717-4562-b3fc-2c963f66afa6');
});

Deno.test('extractUserIdFromStorageUrl: null when the path shape is unexpected', () => {
  assertEquals(extractUserIdFromStorageUrl('https://example.com/not-a-storage-url'), null);
});

Deno.test('autoSaveNotesTag: strips the signed-URL token so retries share the same tag', () => {
  const base = 'https://x.supabase.co/storage/v1/object/sign/driver-screenshots/u1/f.jpg';
  assertEquals(autoSaveNotesTag(`${base}?token=aaa`), autoSaveNotesTag(`${base}?token=bbb`));
});

Deno.test('normalizeStartedAt: falls back to now on a pre-2025 (misread) year', () => {
  const now = new Date('2026-09-12T12:00:00Z');
  assertEquals(normalizeStartedAt('2020-01-01T00:00:00Z', now), now.toISOString());
});

Deno.test('resolveDurationMinutes: sums pickup + ride legs when both are present', () => {
  assertEquals(resolveDurationMinutes({ pickup_time_minutes: 3, ride_time_minutes: 8 }), 11);
});

Deno.test('computeEndedAt: null when duration is unknown', () => {
  assertEquals(computeEndedAt('2026-09-12T12:00:00Z', null), null);
});

const OFFER_CARD: AnalysisResult = {
  matched_zone_id: 'mtl-anjou',
  extracted_data: {
    earnings: 14.5,
    pickup_time_minutes: 3,
    pickup_distance_km: 1.2,
    ride_time_minutes: 12,
    ride_distance_km: 6,
  },
};

Deno.test('buildOfferSignalInsert: archives a pre-accept offer card as unknown market signal', () => {
  const row = buildOfferSignalInsert(OFFER_CARD, 'abc123', 'user-1');
  assertEquals(row?.driver_id, 'user-1');
  assertEquals(row?.platform, 'lyft');
  assertEquals(row?.offer_status, 'unknown');
  assertEquals(row?.zone_id, 'mtl-anjou');
  assertEquals(row?.fare_cad, 14.5);
  assertEquals(row?.pickup_time_min, 3);
  assertEquals(row?.drive_time_min, 12);
  assertEquals(row?.content_hash, 'abc123');
});

Deno.test('buildOfferSignalInsert: null without a content hash to dedup on', () => {
  assertEquals(buildOfferSignalInsert(OFFER_CARD, undefined, 'user-1'), null);
});

Deno.test('buildOfferSignalInsert: null without an authenticated caller', () => {
  assertEquals(buildOfferSignalInsert(OFFER_CARD, 'abc123', null), null);
});

Deno.test('buildOfferSignalInsert: null when the zone was never catalog-matched', () => {
  const analysis: AnalysisResult = { extracted_data: OFFER_CARD.extracted_data };
  assertEquals(buildOfferSignalInsert(analysis, 'abc123', 'user-1'), null);
});

Deno.test('buildOfferSignalInsert: null for a screenshot with no offer-decomposition fields (not an offer card)', () => {
  const shiftSummary: AnalysisResult = {
    matched_zone_id: 'mtl-anjou',
    extracted_data: { earnings: 40, trips_count: 6 },
  };
  assertEquals(buildOfferSignalInsert(shiftSummary, 'abc123', 'user-1'), null);
});
