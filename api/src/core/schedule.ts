import type { Schedule } from './types';

const TIME_RE = /^([01]?\d|2[0-3]):([0-5]\d)$/;

export function parseSchedule(raw: unknown): Schedule {
  let value = raw;
  if (typeof value === 'string') {
    try {
      value = JSON.parse(value);
    } catch {
      return {};
    }
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const s = value as Schedule;
  const days = Array.isArray(s.days)
    ? s.days.map(Number).filter((d) => Number.isInteger(d) && d >= 1 && d <= 7)
    : undefined;
  return {
    days: days && days.length ? days : undefined,
    start: typeof s.start === 'string' && TIME_RE.test(s.start) ? s.start : undefined,
    end: typeof s.end === 'string' && TIME_RE.test(s.end) ? s.end : undefined,
  };
}

function minutesOfDay(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
}

/**
 * Read wall-clock weekday/minute for `date` in `timezone` without pulling in a
 * date library. Falls back to the host clock if the timezone is unusable.
 */
export function localParts(date: Date, timezone?: string): { day: number; minutes: number } {
  if (!timezone) {
    return { day: isoWeekday(date.getDay()), minutes: date.getHours() * 60 + date.getMinutes() };
  }
  try {
    const fmt = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      weekday: 'short',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    });
    const parts = fmt.formatToParts(date);
    const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
    const weekdayMap: Record<string, number> = {
      Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7,
    };
    const day = weekdayMap[get('weekday')] ?? isoWeekday(date.getDay());
    // Intl can emit "24" for midnight in some ICU versions.
    const hour = Number(get('hour')) % 24;
    const minute = Number(get('minute'));
    return { day, minutes: hour * 60 + minute };
  } catch {
    return { day: isoWeekday(date.getDay()), minutes: date.getHours() * 60 + date.getMinutes() };
  }
}

function isoWeekday(jsDay: number): number {
  // JS: 0 = Sunday. ISO: 7 = Sunday.
  return jsDay === 0 ? 7 : jsDay;
}

/**
 * Is `now` inside the campaign's dayparting window?
 *
 * An empty schedule is 24/7. A window whose `end` is before its `start` wraps
 * past midnight (e.g. 20:00 → 02:00), and the weekday is matched against the
 * day the window *started* on.
 */
export function isWithinSchedule(schedule: Schedule, now: Date, timezone?: string): boolean {
  const s = parseSchedule(schedule);
  const hasDays = !!s.days && s.days.length > 0;
  const hasWindow = !!s.start && !!s.end;
  if (!hasDays && !hasWindow) return true;

  const { day, minutes } = localParts(now, timezone);

  if (!hasWindow) return s.days!.includes(day);

  const start = minutesOfDay(s.start!);
  const end = minutesOfDay(s.end!);

  if (start <= end) {
    const inWindow = minutes >= start && minutes < end;
    if (!inWindow) return false;
    return !hasDays || s.days!.includes(day);
  }

  // Wrapping window: [start, 24:00) belongs to today, [00:00, end) to yesterday.
  if (minutes >= start) {
    return !hasDays || s.days!.includes(day);
  }
  if (minutes < end) {
    const previousDay = day === 1 ? 7 : day - 1;
    return !hasDays || s.days!.includes(previousDay);
  }
  return false;
}
