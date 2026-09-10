import { MaxymoCsvImporter } from '@/components/MaxymoCsvImporter';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockGetUser = vi.hoisted(() => vi.fn());
const mockInvoke = vi.hoisted(() => vi.fn());
const mockTripsRawInsert = vi.hoisted(() => vi.fn());
const mockTripsInsert = vi.hoisted(() => vi.fn());
const mockFrom = vi.hoisted(() => vi.fn());

vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    auth: { getUser: mockGetUser },
    functions: { invoke: mockInvoke },
    from: mockFrom,
  },
}));

function renderImporter() {
  const queryClient = new QueryClient();
  return render(
    <QueryClientProvider client={queryClient}>
      <MaxymoCsvImporter />
    </QueryClientProvider>
  );
}

const CSV =
  'Pickup Distance,Pickup Time,Trip Distance,Drive Time,Status,Fare\n' +
  '2.3 mi,3 min,4.1 mi,12 min,Completed,18.50\n' +
  '6 mi,5 min,,,Declined,\n';

function dropCsv(text: string) {
  const file = new File([text], 'maxymo-offers.csv', { type: 'text/csv' });
  const dropzone = screen.getByTestId('maxymo-csv-dropzone');
  fireEvent.drop(dropzone, { dataTransfer: { files: [file] } });
}

describe('MaxymoCsvImporter', () => {
  beforeEach(() => {
    mockGetUser.mockReset().mockResolvedValue({
      data: { user: { id: 'user-1' } },
      error: null,
    });
    mockInvoke.mockReset().mockResolvedValue({ data: null, error: null });
    mockTripsRawInsert.mockReset().mockResolvedValue({ error: null });
    mockTripsInsert.mockReset().mockResolvedValue({ error: null });
    mockFrom.mockReset().mockImplementation((table: string) => ({
      insert: table === 'trips_raw' ? mockTripsRawInsert : mockTripsInsert,
    }));
  });

  it('shows an empty state with no file loaded', () => {
    renderImporter();
    expect(screen.getByText(/Aucun fichier chargé/)).toBeInTheDocument();
  });

  it('previews total/accepted/rejected counts and average deadhead km after parsing', async () => {
    renderImporter();
    dropCsv(CSV);

    expect(await screen.findByText('2 offres')).toBeInTheDocument();
    expect(screen.getByText('1 acceptées')).toBeInTheDocument();
    expect(screen.getByText('1 refusées')).toBeInTheDocument();
    // avg of 3.7 km (2.3 mi) and 9.7 km (6 mi) = 6.7
    expect(screen.getByText('6.7 km à vide en moyenne')).toBeInTheDocument();
    expect(
      screen.getByText(/le moteur pénalisera/)
    ).toBeInTheDocument();
  });

  it('imports the accepted offer into trips and archives every offer into trips_raw, then retrains', async () => {
    renderImporter();
    dropCsv(CSV);
    await screen.findByText('2 offres');

    fireEvent.click(screen.getByRole('button', { name: /Importer 2 offre/ }));

    await waitFor(() => expect(mockTripsRawInsert).toHaveBeenCalledTimes(1));
    expect(mockTripsRawInsert.mock.calls[0]?.[0]).toHaveLength(2);

    await waitFor(() => expect(mockTripsInsert).toHaveBeenCalledTimes(1));
    const savedTrips = mockTripsInsert.mock.calls[0]?.[0] as Array<{ earnings: number | null }>;
    expect(savedTrips).toHaveLength(1);
    expect(savedTrips[0]?.earnings).toBe(18.5);

    await waitFor(() => expect(mockInvoke).toHaveBeenCalledWith('score-calculator'));
    expect(await screen.findByText(/1 course\(s\) sauvegardée/)).toBeInTheDocument();
  });
});
