import { MarketRadarSheet } from '@/components/drive/MarketRadarSheet';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const ZONES = [
  { id: 'z1', name: 'Gare Centrale', estimatedWaitMin: 7, driverCount: 3, isSaturated: false },
];

function open(hideWait?: boolean) {
  render(
    <MarketRadarSheet
      zones={ZONES}
      demandWindow="30m"
      onDemandWindowChange={vi.fn()}
      bestGasStation={null}
      hideWait={hideWait}
    />
  );
  fireEvent.click(screen.getByLabelText('Ouvrir Market Radar'));
}

afterEach(() => cleanup());

describe('MarketRadarSheet', () => {
  it('offers the Lyft wait view by default and opens on it', () => {
    open();
    expect(screen.getByText('Attente')).toBeInTheDocument();
    expect(screen.getByText(/~7 min/)).toBeInTheDocument();
  });

  it('hides the wait view in Lab and opens on saturation', () => {
    open(true);
    expect(screen.queryByText('Attente')).toBeNull();
    expect(screen.queryByText(/~7 min/)).toBeNull();
    expect(screen.getByText('Saturation')).toBeInTheDocument();
    expect(screen.getByText('Pit-Stops')).toBeInTheDocument();
  });
});
