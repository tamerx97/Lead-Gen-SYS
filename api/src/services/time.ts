/**
 * Timezone-aware period boundaries, so "today" in caps and reports means the
 * operator's day rather than the server's UTC day.
 */

function offsetMinutes(date: Date, timeZone: string): number {
  try {
    const fmt = new Intl.DateTimeFormat('en-US', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    });
    const parts = fmt.formatToParts(date);
    const get = (t: string) => Number(parts.find((p) => p.type === t)?.value);
    const asUtc = Date.UTC(
      get('year'),
      get('month') - 1,
      get('day'),
      get('hour') % 24,
      get('minute'),
      get('second')
    );
    return (asUtc - date.getTime()) / 60000;
  } catch {
    return 0;
  }
}

/** Wall-clock Y/M/D in `timeZone` for the given instant. */
export function localDateParts(date: Date, timeZone: string): { y: number; m: number; d: number } {
  const shifted = new Date(date.getTime() + offsetMinutes(date, timeZone) * 60000);
  return {
    y: shifted.getUTCFullYear(),
    m: shifted.getUTCMonth() + 1,
    d: shifted.getUTCDate(),
  };
}

/** The UTC instant at which the local day containing `date` began. */
export function startOfLocalDay(date: Date, timeZone: string): Date {
  const { y, m, d } = localDateParts(date, timeZone);
  const naive = Date.UTC(y, m - 1, d, 0, 0, 0);
  // Re-measure the offset at the candidate instant so DST transitions land right.
  const guess = new Date(naive - offsetMinutes(date, timeZone) * 60000);
  return new Date(naive - offsetMinutes(guess, timeZone) * 60000);
}

export function startOfLocalMonth(date: Date, timeZone: string): Date {
  const { y, m } = localDateParts(date, timeZone);
  const naive = Date.UTC(y, m - 1, 1, 0, 0, 0);
  const guess = new Date(naive - offsetMinutes(date, timeZone) * 60000);
  return new Date(naive - offsetMinutes(guess, timeZone) * 60000);
}

/** Inclusive list of local day keys ("YYYY-MM-DD") between two instants. */
export function localDayKeys(from: Date, to: Date, timeZone: string): string[] {
  const keys: string[] = [];
  let cursor = startOfLocalDay(from, timeZone);
  const limit = to.getTime();
  let guard = 0;
  while (cursor.getTime() <= limit && guard++ < 800) {
    keys.push(formatLocalDayKey(cursor, timeZone));
    cursor = startOfLocalDay(new Date(cursor.getTime() + 36 * 60 * 60 * 1000), timeZone);
  }
  return keys;
}

export function formatLocalDayKey(date: Date, timeZone: string): string {
  const { y, m, d } = localDateParts(date, timeZone);
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}
