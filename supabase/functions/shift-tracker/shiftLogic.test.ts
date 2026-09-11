// Deno-native tests for shift-tracker's pure logic.
// Run with: deno test supabase/functions/shift-tracker/

import { assertEquals } from 'https://deno.land/std@0.168.0/testing/asserts.ts';
import {
  elapsedSeconds,
  isShiftAction,
  nearestZoneId,
  parseAmount,
  parseCoordinates,
  resolveShiftAction,
  resolveZoneTransition,
  type ZoneRow,
} from './shiftLogic.ts';

const ZONES: ZoneRow[] = [
  { id: 'lng-tl', city_id: 'lng', latitude: 45.5243, longitude: -73.5215 },
  { id: 'mtl-gc', city_id: 'mtl', latitude: 45.5003, longitude: -73.5672 },
];

Deno.test('isShiftAction: accepts the 5 known actions, rejects everything else', () => {
  assertEquals(isShiftAction('START'), true);
  assertEquals(isShiftAction('STOP'), true);
  assertEquals(isShiftAction('HEARTBEAT'), true);
  assertEquals(isShiftAction('ADD_EARNINGS'), true);
  assertEquals(isShiftAction('STATUS'), true);
  assertEquals(isShiftAction('DELETE'), false);
  assertEquals(isShiftAction(123), false);
  assertEquals(isShiftAction(undefined), false);
});

Deno.test('nearestZoneId: matches within threshold', () => {
  assertEquals(nearestZoneId(45.5243, -73.5215, ZONES), 'lng-tl');
});

Deno.test('nearestZoneId: null when every zone is out of range', () => {
  assertEquals(nearestZoneId(46.5, -70.0, ZONES), null);
});

Deno.test('elapsedSeconds: computes whole seconds since startedAt', () => {
  const startedAt = new Date('2026-09-06T12:00:00Z').toISOString();
  const nowMs = new Date('2026-09-06T12:05:30Z').getTime();
  assertEquals(elapsedSeconds(startedAt, nowMs), 330);
});

Deno.test('elapsedSeconds: never negative (clock skew / future-dated started_at)', () => {
  const startedAt = new Date('2026-09-06T12:10:00Z').toISOString();
  const nowMs = new Date('2026-09-06T12:00:00Z').getTime();
  assertEquals(elapsedSeconds(startedAt, nowMs), 0);
});

Deno.test('elapsedSeconds: invalid startedAt returns 0 instead of NaN', () => {
  assertEquals(elapsedSeconds('not-a-date', Date.now()), 0);
});

Deno.test('resolveZoneTransition: no change when the resolved zone matches current', () => {
  assertEquals(resolveZoneTransition('lng-tl', 'lng-tl'), { changed: false, newZoneId: 'lng-tl' });
});

Deno.test('resolveZoneTransition: change detected entering a new zone', () => {
  assertEquals(resolveZoneTransition(null, 'lng-tl'), { changed: true, newZoneId: 'lng-tl' });
});

Deno.test('resolveZoneTransition: change detected leaving zone coverage entirely', () => {
  assertEquals(resolveZoneTransition('lng-tl', null), { changed: true, newZoneId: null });
});

Deno.test('parseCoordinates: valid lat/lng', () => {
  assertEquals(parseCoordinates({ lat: 45.5, lng: -73.5 }), { lat: 45.5, lng: -73.5 });
});

Deno.test('parseCoordinates: rejects out-of-range or missing values', () => {
  assertEquals(parseCoordinates({ lat: 200, lng: -73.5 }), null);
  assertEquals(parseCoordinates({ lat: 45.5 }), null);
  assertEquals(parseCoordinates({}), null);
});

Deno.test('parseAmount: rejects zero, negative, and non-numeric', () => {
  assertEquals(parseAmount(12.5), 12.5);
  assertEquals(parseAmount(0), null);
  assertEquals(parseAmount(-5), null);
  assertEquals(parseAmount('abc'), null);
  assertEquals(parseAmount(undefined), null);
});


// ── resolveShiftAction (MacroDroid notification text) ────────────────────────

Deno.test('resolveShiftAction: an explicit action always wins over event text', () => {
  assertEquals(resolveShiftAction({ action: 'STATUS', event: "You're offline" }), {
    action: 'STATUS',
  });
});

Deno.test('resolveShiftAction: Lyft online wording maps to START (EN + FR)', () => {
  assertEquals(resolveShiftAction({ event: "You're online" }), { action: 'START' });
  assertEquals(resolveShiftAction({ event: 'Vous êtes en ligne' }), { action: 'START' });
  assertEquals(resolveShiftAction({ event: 'Started driving' }), { action: 'START' });
});

Deno.test('resolveShiftAction: Lyft offline wording maps to STOP/OFFLINE (EN + FR)', () => {
  assertEquals(resolveShiftAction({ event: "You're offline" }), {
    action: 'STOP',
    stopReason: 'OFFLINE',
  });
  assertEquals(resolveShiftAction({ event: 'Vous êtes hors ligne' }), {
    action: 'STOP',
    stopReason: 'OFFLINE',
  });
});

Deno.test('resolveShiftAction: the 12h-limit wording wins over the offline wording it contains', () => {
  // Lyft's own cutoff notification mentions both — it must not be recorded as
  // a plain voluntary offline.
  for (const text of [
    "You've reached the 12-hour limit — you're now offline",
    '12 hour driving limit reached',
    'Tu as atteint la limite de 12 h, tu es hors ligne',
    'limite de 12h atteinte',
  ]) {
    assertEquals(
      resolveShiftAction({ event: text }),
      { action: 'STOP', stopReason: 'HOURS_LIMIT' },
      text
    );
  }
});

Deno.test('resolveShiftAction: accepts a bare verb sent through event', () => {
  assertEquals(resolveShiftAction({ event: 'heartbeat' }), { action: 'HEARTBEAT' });
  assertEquals(resolveShiftAction({ event: 'STATUS' }), { action: 'STATUS' });
  assertEquals(resolveShiftAction({ event: '  status  ' }), { action: 'STATUS' });
});

Deno.test('resolveShiftAction: unrecognized text resolves to null, never a default START', () => {
  // A promo push ("Earn $12 more with 3 rides!") must not open a phantom shift.
  assertEquals(resolveShiftAction({ event: 'Earn $12 more with 3 rides!' }), null);
  assertEquals(resolveShiftAction({ event: '' }), null);
  assertEquals(resolveShiftAction({ event: '   ' }), null);
  assertEquals(resolveShiftAction({}), null);
  assertEquals(resolveShiftAction({ action: 'DELETE' }), null);
  assertEquals(resolveShiftAction({ event: 42 }), null);
});
