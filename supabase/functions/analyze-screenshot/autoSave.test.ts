// Deno-native tests for analyze-screenshot's auto-save gating logic.
// Run with: deno test supabase/functions/analyze-screenshot/

import { assertEquals } from 'https://deno.land/std@0.168.0/testing/asserts.ts';
import {
  autoSaveNotesTag,
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

Deno.test('hasAutoSaveConfidence: accepts a matched zone with earnings', () => {
  const analysis: AnalysisResult = {
    matched_zone_id: 'mtl-anjou',
    extracted_data: { earnings: 12.5, tips: 0 },
  };
  assertEquals(hasAutoSaveConfidence(analysis), true);
});

Deno.test('hasAutoSaveConfidence: accepts a matched zone with tips only', () => {
  const analysis: AnalysisResult = {
    matched_zone_id: 'mtl-anjou',
    extracted_data: { earnings: 0, tips: 3 },
  };
  assertEquals(hasAutoSaveConfidence(analysis), true);
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
