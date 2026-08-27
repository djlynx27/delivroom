const MONTREAL_TZ = 'America/Toronto';

function getTzOffsetMs(date: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(date);
  const get = (type: string) =>
    Number(parts.find((p) => p.type === type)?.value ?? 0);
  // Read the tz's wall-clock numbers for `date`, then re-interpret them as
  // UTC -- the gap between that and the real instant is exactly the tz's
  // current UTC offset (DST-aware, since Intl resolves it for this date).
  const asUtc = Date.UTC(
    get('year'),
    get('month') - 1,
    get('day'),
    get('hour'),
    get('minute'),
    get('second')
  );
  return asUtc - date.getTime();
}

/**
 * Midnight "today" as it reads on a clock in Montreal, regardless of the
 * device's own timezone (roaming, a misconfigured system clock, etc.) --
 * the driver's day always starts on Eastern time, not wherever the phone
 * thinks it is.
 */
export function getMontrealDayStart(now = new Date()): Date {
  const offsetMs = getTzOffsetMs(now, MONTREAL_TZ);
  const shifted = new Date(now.getTime() + offsetMs);
  const startOfShiftedDayUtc = Date.UTC(
    shifted.getUTCFullYear(),
    shifted.getUTCMonth(),
    shifted.getUTCDate()
  );
  return new Date(startOfShiftedDayUtc - offsetMs);
}
