import { describe, expect, it } from 'vitest';
import { isWithinSchedule, parseSchedule } from '../core/schedule';

// 2026-08-20 is a Thursday (ISO weekday 4).
const thursday = (hhmm: string) => new Date(`2026-08-20T${hhmm}:00Z`);
const saturday = (hhmm: string) => new Date(`2026-08-22T${hhmm}:00Z`);
const UTC = 'UTC';

describe('isWithinSchedule', () => {
  it('treats an empty schedule as 24/7', () => {
    expect(isWithinSchedule({}, thursday('03:00'), UTC)).toBe(true);
    expect(isWithinSchedule({ days: [] }, saturday('23:59'), UTC)).toBe(true);
  });

  it('honours a day list on its own', () => {
    expect(isWithinSchedule({ days: [1, 2, 3, 4, 5] }, thursday('12:00'), UTC)).toBe(true);
    expect(isWithinSchedule({ days: [1, 2, 3, 4, 5] }, saturday('12:00'), UTC)).toBe(false);
  });

  it('honours a time window on its own', () => {
    const s = { start: '09:00', end: '17:00' };
    expect(isWithinSchedule(s, thursday('08:59'), UTC)).toBe(false);
    expect(isWithinSchedule(s, thursday('09:00'), UTC)).toBe(true);
    expect(isWithinSchedule(s, thursday('16:59'), UTC)).toBe(true);
    // `end` is exclusive.
    expect(isWithinSchedule(s, thursday('17:00'), UTC)).toBe(false);
  });

  it('combines days and window', () => {
    const s = { days: [1, 2, 3, 4, 5], start: '09:00', end: '17:00' };
    expect(isWithinSchedule(s, thursday('10:00'), UTC)).toBe(true);
    expect(isWithinSchedule(s, thursday('20:00'), UTC)).toBe(false);
    expect(isWithinSchedule(s, saturday('10:00'), UTC)).toBe(false);
  });

  it('supports a window that wraps past midnight', () => {
    const s = { start: '20:00', end: '02:00' };
    expect(isWithinSchedule(s, thursday('21:00'), UTC)).toBe(true);
    expect(isWithinSchedule(s, thursday('01:00'), UTC)).toBe(true);
    expect(isWithinSchedule(s, thursday('12:00'), UTC)).toBe(false);
  });

  it('attributes the post-midnight tail of a wrapping window to the previous day', () => {
    // Friday 00:30 UTC belongs to the Thursday-night window.
    const friday0030 = new Date('2026-08-21T00:30:00Z');
    expect(isWithinSchedule({ days: [4], start: '20:00', end: '02:00' }, friday0030, UTC)).toBe(true);
    expect(isWithinSchedule({ days: [5], start: '20:00', end: '02:00' }, friday0030, UTC)).toBe(false);
  });

  it('respects the evaluation timezone', () => {
    const s = { start: '09:00', end: '17:00' };
    const noonUtc = thursday('12:00');
    expect(isWithinSchedule(s, noonUtc, 'UTC')).toBe(true);
    // 12:00 UTC is 05:00 in Los Angeles — outside business hours there.
    expect(isWithinSchedule(s, noonUtc, 'America/Los_Angeles')).toBe(false);
  });
});

describe('parseSchedule', () => {
  it('drops invalid days and times', () => {
    expect(parseSchedule({ days: [0, 3, 9], start: '25:00', end: '17:00' })).toEqual({
      days: [3],
      start: undefined,
      end: '17:00',
    });
    expect(parseSchedule('not json')).toEqual({});
    expect(parseSchedule(null)).toEqual({});
  });
});
