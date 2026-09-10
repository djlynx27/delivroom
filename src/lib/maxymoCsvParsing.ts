import { parseCsvRecords } from '@/lib/csv';
import { parseOptionalCurrencyValue } from '@/lib/csvTripParsing';
import {
  computeEndedAt,
  normalizeStartedAt,
  resolveDurationMinutes,
} from '@/lib/tripSave';

const MILES_TO_KM = 1.60934;
const DATE_COLUMN_CANDIDATES = [
  'date',
  'started_at',
  'request_time',
  'pickup_date',
  'trip_date',
  'timestamp',
];

export type MaxymoOfferStatus = 'accepted' | 'rejected' | 'unknown';

export interface MaxymoCsvRecord {
  pickupDistanceKm: number | null;
  pickupTimeMin: number | null;
  tripDistanceKm: number | null;
  driveTimeMin: number | null;
  offerStatus: MaxymoOfferStatus;
  fareCad: number | null;
  /** Raw value of whichever date-ish column the row carried, if any — see
   * DATE_COLUMN_CANDIDATES. Resolved against a fallback via normalizeStartedAt. */
  rawDate: string;
  raw: Record<string, string>;
  /** Deterministic fingerprint of the raw row — lets the importer skip a row
   * it already saved (re-dropping the same export) without a round trip per
   * row. See hashMaxymoRow. */
  contentHash: string;
}

export interface MaxymoTripsRawInsert {
  driver_id: string;
  platform: 'maxymo';
  offer_status: MaxymoOfferStatus;
  started_at: string;
  zone_id: string | null;
  pickup_distance_km: number | null;
  pickup_time_min: number | null;
  trip_distance_km: number | null;
  drive_time_min: number | null;
  fare_cad: number | null;
  content_hash: string;
}

export interface MaxymoTripInsert {
  user_id: string;
  platform: 'maxymo';
  started_at: string;
  ended_at: string | null;
  zone_id: string | null;
  earnings: number | null;
  distance_km: number | null;
  pickup_distance_km: number | null;
  pickup_time_min: number | null;
  trip_distance_km: number | null;
  drive_time_min: number | null;
  notes: string;
}

export function parseMaxymoDistanceKm(value: string): number | null {
  const trimmed = value.trim();
  if (!trimmed) return null;

  const parsed = Number.parseFloat(trimmed.replace(/[^0-9.]/g, ''));
  if (!Number.isFinite(parsed)) return null;

  // No leading \b: a no-space export like "3.2mi" has no word boundary
  // between the digit and "m", so requiring one there missed this format
  // entirely and silently treated it as already-km (~40% under the real
  // distance). "km" is excluded first so it can't ever match through here.
  const isMiles = /mi\b/i.test(trimmed) && !/km/i.test(trimmed);
  const km = isMiles ? parsed * MILES_TO_KM : parsed;
  return Math.round(km * 10) / 10;
}

export function parseMaxymoDurationMin(value: string): number | null {
  const trimmed = value.trim();
  if (!trimmed) return null;

  if (trimmed.includes(':')) {
    const parts = trimmed.split(':').map((part) => Number.parseFloat(part));
    if (parts.some((part) => !Number.isFinite(part))) return null;

    // mm:ss (2 parts) or hh:mm:ss (3 parts) — reduce right-to-left into minutes.
    const minutes = parts.reduce((acc, part) => acc * 60 + part, 0) / 60;
    return Math.round(minutes * 100) / 100;
  }

  const parsed = Number.parseFloat(trimmed.replace(/[^0-9.]/g, ''));
  return Number.isFinite(parsed) ? parsed : null;
}

const REJECTED_STATUS_KEYWORDS = [
  'declin',
  'reject',
  'missed',
  'cancel',
  'timeout',
  'expired',
  'no show',
  'noshow',
];

const ACCEPTED_STATUS_KEYWORDS = ['complet', 'accept'];

/** Fail-closed: a status string this app doesn't recognize (Maxymo renames a
 * column value, a header drifts) is neither accepted nor rejected — it's
 * excluded from `trips` (no fabricated earnings) but kept in `trips_raw` so
 * nothing is silently dropped, and the importer surfaces a count of these so
 * a human can look at what changed upstream. */
export function parseMaxymoOfferStatus(value: string): MaxymoOfferStatus {
  const normalized = value.trim().toLowerCase();
  if (REJECTED_STATUS_KEYWORDS.some((keyword) => normalized.includes(keyword)))
    return 'rejected';
  if (ACCEPTED_STATUS_KEYWORDS.some((keyword) => normalized.includes(keyword)))
    return 'accepted';
  return 'unknown';
}

function findRawDate(row: Record<string, string>): string {
  for (const key of DATE_COLUMN_CANDIDATES) {
    if (row[key]) return row[key]!;
  }
  return '';
}

function canonicalRowString(row: Record<string, string>): string {
  return Object.keys(row)
    .sort()
    .map((key) => `${key}=${row[key]}`)
    .join('|');
}

// ponytail: FNV-1a 32-bit, not a security hash — fine for de-duplicating a
// personal CSV export (hundreds of rows), collision risk grows past ~10k
// rows/user. Switch to SubtleCrypto SHA-256 (async) if that ever matters.
export function hashMaxymoRow(row: Record<string, string>): string {
  const input = canonicalRowString(row);
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

export function parseMaxymoCsvRow(row: Record<string, string>): MaxymoCsvRecord {
  const offerStatus = parseMaxymoOfferStatus(row.status ?? '');

  return {
    pickupDistanceKm: parseMaxymoDistanceKm(row.pickup_distance ?? ''),
    pickupTimeMin: parseMaxymoDurationMin(row.pickup_time ?? ''),
    tripDistanceKm: parseMaxymoDistanceKm(row.trip_distance ?? ''),
    driveTimeMin: parseMaxymoDurationMin(row.drive_time ?? ''),
    offerStatus,
    fareCad: parseOptionalCurrencyValue(row.fare ?? '') || null,
    rawDate: findRawDate(row),
    raw: row,
    contentHash: hashMaxymoRow(row),
  };
}

export function parseMaxymoCsv(text: string): MaxymoCsvRecord[] {
  return parseCsvRecords(text).map(parseMaxymoCsvRow);
}

export function buildTripsRawInsert(
  records: MaxymoCsvRecord[],
  fallbackIso: string,
  driverId: string,
  zoneId: string | null
): MaxymoTripsRawInsert[] {
  const fallback = new Date(fallbackIso);
  return records.map((record) => ({
    driver_id: driverId,
    platform: 'maxymo',
    offer_status: record.offerStatus,
    started_at: normalizeStartedAt(record.rawDate, fallback),
    zone_id: zoneId,
    pickup_distance_km: record.pickupDistanceKm,
    pickup_time_min: record.pickupTimeMin,
    trip_distance_km: record.tripDistanceKm,
    drive_time_min: record.driveTimeMin,
    fare_cad: record.fareCad,
    content_hash: record.contentHash,
  }));
}

/** Only accepted offers become `trips` rows — rejected/unknown-status ones
 * have no ride to log, they exist purely as trips_raw market history. */
export function buildAcceptedTripInsert(
  record: MaxymoCsvRecord,
  userId: string,
  fallbackIso: string,
  zoneId: string | null
): MaxymoTripInsert | null {
  if (record.offerStatus !== 'accepted') return null;

  const startedAt = normalizeStartedAt(record.rawDate, new Date(fallbackIso));
  const durationMinutes = resolveDurationMinutes({
    pickup_time_minutes: record.pickupTimeMin,
    ride_time_minutes: record.driveTimeMin,
  });

  return {
    user_id: userId,
    platform: 'maxymo',
    started_at: startedAt,
    ended_at: computeEndedAt(startedAt, durationMinutes),
    zone_id: zoneId,
    earnings: record.fareCad,
    distance_km: record.tripDistanceKm,
    pickup_distance_km: record.pickupDistanceKm,
    pickup_time_min: record.pickupTimeMin,
    trip_distance_km: record.tripDistanceKm,
    drive_time_min: record.driveTimeMin,
    notes: 'Import CSV Maxymo',
  };
}
