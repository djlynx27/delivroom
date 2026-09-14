import AdminZoneDiscoveriesScreen from '@/pages/AdminZoneDiscoveriesScreen';
import { MIN_OCCURRENCES_FOR_AUTO_PROMOTION } from '@/lib/zonePromotion';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockSelect = vi.hoisted(() => vi.fn());
const mockRpc = vi.hoisted(() => vi.fn());
const mockInvoke = vi.hoisted(() => vi.fn());
const mockFrom = vi.hoisted(() => vi.fn());

vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    from: mockFrom,
    rpc: mockRpc,
    functions: { invoke: mockInvoke },
  },
}));

function renderScreen() {
  const queryClient = new QueryClient();
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <AdminZoneDiscoveriesScreen />
      </MemoryRouter>
    </QueryClientProvider>
  );
}

describe('AdminZoneDiscoveriesScreen — zero-touch auto-promotion', () => {
  beforeEach(() => {
    mockInvoke.mockReset().mockResolvedValue({ data: null, error: null });
    mockSelect.mockReset();
    mockFrom.mockReset().mockImplementation((table: string) => {
      if (table === 'zone_discoveries') {
        return {
          select: () => ({
            order: () => ({
              order: () => ({
                limit: () =>
                  Promise.resolve({
                    data: [
                      {
                        id: 'd1',
                        address: '123 Rue Test',
                        context: 'pickup',
                        city_hint: 'mtl',
                        count: MIN_OCCURRENCES_FOR_AUTO_PROMOTION,
                        first_seen_at: '2026-01-01',
                        last_seen_at: '2026-01-02',
                        status: 'pending',
                        promoted_zone_id: null,
                      },
                    ],
                    error: null,
                  }),
              }),
            }),
          }),
        };
      }
      return { select: () => ({ in: () => Promise.resolve({ data: [], error: null }) }) };
    });
    mockRpc.mockReset().mockImplementation((fn: string) => {
      if (fn === 'get_major_zone_benchmark') {
        return Promise.resolve({ data: [{ avg_per_km: 1.5, avg_per_h: 30 }], error: null });
      }
      if (fn === 'get_discovery_performance') {
        // Below the real-trip sample threshold — stays "rejected", so the
        // test only needs to prove the automatic pass RAN, not that it
        // reached the geocode/promote-discovery calls too.
        return Promise.resolve({ data: [{ sample_size: 0, avg_per_km: null, avg_per_h: null }], error: null });
      }
      return Promise.resolve({ data: null, error: null });
    });
  });

  it('runs the auto-promotion pass on mount without a manual button click', async () => {
    renderScreen();

    await waitFor(() =>
      expect(mockRpc).toHaveBeenCalledWith('get_major_zone_benchmark', { p_top_n: 5 })
    );
    await waitFor(() =>
      expect(mockRpc).toHaveBeenCalledWith('get_discovery_performance', { p_address: '123 Rue Test' })
    );
  });
});
