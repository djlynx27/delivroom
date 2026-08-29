// Deno-native tests for surge-detector's push-noise-control logic.
// Run with: deno test supabase/functions/surge-detector/

import { assertEquals } from 'https://deno.land/std@0.168.0/testing/asserts.ts';
import {
  candidatesSignature,
  COOLDOWN_MS,
  decidePush,
  formatSurgeMessage,
  isRisingIntoPeak,
  MAJOR_SPIKE_MULTIPLIER,
  type NewPeakCandidate,
} from './surgePush.ts';

// ── isRisingIntoPeak ─────────────────────────────────────────────────────

Deno.test('isRisingIntoPeak: true when a zone with no history hits peak', () => {
  assertEquals(isRisingIntoPeak('peak', undefined), true);
});

Deno.test('isRisingIntoPeak: true when a zone climbs from high to peak', () => {
  assertEquals(
    isRisingIntoPeak('peak', { surge_class: 'high', surge_multiplier: 1.6 }),
    true
  );
});

Deno.test('isRisingIntoPeak: false when a zone was ALREADY peak last cycle (the spam case)', () => {
  assertEquals(
    isRisingIntoPeak('peak', { surge_class: 'peak', surge_multiplier: 1.9 }),
    false
  );
});

Deno.test('isRisingIntoPeak: false when the current cycle is not peak at all', () => {
  assertEquals(
    isRisingIntoPeak('high', { surge_class: 'elevated', surge_multiplier: 1.2 }),
    false
  );
});

// ── candidatesSignature ──────────────────────────────────────────────────

function candidate(zoneId: string, multiplier: number, delta = 0.1): NewPeakCandidate {
  return { zone_id: zoneId, zone_name: zoneId, surge_multiplier: multiplier, delta };
}

Deno.test('candidatesSignature: order-independent (same set, different array order)', () => {
  const a = candidatesSignature([candidate('mtl-a', 1.9), candidate('mtl-b', 2.1)]);
  const b = candidatesSignature([candidate('mtl-b', 2.1), candidate('mtl-a', 1.9)]);
  assertEquals(a, b);
});

Deno.test('candidatesSignature: differs when a multiplier changes meaningfully', () => {
  const a = candidatesSignature([candidate('mtl-a', 1.9)]);
  const b = candidatesSignature([candidate('mtl-a', 2.1)]);
  assertEquals(a === b, false);
});

// ── decidePush ────────────────────────────────────────────────────────────

const NOW = Date.parse('2026-08-29T18:00:00Z');

Deno.test('decidePush: no candidates -> skipped_no_candidates', () => {
  const result = decidePush({ candidates: [], lastPush: null, nowMs: NOW });
  assertEquals(result.decision, 'skipped_no_candidates');
});

Deno.test('decidePush: sends immediately when there is no prior push at all', () => {
  const result = decidePush({
    candidates: [candidate('mtl-a', 1.9)],
    lastPush: null,
    nowMs: NOW,
  });
  assertEquals(result.decision, 'sent');
});

Deno.test('decidePush: within cooldown with a single moderate candidate -> skipped_cooldown', () => {
  const result = decidePush({
    candidates: [candidate('mtl-a', 1.9)],
    lastPush: { createdAtMs: NOW - 10 * 60_000 }, // 10 min ago, well under 50 min
    nowMs: NOW,
  });
  assertEquals(result.decision, 'skipped_cooldown');
});

Deno.test('decidePush: past cooldown -> sends again', () => {
  const result = decidePush({
    candidates: [candidate('mtl-a', 1.9)],
    lastPush: { createdAtMs: NOW - (COOLDOWN_MS + 60_000) },
    nowMs: NOW,
  });
  assertEquals(result.decision, 'sent');
});

Deno.test('decidePush: major spike (2+ new peaks) bypasses an active cooldown', () => {
  const result = decidePush({
    candidates: [candidate('mtl-a', 1.9), candidate('mtl-b', 1.85)],
    lastPush: { createdAtMs: NOW - 5 * 60_000 }, // well within cooldown
    nowMs: NOW,
  });
  assertEquals(result.decision, 'sent');
});

Deno.test('decidePush: an extreme single multiplier bypasses an active cooldown', () => {
  const result = decidePush({
    candidates: [candidate('mtl-a', MAJOR_SPIKE_MULTIPLIER)],
    lastPush: { createdAtMs: NOW - 5 * 60_000 },
    nowMs: NOW,
  });
  assertEquals(result.decision, 'sent');
});

Deno.test('decidePush: identical signature to the last push is always skipped, even past cooldown', () => {
  const candidates = [candidate('mtl-a', 1.90)];
  const signature = candidatesSignature(candidates);
  const result = decidePush({
    candidates,
    lastPush: { createdAtMs: NOW - (COOLDOWN_MS + 60_000), signature },
    nowMs: NOW,
  });
  assertEquals(result.decision, 'skipped_duplicate');
});

Deno.test('decidePush: keeps only the top 3 candidates by multiplier', () => {
  const result = decidePush({
    candidates: [
      candidate('mtl-a', 1.85),
      candidate('mtl-b', 2.10),
      candidate('mtl-c', 1.95),
      candidate('mtl-d', 2.30),
    ],
    lastPush: null,
    nowMs: NOW,
  });
  assertEquals(result.top3.map((c) => c.zone_id), ['mtl-d', 'mtl-b', 'mtl-c']);
});

// ── formatSurgeMessage ────────────────────────────────────────────────────

Deno.test('formatSurgeMessage: names the exact zone and score, never a generic count-only blurb', () => {
  const { title, body } = formatSurgeMessage([
    { zone_id: 'lvl-montmorency', zone_name: 'Montmorency', surge_multiplier: 2.13, delta: 0.32 },
  ]);
  assertEquals(title, 'Surge Peak — Montmorency');
  assertEquals(body, '🔥 Montmorency: 2.13× (+0.32)');
});

Deno.test('formatSurgeMessage: multiple zones each get their own name + score in the body', () => {
  const { title, body } = formatSurgeMessage([
    { zone_id: 'lvl-montmorency', zone_name: 'Montmorency', surge_multiplier: 2.13, delta: 0.32 },
    { zone_id: 'mtl-centre-bell', zone_name: 'Centre Bell', surge_multiplier: 1.95, delta: -0.05 },
  ]);
  assertEquals(title, 'Surge Peak — 2 nouvelles zones');
  assertEquals(body, '🔥 Montmorency: 2.13× (+0.32) · 🔥 Centre Bell: 1.95× (-0.05)');
});
