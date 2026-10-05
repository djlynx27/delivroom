// supabase/functions/weight-calibrator/calibrationCooldown.test.ts
import { assertEquals } from 'https://deno.land/std@0.168.0/testing/asserts.ts';
import { CALIBRATION_COOLDOWN_MS, calibrationCooldownRemainingSeconds } from './calibrationCooldown.ts';

const NOW = Date.parse('2026-10-05T12:00:00.000Z');
const ago = (ms: number) => new Date(NOW - ms).toISOString();
const MIN = 60_000;
const HOUR = 60 * MIN;

Deno.test('window is exactly 6 hours', () => {
  assertEquals(CALIBRATION_COOLDOWN_MS, 21_600_000);
});

Deno.test('calibrated 1 min ago -> blocked for the remaining 5h59m (21540 s)', () => {
  assertEquals(calibrationCooldownRemainingSeconds(ago(MIN), NOW), 21_540);
});

Deno.test('calibrated 5h59m ago -> 60 s left', () => {
  assertEquals(calibrationCooldownRemainingSeconds(ago(6 * HOUR - MIN), NOW), 60);
});

Deno.test('calibrated exactly 6h ago or more -> allowed', () => {
  assertEquals(calibrationCooldownRemainingSeconds(ago(6 * HOUR), NOW), 0);
  assertEquals(calibrationCooldownRemainingSeconds(ago(30 * HOUR), NOW), 0);
});

Deno.test('never calibrated / garbage timestamp -> allowed (fail open)', () => {
  assertEquals(calibrationCooldownRemainingSeconds(null, NOW), 0);
  assertEquals(calibrationCooldownRemainingSeconds(undefined, NOW), 0);
  assertEquals(calibrationCooldownRemainingSeconds('nope', NOW), 0);
});

Deno.test('timestamp in the future never locks out longer than one window', () => {
  assertEquals(calibrationCooldownRemainingSeconds(new Date(NOW + 48 * HOUR).toISOString(), NOW), 21_600);
});
