import { describe, expect, it } from 'vitest';
import type { Zone } from '@/hooks/useSupabase';
import { findNearestZone, rankByProximityPenalizedScore } from '@/lib/zoneMatch';

function zone(id: string, latitude: number, longitude: number): Zone {
  return { id, latitude, longitude } as unknown as Zone;
}

describe('findNearestZone', () => {
  const zones = [
    zone('mtl-downtown', 45.5017, -73.5673),
    zone('lvl-chomedey', 45.5581, -73.7442),
    zone('lng-brossard', 45.4585, -73.4659),
  ];

  it('picks the closest zone to a point', () => {
    expect(findNearestZone(45.5019, -73.567, zones)?.id).toBe('mtl-downtown');
  });

  it('returns null when the nearest zone is still outside the metro radius', () => {
    // Quebec City — ~230 km away, beyond MAX_GPS_ZONE_KM. A mis-geocoded
    // event out here must not point a "positionne-toi près de X" push
    // notification at a zone that's actually hours away.
    expect(findNearestZone(46.8139, -71.208, zones)).toBeNull();
  });
});

describe('rankByProximityPenalizedScore', () => {
  // Real coordinates and current_score values pulled from production
  // (Supabase `zones` table) reproducing the 2026-09-16 regression: from
  // Saint-Léonard (Lacordaire & Jean-Talon, 45.5880/-73.5890), the hero
  // card suggested Terminus Longueuil (score 100, 8.8km away) and Station
  // Montmorency (score 86, 10.8km away) over Galeries d'Anjou (score 68,
  // only 2.4km away) — a raw-score sort with only an outer distance cutoff
  // let a much farther zone win on score alone.
  const origin = { lat: 45.588, lng: -73.589 };
  const anjou = { id: 'mtl-anjou', latitude: 45.599762, longitude: -73.563115, score: 68 };
  const terminusLongueuil = { id: 'lng-tl', latitude: 45.5243, longitude: -73.5215, score: 100 };
  const montmorency = { id: 'lvl-mm', latitude: 45.558353, longitude: -73.721518, score: 86 };

  it('rejects Longueuil/Laval zones ~9-11km away in favor of the ~2.4km Montreal neighbor', () => {
    const ranked = rankByProximityPenalizedScore(origin.lat, origin.lng, [
      anjou,
      terminusLongueuil,
      montmorency,
    ]);

    expect(ranked.map((z) => z.id)).toEqual(['mtl-anjou']);
  });

  it('still lets a much busier zone win once it is close enough to be in range', () => {
    // Same score gap as Anjou (68) vs Terminus Longueuil (100), but at
    // 5km instead of 8.8km — within MAX_HERO_ZONE_DISTANCE_KM (7km) and
    // the penalty (3/km => 15 pts) doesn't erase a 32-point score edge.
    const nearbyBusyZone = { id: 'busy-5km', latitude: 45.5895, longitude: -73.531, score: 100 };
    const ranked = rankByProximityPenalizedScore(origin.lat, origin.lng, [anjou, nearbyBusyZone]);

    expect(ranked[0]?.id).toBe('busy-5km');
  });

  it('breaks ties by distance when scores are equal (e.g. scores not loaded yet, all default to 0)', () => {
    const closer = { id: 'closer', latitude: 45.599762, longitude: -73.563115, score: 0 };
    const farther = { id: 'farther', latitude: 45.6, longitude: -73.5, score: 0 };
    const ranked = rankByProximityPenalizedScore(origin.lat, origin.lng, [farther, closer]);

    expect(ranked[0]?.id).toBe('closer');
  });
});
