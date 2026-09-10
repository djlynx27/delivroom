import {
  buildAcceptedTripInsert,
  buildTripsRawInsert,
  parseMaxymoCsv,
  parseMaxymoDistanceKm,
  parseMaxymoDurationMin,
  parseMaxymoOfferStatus,
} from '@/lib/maxymoCsvParsing';
import { describe, expect, it } from 'vitest';

describe('parseMaxymoDistanceKm', () => {
  it('converts a miles value to km', () => {
    expect(parseMaxymoDistanceKm('2.3 mi')).toBe(3.7);
  });

  it('keeps a km value as-is', () => {
    expect(parseMaxymoDistanceKm('3.7 km')).toBe(3.7);
  });

  it('treats a bare number as already km', () => {
    expect(parseMaxymoDistanceKm('5')).toBe(5);
  });

  it('returns null for blank or malformed values', () => {
    expect(parseMaxymoDistanceKm('')).toBeNull();
    expect(parseMaxymoDistanceKm('n/a')).toBeNull();
  });

  it('converts a no-space miles value ("3.2mi") — regression for the missed word-boundary case', () => {
    expect(parseMaxymoDistanceKm('3.2mi')).toBe(5.1);
  });
});

describe('parseMaxymoDurationMin', () => {
  it('parses a "X min" string', () => {
    expect(parseMaxymoDurationMin('7 min')).toBe(7);
  });

  it('parses an mm:ss string into fractional minutes', () => {
    expect(parseMaxymoDurationMin('1:30')).toBe(1.5);
  });

  it('treats a bare number as already minutes', () => {
    expect(parseMaxymoDurationMin('12')).toBe(12);
  });

  it('returns null for blank or malformed values', () => {
    expect(parseMaxymoDurationMin('')).toBeNull();
    expect(parseMaxymoDurationMin('n/a')).toBeNull();
  });
});

describe('parseMaxymoOfferStatus', () => {
  it('classifies completed/accepted offers as accepted', () => {
    expect(parseMaxymoOfferStatus('Completed')).toBe('accepted');
    expect(parseMaxymoOfferStatus('Accepted')).toBe('accepted');
  });

  it('classifies declined/missed offers as rejected', () => {
    expect(parseMaxymoOfferStatus('Declined')).toBe('rejected');
    expect(parseMaxymoOfferStatus('Missed')).toBe('rejected');
    expect(parseMaxymoOfferStatus('Cancelled')).toBe('rejected');
  });

  it('fails closed to unknown for blank/unrecognized statuses — never a fabricated accepted', () => {
    expect(parseMaxymoOfferStatus('')).toBe('unknown');
    expect(parseMaxymoOfferStatus('Weird Status')).toBe('unknown');
  });
});

describe('parseMaxymoCsv', () => {
  const csv =
    'Pickup Distance,Pickup Time,Trip Distance,Drive Time,Status,Fare\n' +
    '2.3 mi,3 min,4.1 mi,12 min,Completed,18.50\n' +
    '1 mi,2 min,,,Declined,\n';

  it('extracts and converts the four distance/time fields', () => {
    const rows = parseMaxymoCsv(csv);

    expect(rows[0]).toMatchObject({
      pickupDistanceKm: 3.7,
      pickupTimeMin: 3,
      tripDistanceKm: 6.6,
      driveTimeMin: 12,
      offerStatus: 'accepted',
      fareCad: 18.5,
    });
  });

  it('keeps a rejected offer with null trip fields', () => {
    const rows = parseMaxymoCsv(csv);

    expect(rows[1]).toMatchObject({
      pickupDistanceKm: 1.6,
      pickupTimeMin: 2,
      tripDistanceKm: null,
      driveTimeMin: null,
      offerStatus: 'rejected',
      fareCad: null,
    });
  });
});

describe('buildTripsRawInsert', () => {
  it('maps accepted and rejected offers into trips_raw rows for market history', () => {
    const csv =
      'Pickup Distance,Pickup Time,Trip Distance,Drive Time,Status,Fare\n' +
      '2.3 mi,3 min,4.1 mi,12 min,Completed,18.50\n' +
      '1 mi,2 min,,,Declined,\n';
    const rows = parseMaxymoCsv(csv);

    const inserts = buildTripsRawInsert(rows, '2026-03-20T10:00:00.000Z', 'driver-1', 'zone-1');

    expect(inserts).toHaveLength(2);
    expect(inserts[0]).toMatchObject({
      driver_id: 'driver-1',
      platform: 'maxymo',
      offer_status: 'accepted',
      zone_id: 'zone-1',
      pickup_distance_km: 3.7,
      trip_distance_km: 6.6,
    });
    expect(inserts[0]?.content_hash).toBeTruthy();
    expect(inserts[1]).toMatchObject({
      driver_id: 'driver-1',
      platform: 'maxymo',
      offer_status: 'rejected',
      pickup_distance_km: 1.6,
      trip_distance_km: null,
    });
  });

  it('uses each row own Date column when present instead of the fallback', () => {
    const csv =
      'Date,Pickup Distance,Pickup Time,Trip Distance,Drive Time,Status,Fare\n' +
      '2026-03-20T08:00:00.000Z,2.3 mi,3 min,4.1 mi,12 min,Completed,18.50\n';
    const rows = parseMaxymoCsv(csv);

    const inserts = buildTripsRawInsert(rows, '2026-01-01T00:00:00.000Z', 'driver-1', null);

    expect(inserts[0]?.started_at).toBe('2026-03-20T08:00:00.000Z');
  });
});

describe('buildAcceptedTripInsert', () => {
  const csv =
    'Pickup Distance,Pickup Time,Trip Distance,Drive Time,Status,Fare\n' +
    '2.3 mi,3 min,4.1 mi,12 min,Completed,18.50\n' +
    '1 mi,2 min,,,Declined,\n';
  const [accepted, rejected] = parseMaxymoCsv(csv);

  it('builds a trips insert row for an accepted offer', () => {
    const insert = buildAcceptedTripInsert(
      accepted!,
      'user-1',
      '2026-03-20T10:00:00.000Z',
      'zone-1'
    );

    expect(insert).toMatchObject({
      user_id: 'user-1',
      platform: 'maxymo',
      zone_id: 'zone-1',
      earnings: 18.5,
      distance_km: 6.6,
      pickup_distance_km: 3.7,
      trip_distance_km: 6.6,
      drive_time_min: 12,
    });
    expect(insert?.started_at).toBe('2026-03-20T10:00:00.000Z');
    expect(insert?.ended_at).toBe('2026-03-20T10:15:00.000Z');
  });

  it('returns null for a rejected offer — those only feed trips_raw', () => {
    expect(
      buildAcceptedTripInsert(rejected!, 'user-1', '2026-03-20T10:00:00.000Z', null)
    ).toBeNull();
  });
});
