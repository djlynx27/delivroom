import type { Zone } from '@/hooks/useSupabase';

/**
 * Lab-only Québec holiday calendar -> demand multiplier. Pure, no I/O.
 * Multipliers are ESTIMATED (no historical data yet): tune after real shifts.
 * School breaks are not modelled (no source of dates in the codebase).
 */

export type HolidayLevel = 'major' | 'minor' | 'eve';

export interface HolidayInfo {
  name: string;
  level: HolidayLevel;
  /** The holiday itself, or the day before one ("eve"). */
  isEve: boolean;
}

// Multiplier on business-driven hubs (office / medical clinics / commerce).
const BUSINESS_MULTIPLIER: Record<HolidayLevel, number> = {
  major: 0.55,
  minor: 0.75,
  eve: 0.9,
};

// Zone types whose demand comes from workday flows. Airport, tourism and
// events keep their score: they don't depend on offices being open.
const BUSINESS_ZONE_TYPES: readonly string[] = ['transport', 'médical', 'commercial'];

const TORONTO_YMD = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'America/Toronto',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

/** Gregorian Easter Sunday (anonymous / Meeus algorithm) as UTC-noon date. */
function easterSunday(year: number): Date {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(Date.UTC(year, month - 1, day, 12));
}

const addDays = (d: Date, n: number): Date => new Date(d.getTime() + n * 86_400_000);
const key = (d: Date): string => d.toISOString().slice(0, 10);

/** n-th (1-based) Monday of a month. */
function nthMonday(year: number, month: number, n: number): Date {
  const first = new Date(Date.UTC(year, month - 1, 1, 12));
  const offset = (8 - first.getUTCDay()) % 7;
  return addDays(first, offset + 7 * (n - 1));
}

/** Monday strictly before May 25 (Journée nationale des patriotes). */
function patriotesDay(year: number): Date {
  const may25 = new Date(Date.UTC(year, 4, 25, 12));
  return addDays(may25, -(((may25.getUTCDay() + 6) % 7) || 7));
}

function holidaysOf(year: number): Map<string, { name: string; level: HolidayLevel }> {
  const easter = easterSunday(year);
  const entries: Array<[Date, string, HolidayLevel]> = [
    [new Date(Date.UTC(year, 0, 1, 12)), "Jour de l'An", 'major'],
    [new Date(Date.UTC(year, 0, 2, 12)), "Lendemain du Jour de l'An", 'minor'],
    [addDays(easter, -2), 'Vendredi saint', 'major'],
    [addDays(easter, 1), 'Lundi de Pâques', 'minor'],
    [patriotesDay(year), 'Journée nationale des patriotes', 'major'],
    [new Date(Date.UTC(year, 5, 24, 12)), 'Fête nationale', 'major'],
    [new Date(Date.UTC(year, 6, 1, 12)), 'Fête du Canada', 'major'],
    [nthMonday(year, 9, 1), 'Fête du travail', 'major'],
    [nthMonday(year, 10, 2), 'Action de grâce', 'major'],
    [new Date(Date.UTC(year, 11, 25, 12)), 'Noël', 'major'],
    [new Date(Date.UTC(year, 11, 26, 12)), 'Lendemain de Noël', 'minor'],
  ];
  return new Map(entries.map(([d, name, level]) => [key(d), { name, level }]));
}

/** Holiday (or eve of one) for the Toronto calendar day of `date`; weekdays only. */
export function getHoliday(date: Date): HolidayInfo | null {
  const ymd = TORONTO_YMD.format(date); // yyyy-mm-dd
  const day = new Date(`${ymd}T12:00:00Z`);
  const dow = day.getUTCDay();
  if (dow === 0 || dow === 6) return null; // weekend: offices already closed

  const year = day.getUTCFullYear();
  const table = new Map([...holidaysOf(year), ...holidaysOf(year + 1)]);
  const today = table.get(ymd);
  if (today) return { ...today, isEve: false };

  // Friday's "eve" is the Monday holiday of a long weekend.
  const tomorrow = table.get(key(addDays(day, dow === 5 ? 3 : 1)));
  if (tomorrow && tomorrow.level === 'major') {
    return { name: `Veille — ${tomorrow.name}`, level: 'eve', isEve: true };
  }
  return null;
}

/** Score multiplier for business-driven hubs (1 = no effect). */
export function getHolidayDemandMultiplier(date: Date): number {
  const h = getHoliday(date);
  return h ? BUSINESS_MULTIPLIER[h.level] : 1;
}

/** Multiplier for one zone type: only workday-driven types are reduced. */
export function holidayMultiplierForType(type: Zone['type'], date: Date): number {
  return BUSINESS_ZONE_TYPES.includes(type) ? getHolidayDemandMultiplier(date) : 1;
}
