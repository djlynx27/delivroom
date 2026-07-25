import { getGoogleMapsNavUrl, getWazeNavUrl } from '@/lib/hotspots';
import { describe, expect, it } from 'vitest';

// Contract: the nav helpers ignore the name (kept for call-site readability)
// and build the URL from the coordinates the caller supplies. Callers pass the
// hotspot/zone lat-lng directly, so no name-based lookup happens here.
describe('getGoogleMapsNavUrl', () => {
  it('builds a valid Google Maps direction URL from the given coordinates', () => {
    const url = getGoogleMapsNavUrl('Centre Bell', 45.4961, -73.5693);
    expect(url).toContain('https://www.google.com/maps/dir/');
    expect(url).toContain('travelmode=driving');
    expect(url).toContain('destination=45.4961,-73.5693');
  });

  it('uses whatever coordinates it is given', () => {
    const url = getGoogleMapsNavUrl('Unknown Zone', 45.5, -73.5);
    expect(url).toContain('45.5');
    expect(url).toContain('-73.5');
  });
});

describe('getWazeNavUrl', () => {
  it('builds a valid Waze navigation URL from the given coordinates', () => {
    const url = getWazeNavUrl('Centre Bell', 45.4961, -73.5693);
    expect(url).toContain('https://waze.com/ul');
    expect(url).toContain('navigate=yes');
    expect(url).toContain('ll=45.4961,-73.5693');
  });

  it('uses whatever coordinates it is given', () => {
    const url = getWazeNavUrl('Unknown', 45.5, -73.5);
    expect(url).toContain('45.5');
    expect(url).toContain('-73.5');
  });
});
