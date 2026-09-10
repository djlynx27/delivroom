import { parseCsvRecords } from '@/lib/csv';
import { parseOptionalCurrencyValue } from '@/lib/csvTripParsing';

const MILES_TO_KM = 1.60934;

export type MaxymoOfferStatus = 'accepted' | 'rejected';

export interface MaxymoCsvRecord {
  pickupDistanceKm: number | null;
  pickupTimeMin: number | null;
  tripDistanceKm: number | null;
  driveTimeMin: number | null;
  offerStatus: MaxymoOfferStatus;
  fareCad: number | null;
  raw: Record<string, string>;
}

export interface MaxymoTripsRawInsert {
  platform: 'maxymo';
  offer_status: MaxymoOfferStatus;
  started_at: string;
  pickup_distance_km: number | null;
  pickup_time_min: number | null;
  trip_distance_km: number | null;
  drive_time_min: number | null;
  fare_cad: number | null;
}

export function parseMaxymoDistanceKm(value: string): number | null {
  const trimmed = value.trim();
  if (!trimmed) return null;

  const parsed = Number.parseFloat(trimmed.replace(/[^0-9.]/g, ''));
  if (!Number.isFinite(parsed)) return null;

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
];

export function parseMaxymoOfferStatus(value: string): MaxymoOfferStatus {
  const normalized = value.trim().toLowerCase();
  const isRejected = REJECTED_STATUS_KEYWORDS.some((keyword) =>
    normalized.includes(keyword)
  );
  return isRejected ? 'rejected' : 'accepted';
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
    raw: row,
  };
}

export function parseMaxymoCsv(text: string): MaxymoCsvRecord[] {
  return parseCsvRecords(text).map(parseMaxymoCsvRow);
}

export function buildTripsRawInsert(
  records: MaxymoCsvRecord[],
  startedAtIso: string
): MaxymoTripsRawInsert[] {
  return records.map((record) => ({
    platform: 'maxymo',
    offer_status: record.offerStatus,
    started_at: startedAtIso,
    pickup_distance_km: record.pickupDistanceKm,
    pickup_time_min: record.pickupTimeMin,
    trip_distance_km: record.tripDistanceKm,
    drive_time_min: record.driveTimeMin,
    fare_cad: record.fareCad,
  }));
}
