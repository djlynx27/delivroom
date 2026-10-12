import type { AppEvent } from '@/hooks/useEvents';
import type { Zone } from '@/hooks/useSupabase';
import {
  TAXI_HUBS,
  buildTaxiRecommendations,
  isVirtualTaxiId,
  taxiEventBadge,
} from '@/lib/taxiMode';
import { haversineKm } from '@/hooks/useUserLocation';
import { describe, expect, it } from 'vitest';

const NOW = new Date('2026-10-12T22:00:00.000Z');

function zone(
  id: string,
  type: string,
  latitude: number,
  longitude: number,
  name = id
): Zone {
  return {
    id,
    name,
    type,
    latitude,
    longitude,
    city_id: 'mtl',
  } as unknown as Zone;
}

function event(overrides: Partial<AppEvent> = {}): AppEvent {
  return {
    id: 'ev-1',
    name: 'Match Canadiens',
    venue: 'Centre Bell',
    city_id: 'mtl',
    latitude: 45.4961,
    longitude: -73.5693,
    start_at: '2026-10-12T21:00:00.000Z',
    end_at: '2026-10-13T00:00:00.000Z',
    capacity: 21000,
    demand_impact: 5,
    boost_multiplier: 1.15,
    boost_radius_km: 1,
    boost_zone_types: [],
    category: 'sport',
    is_holiday: false,
    ...overrides,
  };
}

const ORIGIN = { latitude: 45.5017, longitude: -73.5673 }; // centre-ville MTL

function recommend(
  zones: Zone[],
  scores: Record<string, number>,
  events: AppEvent[] = [],
  origin = ORIGIN
) {
  return buildTaxiRecommendations({
    zones,
    scores: new Map(Object.entries(scores)),
    events,
    now: NOW,
    origin,
  });
}

describe('TAXI_HUBS data', () => {
  it('has unique ids and plausible Montréal-area coordinates', () => {
    const ids = TAXI_HUBS.map((h) => h.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(TAXI_HUBS.length).toBeGreaterThanOrEqual(13);
    for (const h of TAXI_HUBS) {
      expect(h.latitude).toBeGreaterThan(45.3);
      expect(h.latitude).toBeLessThan(45.7);
      expect(h.longitude).toBeGreaterThan(-74.0);
      expect(h.longitude).toBeLessThan(-73.3);
    }
  });

  it('keeps Terminus Longueuil on the real terminus (regression: bad -73.447 value)', () => {
    const lng = TAXI_HUBS.find((h) => h.id === 'lng-terminus');
    expect(lng).toBeDefined();
    // Real terminus ~(45.524, -73.5215); the wrong value was ~5.8 km east.
    expect(haversineKm(45.524, -73.5215, lng!.latitude, lng!.longitude)).toBeLessThan(0.5);
  });
});

describe('buildTaxiRecommendations — hubs only', () => {
  it('drops non-hub zone types (résidentiel, commercial) and keeps hub types', () => {
    const out = recommend(
      [
        zone('res-1', 'résidentiel', 45.53, -73.6),
        zone('com-1', 'commercial', 45.525, -73.605),
        zone('mtl-gc', 'transport', 45.5, -73.5666, 'Gare Centrale'),
      ],
      { 'res-1': 90, 'com-1': 95, 'mtl-gc': 40 }
    );
    const ids = out.map((z) => z.id);
    expect(ids).toContain('mtl-gc');
    expect(ids).not.toContain('res-1');
    expect(ids).not.toContain('com-1');
  });

  it('does not duplicate a static hub already covered by a real zone within 400 m', () => {
    const out = recommend(
      [zone('mtl-gc', 'transport', 45.5002, -73.5663, 'Gare Centrale')],
      { 'mtl-gc': 60 }
    );
    const near = out.filter(
      (z) => haversineKm(z.latitude, z.longitude, 45.5002, -73.5661) < 0.4
    );
    expect(near).toHaveLength(1);
    expect(near[0]?.id).toBe('mtl-gc');
  });

  it('adds virtual hubs for static hubs with no real zone, inheriting the nearest zone score', () => {
    const out = recommend(
      [zone('mtl-gc', 'transport', 45.5002, -73.5663)],
      { 'mtl-gc': 72 }
    );
    const bell = out.find((z) => z.id === 'taxi-hub:mtl-centre-bell');
    expect(bell).toBeDefined();
    expect(isVirtualTaxiId(bell!.id)).toBe(true);
    expect(bell!.score).toBe(72);
    expect(bell!.taxiTier).toBe('hub');
  });

  it('falls back to a neutral score for a hub with no real zone within 3 km', () => {
    const out = recommend([], {});
    const sd = out.find((z) => z.id === 'taxi-hub:lvl-rem-ste-dorothee');
    // Ste-Dorothée is > 7 km from downtown MTL → filtered by the distance cap
    expect(sd).toBeUndefined();
    const near = recommend([], {}, [], { latitude: 45.55, longitude: -73.84 });
    const sd2 = near.find((z) => z.id === 'taxi-hub:lvl-rem-ste-dorothee');
    expect(sd2?.score).toBe(50);
  });
});

describe('buildTaxiRecommendations — events', () => {
  it('ranks an in-progress event above a higher-scored hub (the shadowing bug)', () => {
    const out = recommend(
      [zone('mtl-gc', 'transport', 45.5002, -73.5663, 'Gare Centrale')],
      { 'mtl-gc': 98 },
      [event()]
    );
    expect(out[0]?.taxiTier).toBe('event');
    expect(out[0]?.id).not.toBe('mtl-gc');
  });

  it('takes over the nearby hub: official coordinates and a combined name', () => {
    const out = recommend([], {}, [event()]);
    const top = out[0];
    expect(top?.taxiTier).toBe('event');
    expect(top?.name).toContain('Centre Bell');
    expect(top?.name).toContain('Match Canadiens');
    const hub = TAXI_HUBS.find((h) => h.id === 'mtl-centre-bell')!;
    expect(top?.latitude).toBe(hub.latitude);
    expect(top?.longitude).toBe(hub.longitude);
    // the hub itself must not also appear as a separate row
    expect(out.filter((z) => z.id === 'taxi-hub:mtl-centre-bell')).toHaveLength(0);
  });

  it('includes events starting within 45 minutes but not later ones', () => {
    const soon = event({
      id: 'soon',
      name: 'Concert soon',
      latitude: 45.51,
      longitude: -73.56,
      start_at: '2026-10-12T22:30:00.000Z',
      end_at: '2026-10-13T01:00:00.000Z',
    });
    const later = event({
      id: 'later',
      name: 'Concert later',
      latitude: 45.505,
      longitude: -73.575,
      start_at: '2026-10-12T23:30:00.000Z',
      end_at: '2026-10-13T02:00:00.000Z',
    });
    const names = recommend([], {}, [soon, later]).map((z) => z.name);
    expect(names.some((n) => n.includes('Concert soon'))).toBe(true);
    expect(names.some((n) => n.includes('Concert later'))).toBe(false);
  });

  it('ignores holidays and zero-capacity events (no precise spot to send a driver to)', () => {
    const holiday = event({
      id: 'hol',
      name: 'Action de Grâces',
      is_holiday: true,
      capacity: 0,
      latitude: 45.5,
      longitude: -73.6,
      start_at: '2026-10-12T12:00:00.000Z',
      end_at: '2026-10-12T23:00:00.000Z',
    });
    const out = recommend([], {}, [holiday]);
    expect(out.some((z) => z.name.includes('Action de Grâces'))).toBe(false);
  });

  it('collapses repeated events at the same place into one row', () => {
    const base = {
      name: 'Retard majeur — Terminus Longueuil',
      latitude: 45.524,
      longitude: -73.5215,
      category: 'transit',
      capacity: 12000,
      boost_multiplier: 1.45,
    };
    const out = recommend(
      [],
      {},
      [
        event({ ...base, id: 'a', start_at: '2026-10-12T21:00:00.000Z', end_at: '2026-10-13T00:00:00.000Z' }),
        event({ ...base, id: 'b', start_at: '2026-10-12T21:30:00.000Z', end_at: '2026-10-13T00:30:00.000Z' }),
      ],
      { latitude: 45.52, longitude: -73.52 }
    );
    expect(out.filter((z) => z.taxiTier === 'event')).toHaveLength(1);
  });

  it('keeps events beyond the hub radius (10 km) out of the list', () => {
    const far = event({ id: 'far', name: 'Far event', latitude: 45.6, longitude: -73.2 });
    expect(recommend([], {}, [far]).some((z) => z.name.includes('Far event'))).toBe(false);
  });

  it('never lists a Lyft-only or generic zone: output is only hubs and events', () => {
    const out = recommend(
      [
        zone('nl-1', 'nightlife', 45.52, -73.585),
        zone('un-1', 'université', 45.505, -73.615),
      ],
      { 'nl-1': 99, 'un-1': 99 }
    );
    expect(out.every((z) => z.taxiTier === 'hub' || z.taxiTier === 'event')).toBe(true);
    expect(out.map((z) => z.id)).not.toContain('nl-1');
    expect(out.map((z) => z.id)).not.toContain('un-1');
  });
});

describe('event on a real hub zone', () => {
  it('keeps the real zone id (FK-safe) and floors the score at the event priority', () => {
    const out = recommend(
      [zone('mtl-cb', 'événements', 45.4953, -73.5697, 'Centre Bell')],
      { 'mtl-cb': 60 },
      [event()]
    );
    const top = out[0];
    expect(top?.id).toBe('mtl-cb');
    expect(isVirtualTaxiId(top?.id ?? '')).toBe(false);
    expect(top?.score).toBeGreaterThanOrEqual(95);
    expect(top?.taxiTier).toBe('event');
  });
});

describe('taxiEventBadge', () => {
  it('returns the badge only for event rows', () => {
    expect(taxiEventBadge({ name: 'X', taxiTier: 'event', eventEndAt: 'T' })).toEqual({
      name: 'X',
      end_at: 'T',
    });
    expect(taxiEventBadge({ name: 'X', taxiTier: 'hub' })).toBeUndefined();
    expect(taxiEventBadge({ name: 'X' })).toBeUndefined();
  });
});

describe('official Montréal taxi-stand anchoring (Option A)', () => {
  const MTL_STAND_HUBS = [
    'mtl-gare-centrale',
    'mtl-centre-bell',
    'mtl-berri-uqam',
    'mtl-chum',
    'mtl-yul',
  ];

  it('anchors exactly the 5 Montréal hubs on an official stand, none in Laval/Longueuil', () => {
    const withStand = TAXI_HUBS.filter((h) => h.stand).map((h) => h.id);
    expect(withStand.sort()).toEqual([...MTL_STAND_HUBS].sort());
  });

  it('uses the stand coordinates as the hub coordinates (YUL = Roméo-Vachon taxi basin)', () => {
    const yul = TAXI_HUBS.find((h) => h.id === 'mtl-yul');
    expect(yul?.stand?.code).toBe('5-35');
    expect(haversineKm(45.45603, -73.74668, yul?.latitude ?? 0, yul?.longitude ?? 0)).toBeLessThan(0.05);
  });

  it('only picks public/shared stands, except the airport (single official line)', () => {
    for (const h of TAXI_HUBS.filter((x) => x.stand && x.id !== 'mtl-yul')) {
      expect(h.stand?.kind).not.toBe('Privé');
    }
  });

  it('keeps the real zone id and score but navigates to the official stand', () => {
    const out = recommend(
      [zone('mtl-yul', 'aéroport', 45.4571, -73.7496, 'Aéroport Trudeau (YUL)')],
      { 'mtl-yul': 96 },
      [],
      { latitude: 45.47, longitude: -73.74 }
    );
    const yul = out.find((z) => z.id === 'mtl-yul');
    expect(yul?.score).toBe(96);
    expect(yul?.latitude).toBe(45.45603);
    expect(yul?.longitude).toBe(-73.74668);
    expect(out.filter((z) => z.type === 'aéroport')).toHaveLength(1);
  });

  it('leaves a real zone without an official stand on its own coordinates', () => {
    const out = recommend(
      [zone('lvl-mm', 'métro', 45.5584, -73.7215, 'Station Montmorency')],
      { 'lvl-mm': 57 },
      [],
      { latitude: 45.55, longitude: -73.72 }
    );
    const mm = out.find((z) => z.id === 'lvl-mm');
    expect(mm?.latitude).toBe(45.5584);
    expect(mm?.longitude).toBe(-73.7215);
  });
});
