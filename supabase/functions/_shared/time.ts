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
