import { TacticalSpotBadge } from '@/components/TacticalSpotBadge';
import type { MicroSpot } from '@/lib/spotter';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

const OFFSET_SPOT: MicroSpot = {
  latitude: 45.545,
  longitude: -73.738,
  quadrant: 'bottom_left',
  bearingDeg: 225,
  offsetMeters: 100,
  driverCountInQuadrant: 1,
};

describe('TacticalSpotBadge', () => {
  it('renders the offset distance, compass label, and singular driver count', () => {
    render(<TacticalSpotBadge spot={OFFSET_SPOT} />);
    expect(
      screen.getByText(/Spot d'interception — 100m S-O/)
    ).toBeInTheDocument();
    expect(screen.getByText(/1 concurrent évité/)).toBeInTheDocument();
  });

  it('pluralizes the driver count for more than one', () => {
    render(<TacticalSpotBadge spot={{ ...OFFSET_SPOT, driverCountInQuadrant: 3 }} />);
    expect(screen.getByText(/3 concurrents évités/)).toBeInTheDocument();
  });

  it('renders nothing when the spot has no actual offset (center already quietest)', () => {
    const { container } = render(
      <TacticalSpotBadge
        spot={{ ...OFFSET_SPOT, quadrant: 'center', bearingDeg: null, offsetMeters: 0 }}
      />
    );
    expect(container).toBeEmptyDOMElement();
  });
});
