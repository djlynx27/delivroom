import { describe, expect, it } from 'vitest';
import { buildProspectingSteps } from '@/services/routing/prospectingSteps';
import type { RouteCandidateZone } from '@/services/routing';

const origin = { lat: 45.6, lng: -73.7 };
const destination: RouteCandidateZone = {
  id: 'dest',
  name: 'Destination',
  latitude: 45.4,
  longitude: -73.7,
  score: 0,
};
const hub = (id: string, lat: number, score: number): RouteCandidateZone => ({
  id,
  name: id,
  latitude: lat,
  longitude: -73.7,
  score,
  type: 'transport',
});

describe('buildProspectingSteps', () => {
  it('orders hot hubs along the route and ends on the destination, one single-destination URL each', () => {
    const steps = buildProspectingSteps(origin, destination, [hub('b', 45.45, 80), hub('a', 45.55, 90)]);
    expect(steps.map((s) => s.zone.id)).toEqual(['a', 'b', 'dest']);
    expect(steps.map((s) => s.isDestination)).toEqual([false, false, true]);
    for (const s of steps) {
      expect(s.url).toContain(`destination=${s.zone.latitude},${s.zone.longitude}`);
      expect(s.url).not.toContain('waypoints');
      expect(s.url).not.toContain('origin=');
    }
  });

  it('falls back to the direct destination when no hub qualifies', () => {
    const steps = buildProspectingSteps(origin, destination, [hub('cold', 45.5, 10)]);
    expect(steps.map((s) => s.zone.id)).toEqual(['dest']);
  });
});
