import { buildOneTapNavigationUrl } from '@/services/routing';
import type { RouteCandidateZone } from '@/services/routing/types';
import { describe, expect, it } from 'vitest';

const destination: RouteCandidateZone = {
  id: 'carrefour-laval',
  name: 'Carrefour Laval',
  latitude: 45.575,
  longitude: -73.75,
  score: 90,
};

describe('buildOneTapNavigationUrl', () => {
  it('includes prospection waypoints when origin (GPS) is available', () => {
    const origin = { lat: 45.51, lng: -73.57 };
    const candidates: RouteCandidateZone[] = [
      { id: 'z1', name: 'Zone chaude', latitude: 45.54, longitude: -73.66, score: 80 },
    ];

    const url = buildOneTapNavigationUrl(origin, destination, candidates);

    expect(url).toContain('https://www.google.com/maps/dir/?');
    expect(url).toContain('origin=45.51%2C-73.57');
    expect(url).toContain('destination=45.575%2C-73.75');
    expect(url).toContain('waypoints=');
  });

  it('falls back to a plain destination link when GPS is not locked yet', () => {
    const url = buildOneTapNavigationUrl(null, destination, []);

    expect(url).not.toContain('waypoints=');
    expect(url).toContain('45.575');
    expect(url).toContain('-73.75');
  });
});
