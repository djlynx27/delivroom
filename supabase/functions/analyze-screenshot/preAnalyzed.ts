// Pure helpers for analyze-screenshot's "pre-analyzed" mode, split out from
// index.ts so they are testable via `deno test` without binding index.ts's
// serve() listener (same pattern as autoSave.ts).
//
// Why this mode exists: the Gemini Vision call can be replaced by a structured
// analysis produced elsewhere (e.g. read from the screenshot by Claude Code on
// the owner's PC) while EVERYTHING downstream — zone resolution, auto-save,
// offer-signal recording, RLS/user attribution — stays on the exact same tested
// code path. The function is deployed --no-verify-jwt, so this mode is gated by a
// shared secret AND the payload is sanitized field by field: a caller-supplied
// analysis must never be trusted as-is.

import type { AnalysisResult, ExtractedData } from './index.ts';

/** Constant-time string comparison. Fails closed: no expected token => always false. */
export function tokensMatch(provided: string | null | undefined, expected: string | null | undefined): boolean {
  if (!expected || !provided) return false;
  let diff = provided.length ^ expected.length;
  const len = Math.max(provided.length, expected.length);
  for (let i = 0; i < len; i++) {
    diff |= (provided.charCodeAt(i) || 0) ^ (expected.charCodeAt(i) || 0);
  }
  return diff === 0;
}

const MIN_YEAR = 2025;
const MAX_ADDRESS_LEN = 200;
const MAX_NOTES_LEN = 160;
const MAX_WAYPOINTS = 10;

const DEMAND = ['low', 'medium', 'high', 'surge'] as const;
const TIME_CONTEXT = ['morning', 'afternoon', 'evening', 'night'] as const;
const TARGETS = ['demand', 'shift', 'daily', 'mileage', 'profit', 'unknown'] as const;
const WAYPOINT_TYPES = ['pickup', 'stop', 'dropoff'] as const;

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

function oneOf<T extends string>(value: unknown, allowed: readonly T[]): T | null {
  return typeof value === 'string' && (allowed as readonly string[]).includes(value) ? (value as T) : null;
}

/** A finite number within [min, max], else null. */
function boundedNumber(value: unknown, min: number, max: number): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  return value >= min && value <= max ? value : null;
}

function cleanString(value: unknown, maxLen: number): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, maxLen) : null;
}

/** YYYY-MM-DD with a plausible year, else null (never lets a bogus date pick a trip's started_at). */
function cleanDate(value: unknown, nowYear: number): string | null {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const parsed = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime())) return null;
  const year = parsed.getUTCFullYear();
  return year >= MIN_YEAR && year <= nowYear + 1 && parsed.toISOString().startsWith(value) ? value : null;
}

/** Exactly one pickup first, one dropoff last, stops between; otherwise null. */
function cleanWaypoints(value: unknown): ExtractedData['trip_waypoints'] {
  if (!Array.isArray(value) || value.length < 3 || value.length > MAX_WAYPOINTS) return null;
  const out: { type: 'pickup' | 'stop' | 'dropoff'; address: string }[] = [];
  for (const item of value) {
    if (!isRecord(item)) return null;
    const type = oneOf(item.type, WAYPOINT_TYPES);
    const address = cleanString(item.address, MAX_ADDRESS_LEN);
    if (!type || !address) return null;
    out.push({ type, address });
  }
  const pickups = out.filter((w) => w.type === 'pickup').length;
  const dropoffs = out.filter((w) => w.type === 'dropoff').length;
  return pickups === 1 && dropoffs === 1 && out[0]?.type === 'pickup' && out[out.length - 1]?.type === 'dropoff'
    ? out
    : null;
}

function cleanExtractedData(raw: Record<string, unknown>, nowYear: number): ExtractedData {
  return {
    earnings: boundedNumber(raw.earnings, 0, 1000),
    tips: boundedNumber(raw.tips, 0, 500),
    distance_km: boundedNumber(raw.distance_km, 0, 500),
    hours_worked: boundedNumber(raw.hours_worked, 0, 24),
    trips_count: boundedNumber(raw.trips_count, 0, 500),
    date: cleanDate(raw.date, nowYear),
    pickup_address: cleanString(raw.pickup_address, MAX_ADDRESS_LEN),
    dropoff_address: cleanString(raw.dropoff_address, MAX_ADDRESS_LEN),
    // Zone ids are NEVER taken from the caller: the server re-resolves them from the
    // addresses (resolvePickupDropoffZones) against the real catalog.
    pickup_zone_id: null,
    dropoff_zone_id: null,
    pickup_time_minutes: boundedNumber(raw.pickup_time_minutes, 0, 300),
    pickup_distance_km: boundedNumber(raw.pickup_distance_km, 0, 200),
    ride_time_minutes: boundedNumber(raw.ride_time_minutes, 0, 600),
    ride_distance_km: boundedNumber(raw.ride_distance_km, 0, 500),
    // The live Trip Tracking overlay is not part of this ingestion path.
    active_trip_payout: null,
    active_trip_distance_remaining_km: null,
    active_trip_distance_total_km: null,
    active_trip_time_remaining_min: null,
    active_trip_time_total_min: null,
    trip_waypoints: cleanWaypoints(raw.trip_waypoints),
  };
}

/** Returns a clean AnalysisResult, or null when the payload is not an analysis object at all. */
export function sanitizePreAnalysis(raw: unknown, now = new Date()): AnalysisResult | null {
  if (!isRecord(raw) || !isRecord(raw.extracted_data)) return null;
  return {
    zones_detected: [],
    overall_demand: oneOf(raw.overall_demand, DEMAND) ?? 'medium',
    time_context: oneOf(raw.time_context, TIME_CONTEXT),
    notes: cleanString(raw.notes, MAX_NOTES_LEN) ?? '',
    recommended_target: oneOf(raw.recommended_target, TARGETS) ?? 'unknown',
    extracted_data: cleanExtractedData(raw.extracted_data, now.getUTCFullYear()),
  };
}
