import { describe, expect, it } from 'vitest';
import type { Zone } from '@/hooks/useSupabase';
import { findNearestZone } from '@/hooks/useNotifications';

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
