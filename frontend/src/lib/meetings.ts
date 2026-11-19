// Family meetings (họp họ, họp chi): the next date of a meeting, and how dates are
// written. The backend works out each saved meeting's next date
// (backend/src/meetings/meetings.ts); the same rule is repeated here only to preview
// a meeting while it's being entered.

import { canChi, lunarOf, lunarToSolar, solarIsoOf } from './lunar';
import type { Meeting, MeetingInput } from './types';

/** How many days ahead the tree page shows coming meetings. */
export const UPCOMING_DAYS = 30;

const pad = (n: number) => String(n).padStart(2, '0');

/** Today in Vietnam (UTC+7), "YYYY-MM-DD", as the backend counts days. */
export const vietnamToday = (now = new Date()) => new Date(now.getTime() + 7 * 3600_000).toISOString().slice(0, 10);

/** Whole days from `from` to `to` (both "YYYY-MM-DD"). */
export const daysBetween = (from: string, to: string) => Math.round((Date.parse(to) - Date.parse(from)) / 86_400_000);

const addDays = (iso: string, days: number) =>
  new Date(Date.parse(`${iso}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);

/** A month's solar dates, in order: a solar month, or the regular lunar month of that number (29 or 30 days). */
function monthDays(calendar: MeetingInput['calendar'], year: number, month: number): string[] {
  if (calendar === 'solar') {
    const last = new Date(Date.UTC(year, month, 0)).getUTCDate();
    return Array.from({ length: last }, (_, i) => `${year}-${pad(month)}-${pad(i + 1)}`);
  }
  const first = solarIsoOf({ day: 1, month, year, leap: false });
  if (!first) return [];
  const length = lunarToSolar({ day: 30, month, year, leap: false }) ? 30 : 29;
  return Array.from({ length }, (_, i) => addDays(first, i));
}

type Rule = Pick<MeetingInput, 'repeat' | 'calendar' | 'month' | 'day' | 'weekday' | 'week' | 'date'>;

/** A yearly meeting's date in `year` (solar or lunar, as its calendar), or null if that day doesn't exist. */
function dateIn(m: Rule, year: number): string | null {
  if (!m.month) return null;
  if (m.weekday != null && m.week != null) {
    const matches = monthDays(m.calendar, year, m.month).filter((d) => new Date(`${d}T00:00:00Z`).getUTCDay() === m.weekday);
    return (m.week === -1 ? matches[matches.length - 1] : matches[m.week - 1]) ?? null;
  }
  if (!m.day) return null;
  if (m.calendar === 'solar') {
    const last = new Date(Date.UTC(year, m.month, 0)).getUTCDate();
    return `${year}-${pad(m.month)}-${pad(Math.min(m.day, last))}`;
  }
  const day = m.day === 30 && !lunarToSolar({ day: 30, month: m.month, year, leap: false }) ? 29 : m.day;
  return solarIsoOf({ day, month: m.month, year, leap: false });
}

/** The meeting's next date on or after `today`, or null (see the backend's nextOccurrence). */
export function nextOccurrence(m: Rule, today: string): string | null {
  if (m.repeat === 'once') return m.date && m.date >= today ? m.date : null;
  const year = m.calendar === 'solar' ? Number(today.slice(0, 4)) : lunarOf(today)!.year;
  for (const y of [year, year + 1]) {
    const date = dateIn(m, y);
    if (date && date >= today) return date;
  }
  return null;
}

/** Which weeks a "Nth weekday" rule can name: the first to the fourth, or the last (-1). */
export const WEEKS = [1, 2, 3, 4, -1] as const;

/** "Chủ nhật", "Thứ Hai", … (or "Sunday", …) for 0 = Sunday … 6 = Saturday. */
export function weekdayName(weekday: number, locale: 'en' | 'vi') {
  return new Date(Date.UTC(2023, 0, 1 + weekday)).toLocaleDateString(locale === 'vi' ? 'vi-VN' : 'en-US', {
    weekday: 'long',
    timeZone: 'UTC',
  });
}

/** "thứ ba", "cuối cùng" (or "third", "last") for a rule's week. */
export function weekName(week: number, locale: 'en' | 'vi') {
  const vi = { 1: 'thứ nhất', 2: 'thứ hai', 3: 'thứ ba', 4: 'thứ tư', [-1]: 'cuối cùng' } as Record<number, string>;
  const en = { 1: 'first', 2: 'second', 3: 'third', 4: 'fourth', [-1]: 'last' } as Record<number, string>;
  return (locale === 'vi' ? vi : en)[week] ?? String(week);
}

/** A lunar month's name: "tháng Giêng", "tháng 2", …, "tháng Chạp" (in English "1st lunar month", …). */
export function lunarMonthName(month: number, locale: 'en' | 'vi') {
  if (locale === 'en') return `lunar month ${month}`;
  return month === 1 ? 'tháng Giêng' : month === 12 ? 'tháng Chạp' : `tháng ${month}`;
}

/** "10 tháng Giêng năm Đinh Mùi" for a solar date's lunar day. */
export function lunarLabel(iso: string, locale: 'en' | 'vi') {
  const l = lunarOf(iso);
  if (!l) return '';
  return locale === 'vi'
    ? `${l.day} ${lunarMonthName(l.month, 'vi')}${l.leap ? ' nhuận' : ''} năm ${canChi(l.year)}`
    : `lunar ${l.day}/${l.month}${l.leap ? ' (leap)' : ''}, ${canChi(l.year)} year`;
}

/** "Thứ Hai, 15/2/2027" (or "Monday, 2/15/2027"). */
export function solarLabel(iso: string, locale: 'en' | 'vi') {
  return new Date(`${iso}T00:00:00Z`).toLocaleDateString(locale === 'vi' ? 'vi-VN' : 'en-US', {
    weekday: 'long',
    day: 'numeric',
    month: 'numeric',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

/**
 * How a meeting repeats, e.g. "Hằng năm, 10 tháng Giêng (âm lịch)" or "Hằng năm, Chủ nhật
 * thứ ba của tháng Chạp (âm lịch)"; null for a one-off meeting.
 */
export function ruleLabel(m: Pick<Meeting, 'repeat' | 'calendar' | 'month' | 'day' | 'weekday' | 'week'>, locale: 'en' | 'vi') {
  if (m.repeat !== 'yearly' || !m.month) return null;
  if (m.weekday != null && m.week != null) {
    const day = weekdayName(m.weekday, locale);
    const week = weekName(m.week, locale);
    if (locale === 'vi') {
      const month = m.calendar === 'lunisolar' ? lunarMonthName(m.month, 'vi') : `tháng ${m.month}`;
      const name = day.charAt(0).toUpperCase() + day.slice(1);
      return `Hằng năm, ${name} ${week} của ${month} (${m.calendar === 'lunisolar' ? 'âm lịch' : 'dương lịch'})`;
    }
    return `Every year, the ${week} ${day} of ${m.calendar === 'lunisolar' ? `lunar month ${m.month}` : `month ${m.month}`}`;
  }
  if (!m.day) return null;
  if (m.calendar === 'lunisolar') {
    return locale === 'vi'
      ? `Hằng năm, ${m.day} ${lunarMonthName(m.month, 'vi')} (âm lịch)`
      : `Every year, lunar ${m.day}/${m.month}`;
  }
  return locale === 'vi' ? `Hằng năm, ngày ${m.day}/${m.month} (dương lịch)` : `Every year on ${m.month}/${m.day}`;
}
