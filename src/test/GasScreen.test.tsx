import { DetourBadge } from '@/components/DetourBadge';
import { computeDetourBadge, type RankedStation } from '@/lib/gasRanking';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

// Driver in Laval; station.lat/lng are the same coordinates used by
// gasRanking.test.ts's detour-profitability fixtures.
const DRIVER = { latitude: 45.57, longitude: -73.72 };

function station(overrides: Partial<RankedStation> = {}): RankedStation {
  return {
    name: 'Station Test',
    brand: 'Test',
    address: '1 rue Test, Laval',
    city: 'Laval',
    lat: 45.595,
    lng: -73.72,
    regular: 1.6,
    super: null,
    diesel: null,
    key: '45.59500,-73.72000',
    price: 1.6,
    distance_km: 2.78,
    cost_score: 1.6,
    cityKey: 'laval',
    ...overrides,
  };
}

describe('computeDetourBadge', () => {
  it('returns null with no GPS fix', () => {
    expect(computeDetourBadge(1.7, null, station())).toBeNull();
  });

  it('returns null with no baseline price yet', () => {
    expect(computeDetourBadge(null, DRIVER, station())).toBeNull();
  });

  it('returns null when the station is not actually cheaper than the default pick', () => {
    expect(computeDetourBadge(1.6, DRIVER, station({ price: 1.65 }))).toBeNull();
  });

  it('flags a nearby, meaningfully cheaper station as profitable', () => {
    const badge = computeDetourBadge(1.68, DRIVER, station({ price: 1.6 }));
    expect(badge?.isProfitable).toBe(true);
    expect(badge?.label).toMatch(/^Détour rentable/);
  });

  it('flags a distant, barely-cheaper station as not profitable', () => {
    const farStation = station({ price: 1.6, lat: 45.75, lng: -73.72 });
    const badge = computeDetourBadge(1.61, DRIVER, farStation);
    expect(badge?.isProfitable).toBe(false);
    expect(badge?.label).toMatch(/^Détour non rentable/);
  });
});

describe('DetourBadge', () => {
  it('renders a profitable badge with its label', () => {
    render(<DetourBadge badge={{ label: 'Détour rentable (+2.00$ net)', isProfitable: true }} />);
    expect(screen.getByText('Détour rentable (+2.00$ net)')).toBeInTheDocument();
  });

  it('renders a non-profitable badge with its label', () => {
    render(<DetourBadge badge={{ label: 'Détour non rentable (perte de 4.00$)', isProfitable: false }} />);
    expect(screen.getByText('Détour non rentable (perte de 4.00$)')).toBeInTheDocument();
  });
});
