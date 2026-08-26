import { useQuery } from '@tanstack/react-query';

const HOLIDAYS_URL = '/api/holidays';

interface Holiday {
  id: number;
  date: string;
  nameEn: string;
  nameFr: string;
}

interface HolidayResult {
  isHoliday: boolean;
  name: string | null;
}

export function useHoliday(date: string): {
  data: HolidayResult | undefined;
  isLoading: boolean;
} {
  return useQuery<HolidayResult>({
    queryKey: ['holiday', date],
    queryFn: async ({ signal }) => {
      try {
        const year = date.split('-')[0];
        const res = await fetch(`${HOLIDAYS_URL}?year=${year}`, { signal });
        if (!res.ok) return { isHoliday: false, name: null };
        const json = await res.json();
        const holidays: Holiday[] = json.holidays ?? [];
        const match = holidays.find((h) => h.date === date);
        return {
          isHoliday: !!match,
          name: match?.nameFr ?? match?.nameEn ?? null,
        };
      } catch {
        return { isHoliday: false, name: null };
      }
    },
    staleTime: 24 * 60 * 60 * 1000,
  });
}
