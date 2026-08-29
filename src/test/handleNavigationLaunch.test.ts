import { handleNavigationLaunch } from '@/services/routing';
import type { RouteCandidateZone } from '@/services/routing/types';
import { describe, expect, it } from 'vitest';

const destination: RouteCandidateZone = {
  id: 'carrefour-laval',
  name: 'Carrefour Laval',
  latitude: 45.575,
  longitude: -73.75,
  score: 90,
};

const origin = { lat: 45.51, lng: -73.57 };
const candidates: RouteCandidateZone[] = [
  { id: 'z1', name: 'Zone chaude', latitude: 45.54, longitude: -73.66, score: 80 },
];

describe('handleNavigationLaunch', () => {
  it("mode 'direct' never injects waypoints, even when hub candidates are on the corridor", () => {
    const url = handleNavigationLaunch(origin, destination, candidates, 'direct');

    expect(url).toContain('origin=45.51%2C-73.57');
    expect(url).toContain('destination=45.575%2C-73.75');
    expect(url).not.toContain('waypoints=');
  });

  it("mode 'direct' falls back to a plain destination link with no GPS fix", () => {
    const url = handleNavigationLaunch(null, destination, candidates, 'direct');

    expect(url).not.toContain('waypoints=');
    expect(url).not.toContain('origin=');
    expect(url).toContain('45.575');
  });

  it("mode 'prospection' keeps the existing corridor-waypoint behavior", () => {
    const url = handleNavigationLaunch(origin, destination, candidates, 'prospection');

    expect(url).toContain('waypoints=');
  });
});
