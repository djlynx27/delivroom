import type { AppEvent } from '@/hooks/useEvents';
import type { Zone } from '@/hooks/useSupabase';
import { getHoliday, getHolidayDemandMultiplier } from '@/lib/holidayEngine';
import { buildTaxiRecommendations } from '@/lib/taxiMode';
import { describe, expect, it } from 'vitest';

// Noon Toronto (EDT/EST ±) to stay clear of day boundaries.
const at = (iso: string) => new Date(`${iso}T16:00:00.000Z`);

describe('getHoliday', () => {
  it.each([
    ['2026-10-12', 'Action de grâce'],
    ['2026-01-01', "Jour de l'An"],
    ['2026-04-03', 'Vendredi saint'],
    ['2026-04-06', 'Lundi de Pâques'],
    ['2026-05-18', 'Journée nationale des patriotes'],
    ['2026-09-07', 'Fête du travail'],
    ['2026-12-25', 'Noël'],
  ])('%s -> %s', (d, name) => {
    expect(getHoliday(at(d))?.name).toBe(name);
  });

  it('flags the weekday before a major holiday as an eve', () => {
    expect(getHoliday(at('2026-10-09'))).toMatchObject({ level: 'eve', isEve: true }); // Fri before Mon
  });

  it('ignores weekends and ordinary days', () => {
    expect(getHoliday(at('2026-06-27'))).toBeNull(); // Sat after Fête nationale week
    expect(getHoliday(at('2026-07-01'))?.name).toBe('Fête du Canada'); // Wed
    expect(getHoliday(at('2026-10-14'))).toBeNull();
    expect(getHolidayDemandMultiplier(at('2026-10-14'))).toBe(1);
  });
});

describe('Thanksgiving 2026-10-12 in taxi mode', () => {
  const zone = (id: string, type: string, lat: number): Zone =>
    ({ id, name: id, type, latitude: lat, longitude: -73.57, city_id: 'mtl' }) as unknown as Zone;
  const zones = [zone('biz', 'médical', 45.5), zone('air', 'aéroport', 45.5)];
  const scores = new Map([['biz', 80], ['air', 80]]);
  const build = (now: Date) =>
    buildTaxiRecommendations({
      zones,
      scores,
      events: [] as AppEvent[],
      now,
      origin: { latitude: 45.5, longitude: -73.57 },
    });
  const score = (rows: ReturnType<typeof build>, id: string) => rows.find((r) => r.id === id)?.score;

  it('cuts business hubs, keeps airport', () => {
    const holiday = build(at('2026-10-12'));
    const normal = build(at('2026-10-14'));
    expect(score(normal, 'biz')).toBe(80);
    expect(score(holiday, 'biz')).toBeCloseTo(80 * 0.55);
    expect(score(holiday, 'air')).toBe(80);
  });
});
