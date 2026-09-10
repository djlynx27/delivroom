import {
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

  it('defaults unknown/blank statuses to accepted', () => {
    expect(parseMaxymoOfferStatus('')).toBe('accepted');
    expect(parseMaxymoOfferStatus('Weird Status')).toBe('accepted');
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

    const inserts = buildTripsRawInsert(rows, '2026-03-20T10:00:00.000Z');

    expect(inserts).toHaveLength(2);
    expect(inserts[0]).toMatchObject({
      platform: 'maxymo',
      offer_status: 'accepted',
      pickup_distance_km: 3.7,
      trip_distance_km: 6.6,
    });
    expect(inserts[1]).toMatchObject({
      platform: 'maxymo',
      offer_status: 'rejected',
      pickup_distance_km: 1.6,
      trip_distance_km: null,
    });
  });
});
