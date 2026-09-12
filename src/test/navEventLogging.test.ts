import type { RouteCandidateZone } from '@/services/routing/types';
import { describe, expect, it, vi, beforeEach } from 'vitest';

const mockGetUser = vi.hoisted(() => vi.fn());
const mockInsert = vi.hoisted(() => vi.fn());
const mockFrom = vi.hoisted(() => vi.fn());

vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    auth: { getUser: mockGetUser },
    from: mockFrom,
  },
}));

const { logNavEvent, handleNavigationLaunch } = await import('@/services/routing');

const destination: RouteCandidateZone = {
  id: 'carrefour-laval',
  name: 'Carrefour Laval',
  latitude: 45.575,
  longitude: -73.75,
  score: 90,
};
const origin = { lat: 45.51, lng: -73.57 };

describe('logNavEvent', () => {
  beforeEach(() => {
    mockGetUser.mockReset().mockResolvedValue({ data: { user: { id: 'driver-1' } }, error: null });
    mockInsert.mockReset().mockResolvedValue({ error: null });
    mockFrom.mockReset().mockReturnValue({ insert: mockInsert });
  });

  it('inserts a nav_events row with driver id, mode, origin/dest coordinates', async () => {
    logNavEvent(origin, destination, 'prospection');
    await vi.waitFor(() => expect(mockInsert).toHaveBeenCalledTimes(1));

    expect(mockFrom).toHaveBeenCalledWith('nav_events');
    expect(mockInsert).toHaveBeenCalledWith(
      expect.objectContaining({
        driver_id: 'driver-1',
        mode: 'prospection',
        origin_lat: origin.lat,
        origin_lng: origin.lng,
        dest_lat: destination.latitude,
        dest_lng: destination.longitude,
        dest_zone_id: destination.id,
        dest_label: destination.name,
      })
    );
  });

  it('never throws when there is no signed-in user', async () => {
    mockGetUser.mockResolvedValue({ data: { user: null }, error: null });

    expect(() => logNavEvent(origin, destination, 'direct')).not.toThrow();
    await vi.waitFor(() => expect(mockGetUser).toHaveBeenCalled());
    expect(mockInsert).not.toHaveBeenCalled();
  });

  it('never throws when the insert rejects', async () => {
    mockInsert.mockRejectedValue(new Error('network down'));

    expect(() => logNavEvent(origin, destination, 'direct')).not.toThrow();
    await vi.waitFor(() => expect(mockInsert).toHaveBeenCalled());
  });

  it('handleNavigationLaunch triggers a nav_events insert as a side effect', async () => {
    handleNavigationLaunch(origin, destination, [], 'direct');
    await vi.waitFor(() => expect(mockInsert).toHaveBeenCalledTimes(1));
  });
});
