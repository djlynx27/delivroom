import { buildZonePerformance } from '@/components/ZonePerformanceHeatmap';
import type { Zone } from '@/hooks/useSupabase';
import { describe, expect, it } from 'vitest';

function zone(id: string, name = id): Zone {
  return {
    id,
    name,
    type: 'commercial',
    latitude: 45.5,
    longitude: -73.5,
    city_id: 'mtl',
  } as Zone;
}

function trip(zoneId: string, earnings: number, hour: number, day: number) {
  const started = new Date(2026, 0, 4 + day); // 2026-01-04 is a Sunday (day 0)
  started.setHours(hour, 0, 0, 0);
  const ended = new Date(started.getTime() + 60 * 60_000); // 1h trip
  return {
    zone_id: zoneId,
    earnings,
    tips: 0,
    started_at: started.toISOString(),
    ended_at: ended.toISOString(),
  };
}

describe('buildZonePerformance', () => {
  it('returns an empty map when no trip matches the selected hour/day (section-wide empty state)', () => {
    const perf = buildZonePerformance({
      trips: [trip('z1', 50, 8, 1)], // Monday 08:00
      hour: '11',
      day: '5', // Friday
      zones: [zone('z1')],
    });
    expect(perf.size).toBe(0);
  });

  it('ranks zones green/yellow/red relative to the average and marks unseen zones grey', () => {
    const trips = [
      trip('high', 100, 11, 5),
      trip('low', 10, 11, 5),
    ];
    const perf = buildZonePerformance({
      trips,
      hour: '11',
      day: '5',
      zones: [zone('high'), zone('low'), zone('unseen')],
    });

    expect(perf.get('high')?.color).toBe('green');
    expect(perf.get('high')?.earningsPerHour).toBeGreaterThan(0);
    expect(perf.get('low')?.color).toBe('red');
    expect(perf.get('unseen')).toEqual({ color: 'grey', earningsPerHour: null });
  });
});
