// America/Toronto local hour, DST-correct (EST is UTC-5, EDT is UTC-4).
// A fixed UTC offset is wrong for ~8 months/year (mid-March to early
// November) and skews every time-of-day factor by 1h during EDT.
export function montrealHour(now: Date): number {
  return Number(
    new Intl.DateTimeFormat('en-CA', {
      timeZone: 'America/Toronto',
      hour: 'numeric',
      hour12: false,
    }).format(now)
  ) % 24;
}

const WEEKDAY_INDEX: Record<string, number> = {
  Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6,
};

// America/Toronto local day-of-week (0=Sun..6=Sat), DST-correct. Deno Edge
// Functions run in UTC — now.getUTCDay()/getDay() attribute a 4-6h window
// near midnight Montreal time to the wrong calendar day every single day.
export function montrealDayOfWeek(now: Date): number {
  const weekday = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Toronto',
    weekday: 'short',
  }).format(now);
  return WEEKDAY_INDEX[weekday] ?? now.getUTCDay();
}
