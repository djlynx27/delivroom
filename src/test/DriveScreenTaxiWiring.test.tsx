import type { AppEvent } from '@/hooks/useEvents';
import type { Zone } from '@/hooks/useSupabase';
import DriveScreen from '@/pages/DriveScreen';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Wiring test: DriveScreen must consume lib/taxiMode in the Lab build (hubs +
// events only, no Lyft controls) and stay on the original ranking in the
// commercial build. Hooks and heavy children are stubbed; the real DriveScreen
// ranking, hero card and Lab gates run.

const mocks = vi.hoisted(() => ({
  lab: true,
  zones: [] as unknown[],
  scores: new Map<string, number>(),
  events: [] as unknown[],
  radarProps: [] as Array<{ hideWait?: boolean }>,
  // vi.mock factories are hoisted: build element stubs without top-level imports.
  stub: (name: string, label: string) => async () => {
    const { createElement } = await import('react');
    return { [name]: () => createElement('div', { 'data-testid': label }) };
  },
}));

vi.mock('@/lib/env', async (orig) => ({
  ...(await orig<typeof import('@/lib/env')>()),
  isLabBuild: () => mocks.lab,
  isCommercialBuild: () => !mocks.lab,
}));

vi.mock('@/hooks/useUserLocation', async (orig) => ({
  ...(await orig<typeof import('@/hooks/useUserLocation')>()),
  useUserLocation: () => ({
    location: { latitude: 45.5017, longitude: -73.5673, accuracy: 10 },
    status: 'granted',
    error: null,
    refresh: vi.fn(),
    isLocationLive: true,
  }),
  useHasPreciseFix: () => true,
}));

vi.mock('@/hooks/useDemandScores', () => ({
  useDemandScores: () => ({
    scores: mocks.scores,
    factors: new Map(),
    zones: mocks.zones,
    isLoading: false,
    weather: null,
    endingSoon: [],
    startingSoon: [],
    surgeMap: new Map(),
    zoneEventBadge: new Map(),
    lyftSignalByZone: new Map(),
    isLyftSyncing: false,
    hasLiveScores: true,
  }),
}));

vi.mock('@/hooks/useEvents', async (orig) => ({
  ...(await orig<typeof import('@/hooks/useEvents')>()),
  useEvents: () => ({ data: mocks.events }),
}));

vi.mock('@/lib/realtime', async (orig) => ({
  ...(await orig<typeof import('@/lib/realtime')>()),
  useNearbyDrivers: () => ({ driversByZone: new Map(), saturatedZoneIds: new Set() }),
}));

vi.mock('@/contexts/I18nContext', () => ({ useI18n: () => ({ t: (k: string) => k }) }));
vi.mock('@/hooks/useCityId', () => ({ useCityId: () => ['mtl', vi.fn()] as const }));
vi.mock('@/hooks/useSupabase', () => ({ useCities: () => ({ data: [] }) }));
vi.mock('@/hooks/useAutoCity', () => ({ nearestCityId: () => 'mtl', useAutoCity: () => undefined }));
vi.mock('@/hooks/useEmergingHotspots', () => ({
  useEmergingHotspots: () => ({ data: [] }),
  nearestEmergingHotspot: () => null,
}));
vi.mock('@/hooks/useNotifications', () => ({
  useNotifications: () => ({ enabled: false, requestPermission: vi.fn() }),
}));
vi.mock('@/hooks/useNavTrustState', () => ({
  useNavTrustState: () => ({ canNavigate: true, badge: null }),
}));
vi.mock('@/hooks/useGasBoard', () => ({ useGasBoard: () => ({ board: null }) }));
vi.mock('@/hooks/useHaptics', () => ({ useHaptics: () => ({ vibrate: vi.fn() }) }));
vi.mock('@/hooks/useActivityDetection', () => ({
  useActivityDetection: () => ({ isInVehicle: false, speedKmh: 0 }),
}));
vi.mock('@/hooks/useAntiDeadhead', () => ({ useAntiDeadhead: () => null }));
vi.mock('@/hooks/useArrivalCountdown', () => ({
  useArrivalCountdown: () => ({
    isCountingDown: false,
    arrivedZoneName: null,
    secondsRemaining: 0,
    cancel: vi.fn(),
    launchNow: vi.fn(),
  }),
}));
vi.mock('@/hooks/usePullToRefresh', () => ({ usePullToRefresh: () => undefined }));
vi.mock('@/hooks/useTrips', () => ({ useTrips: () => ({ data: [], isLoading: false }) }));
vi.mock('@capacitor/preferences', () => ({ Preferences: { set: vi.fn(), get: vi.fn() } }));
vi.mock('@/lib/shiftGeoWatcher', () => ({ PREFS_HERO_ZONE_KEY: 'hero-zone' }));

vi.mock('@/components/ArrivalCountdown', mocks.stub('ArrivalCountdown', 'arrival'));
vi.mock('@/components/CitySelect', mocks.stub('CitySelect', 'city'));
vi.mock('@/components/drive/AddressSearchBox', mocks.stub('AddressSearchBox', 'address'));
vi.mock('@/components/drive/AntiDeadheadCard', mocks.stub('AntiDeadheadCard', 'anti'));
vi.mock('@/components/DeadTimeTimer', mocks.stub('DeadTimeTimer', 'dead'));
vi.mock('@/components/DrivingHUD', mocks.stub('DrivingHUD', 'hud'));
vi.mock('@/components/CustomNavigationMap', mocks.stub('CustomNavigationMap', 'map'));
vi.mock('@/components/QuickDecideWidget', mocks.stub('QuickDecideWidget', 'quick'));
vi.mock('@/components/ShiftTally', mocks.stub('ShiftTally', 'tally'));
vi.mock('@/components/WeeklyGoal', mocks.stub('WeeklyGoalDisplay', 'goal'));
vi.mock('@/components/OfflineBadge', mocks.stub('OfflineBadge', 'offline'));
vi.mock('@/components/PlatformArbitrage', mocks.stub('PlatformArbitrage', 'platform-arbitrage'));
vi.mock('@/components/PlatformSwitchBanner', mocks.stub('PlatformSwitchBanner', 'platform-switch-banner'));
vi.mock('@/components/drive/MarketRadarSheet', async () => {
  const { createElement } = await import('react');
  return {
    MarketRadarSheet: (props: { hideWait?: boolean }) => {
      mocks.radarProps.push({ hideWait: props.hideWait });
      return createElement('div', { 'data-testid': 'radar' });
    },
  };
});

const NOW = Date.now();

function zone(id: string, name: string, type: string, lat: number, lng: number): Zone {
  return {
    id,
    name,
    type,
    latitude: lat,
    longitude: lng,
    city_id: 'mtl',
    current_score: 50,
    base_score: 50,
  } as unknown as Zone;
}

function activeEvent(): AppEvent {
  return {
    id: 'ev-bell',
    name: 'Match Canadiens',
    venue: 'Centre Bell',
    city_id: 'mtl',
    latitude: 45.4961,
    longitude: -73.5693,
    start_at: new Date(NOW - 60 * 60_000).toISOString(),
    end_at: new Date(NOW + 2 * 60 * 60_000).toISOString(),
    capacity: 21000,
    demand_impact: 5,
    boost_multiplier: 1.15,
    boost_radius_km: 1,
    boost_zone_types: [],
    category: 'sport',
    is_holiday: false,
  };
}

beforeEach(() => {
  localStorage.clear();
  mocks.radarProps.length = 0;
  // A generic zone that dominates by raw score + a taxi hub with a lower score.
  mocks.zones = [
    zone('res-top', 'Résidentiel Top Score', 'résidentiel', 45.505, -73.6),
    zone('mtl-gc', 'Gare Centrale', 'transport', 45.5003, -73.5672),
  ];
  mocks.scores = new Map([
    ['res-top', 99],
    ['mtl-gc', 60],
  ]);
  mocks.events = [activeEvent()];
});

afterEach(() => cleanup());

describe('DriveScreen — Lab build consumes taxi mode', () => {
  beforeEach(() => {
    mocks.lab = true;
  });

  it('ranks the in-progress event first and never lists a generic zone', () => {
    render(<DriveScreen />);
    expect(screen.getAllByText(/Centre Bell/).length).toBeGreaterThan(0);
    expect(screen.queryByText(/Résidentiel Top Score/)).toBeNull();
  });

  it('shows the event badge on the hero card', () => {
    render(<DriveScreen />);
    expect(screen.getAllByText(/Match Canadiens/).length).toBeGreaterThan(0);
  });

  it('hides every Lyft / rideshare control', () => {
    render(<DriveScreen />);
    expect(screen.queryByTestId('platform-switch-banner')).toBeNull();
    expect(screen.queryByTestId('platform-arbitrage')).toBeNull();
    expect(screen.queryByText(/Présence prudente Lyft/)).toBeNull();
    expect(screen.queryByText(/Personnes/)).toBeNull();
    expect(screen.queryByText(/Livraison/)).toBeNull();
  });

  it('ignores the "Présence prudente Lyft" preference (ACTIVE by default in storage)', () => {
    localStorage.setItem('delivroom_conservative_presence', 'true');
    render(<DriveScreen />);
    expect(screen.queryByText(/Où rester visible/)).toBeNull();
  });

  it('asks the radar to drop the Lyft wait view', () => {
    render(<DriveScreen />);
    expect(mocks.radarProps.at(-1)?.hideWait).toBe(true);
  });
});

describe('DriveScreen — commercial build is unchanged', () => {
  beforeEach(() => {
    mocks.lab = false;
  });

  it('keeps the original score ranking (generic zone shown) and the Lyft controls', () => {
    render(<DriveScreen />);
    expect(screen.getAllByText(/Résidentiel Top Score/).length).toBeGreaterThan(0);
    expect(screen.getByTestId('platform-switch-banner')).toBeInTheDocument();
    expect(screen.getByText(/Présence prudente Lyft/)).toBeInTheDocument();
    expect(mocks.radarProps.at(-1)?.hideWait).toBe(false);
  });
});
