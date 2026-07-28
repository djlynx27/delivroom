import { describe, expect, it } from 'vitest';
import type { Zone } from '@/hooks/useSupabase';
import {
  nearestZoneId,
  normalizeStartedAt,
  resolveZoneIdFromAnalysis,
} from '@/lib/tripSave';

function zone(id: string, latitude: number, longitude: number): Zone {
  return { id, latitude, longitude } as unknown as Zone;
}

describe('normalizeStartedAt (year guard)', () => {
  const now = new Date('2026-07-25T12:00:00Z');

  it('keeps a valid recent date', () => {
    expect(normalizeStartedAt('2026-05-22', now)).toBe(
      new Date('2026-05-22').toISOString(),
    );
  });

  it('rejects a pre-app year (Gemini misread) and falls back to now', () => {
    expect(normalizeStartedAt('2020-05-22', now)).toBe(now.toISOString());
  });

  it('falls back to now when date is missing', () => {
    expect(normalizeStartedAt(null, now)).toBe(now.toISOString());
    expect(normalizeStartedAt(undefined, now)).toBe(now.toISOString());
  });

  it('falls back to now on an unparseable date', () => {
    expect(normalizeStartedAt('not-a-date', now)).toBe(now.toISOString());
  });
});

describe('nearestZoneId', () => {
  const zones = [
    zone('mtl-downtown', 45.5017, -73.5673),
    zone('lvl-chomedey', 45.5581, -73.7442),
    zone('lng-brossard', 45.4585, -73.4659),
  ];

  it('picks the closest zone to a GPS fix', () => {
    // ~ downtown Montreal
    expect(nearestZoneId(45.5019, -73.567, zones)).toBe('mtl-downtown');
    // ~ Brossard
    expect(nearestZoneId(45.459, -73.466, zones)).toBe('lng-brossard');
  });

  it('returns null when the fix is far outside the metro radius', () => {
    // Quebec City — ~230 km away, beyond MAX_GPS_ZONE_KM
    expect(nearestZoneId(46.8139, -71.208, zones)).toBeNull();
  });

  it('ignores zones without coordinates', () => {
    const withNull = [
      { id: 'no-geo', latitude: null, longitude: null } as unknown as Zone,
      zone('mtl-downtown', 45.5017, -73.5673),
    ];
    expect(nearestZoneId(45.5019, -73.567, withNull)).toBe('mtl-downtown');
  });
});

describe('resolveZoneIdFromAnalysis', () => {
  it('prefers the AI-matched zone', () => {
    expect(
      resolveZoneIdFromAnalysis({
        matched_zone_id: 'mtl-downtown',
        extracted_data: { pickup_zone_id: 'lvl-chomedey', dropoff_zone_id: 'lng-brossard' },
      }),
    ).toBe('mtl-downtown');
  });

  it('falls back to pickup, then dropoff', () => {
    expect(
      resolveZoneIdFromAnalysis({
        extracted_data: { pickup_zone_id: 'lvl-chomedey', dropoff_zone_id: 'lng-brossard' },
      }),
    ).toBe('lvl-chomedey');
    expect(
      resolveZoneIdFromAnalysis({
        extracted_data: { pickup_zone_id: null, dropoff_zone_id: 'lng-brossard' },
      }),
    ).toBe('lng-brossard');
  });

  it('returns null when no zone is present', () => {
    expect(resolveZoneIdFromAnalysis({})).toBeNull();
    expect(
      resolveZoneIdFromAnalysis({
        matched_zone_id: null,
        extracted_data: { pickup_zone_id: null, dropoff_zone_id: null },
      }),
    ).toBeNull();
  });
});
