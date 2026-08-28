import {
  getActiveEvents,
  getEndingSoonEvents,
  getStartingSoonEvents,
  isDemandRelevantEvent,
  matchZoneEvent,
  type AppEvent,
} from '@/hooks/useEvents';
import { makeLocalDate, makeLocalIso } from '@/test/dateTestUtils';
import { describe, expect, it } from 'vitest';

function makeEvent(overrides: Partial<AppEvent> = {}): AppEvent {
  return {
    id: 'event-1',
    name: 'Visites Guidees Centre Bell',
    venue: 'Centre Bell',
    city_id: 'mtl',
    latitude: 45.496,
    longitude: -73.569,
    start_at: '2026-03-21T05:30:00.000Z',
    end_at: '2026-03-21T07:30:00.000Z',
    capacity: 400,
    demand_impact: 1,
    boost_multiplier: 1.1,
    boost_radius_km: 1,
    boost_zone_types: ['tourisme'],
    category: 'event',
    is_holiday: false,
    ...overrides,
  };
}

describe('event demand relevance', () => {
  it('filters low-impact guided events overnight', () => {
    const event = makeEvent();

    expect(isDemandRelevantEvent(event, makeLocalDate(2026, 2, 21, 2))).toBe(
      false
    );
  });

  it('keeps large nightlife-relevant events overnight', () => {
    const event = makeEvent({
      name: 'Sortie de concert Place Bell',
      capacity: 8000,
      demand_impact: 4,
      boost_multiplier: 1.9,
      boost_zone_types: ['nightlife', 'événements'],
      category: 'festival',
    });

    expect(isDemandRelevantEvent(event, makeLocalDate(2026, 2, 21, 2))).toBe(
      true
    );
  });

  it('excludes low-impact overnight events from active events', () => {
    const now = makeLocalDate(2026, 2, 21, 2);
    const events = [
      makeEvent({
        start_at: makeLocalIso(2026, 2, 21, 0, 30),
        end_at: makeLocalIso(2026, 2, 21, 2, 30),
      }),
    ];

    expect(getActiveEvents(events, now)).toEqual([]);
  });

  it('keeps upcoming major overnight events in starting soon', () => {
    const now = makeLocalDate(2026, 2, 21, 1, 15);
    const events = [
      makeEvent({
        name: 'Fin de concert Place Bell',
        start_at: makeLocalIso(2026, 2, 21, 2, 0),
        end_at: makeLocalIso(2026, 2, 21, 4, 30),
        capacity: 9000,
        demand_impact: 4,
        boost_multiplier: 1.8,
        boost_zone_types: ['nightlife', 'événements'],
        category: 'sport',
      }),
    ];

    expect(getStartingSoonEvents(events, now, 90)).toHaveLength(1);
  });
});

describe('matchZoneEvent', () => {
  const nightlifeZone = { latitude: 45.508, longitude: -73.562, type: 'nightlife' };

  it('matches a zone within the event radius and matching zone type', () => {
    const event = makeEvent({
      boost_zone_types: ['nightlife'],
      boost_radius_km: 2,
    });
    expect(matchZoneEvent(nightlifeZone, [event])).toBe(event);
  });

  it('excludes a zone outside the boost radius even with a matching type', () => {
    const farEvent = makeEvent({
      boost_zone_types: ['nightlife'],
      boost_radius_km: 1,
      latitude: 45.6, // ~10 km away
      longitude: -73.5,
    });
    expect(matchZoneEvent(nightlifeZone, [farEvent])).toBeUndefined();
  });

  it('excludes a zone whose type is not in boost_zone_types', () => {
    const touristEvent = makeEvent({
      boost_zone_types: ['tourisme'],
      boost_radius_km: 5,
    });
    expect(matchZoneEvent(nightlifeZone, [touristEvent])).toBeUndefined();
  });

  it('applies to every zone type when boost_zone_types is empty', () => {
    const cityWideEvent = makeEvent({ boost_zone_types: [], boost_radius_km: 5 });
    expect(matchZoneEvent(nightlifeZone, [cityWideEvent])).toBe(cityWideEvent);
  });

  it('returns the first matching candidate, so callers control priority via ordering', () => {
    const endingSoon = makeEvent({
      id: 'ending-soon',
      boost_zone_types: ['nightlife'],
      boost_radius_km: 5,
    });
    const merelyActive = makeEvent({
      id: 'active',
      boost_zone_types: ['nightlife'],
      boost_radius_km: 5,
    });
    expect(matchZoneEvent(nightlifeZone, [endingSoon, merelyActive])?.id).toBe(
      'ending-soon'
    );
  });
});

describe('invalid date guards in event filters', () => {
  const now = new Date('2026-03-21T14:00:00Z');

  it('getActiveEvents silently drops events with invalid start_at', () => {
    const badEvent = makeEvent({ start_at: 'not-a-date' });
    const goodEvent = makeEvent({
      start_at: '2026-03-21T13:00:00Z',
      end_at: '2026-03-21T15:00:00Z',
    });
    expect(getActiveEvents([badEvent, goodEvent], now)).toEqual([goodEvent]);
  });

  it('getActiveEvents silently drops events with invalid end_at', () => {
    const badEvent = makeEvent({ end_at: 'not-a-date' });
    expect(getActiveEvents([badEvent], now)).toEqual([]);
  });

  it('getEndingSoonEvents silently drops events with invalid end_at', () => {
    const badEvent = makeEvent({ end_at: 'invalid' });
    const goodEvent = makeEvent({
      start_at: '2026-03-21T13:00:00Z',
      end_at: '2026-03-21T14:30:00Z',
    });
    expect(getEndingSoonEvents([badEvent, goodEvent], now, 60)).toEqual([
      goodEvent,
    ]);
  });

  it('getStartingSoonEvents silently drops events with invalid start_at', () => {
    const badEvent = makeEvent({ start_at: 'garbage' });
    const goodEvent = makeEvent({
      start_at: '2026-03-21T14:30:00Z',
      end_at: '2026-03-21T16:00:00Z',
    });
    expect(getStartingSoonEvents([badEvent, goodEvent], now, 90)).toEqual([
      goodEvent,
    ]);
  });
});
