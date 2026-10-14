import { lunarOf, lunarToSolar } from '../lib/lunar';

export type CalendarKind = 'solar' | 'lunisolar';

const FULL_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

export const isFullDate = (value: string | null | undefined): value is string => FULL_DATE.test(value ?? '');

const isLeapYear = (y: number) => (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;

/**
 * Whether `on` ("YYYY-MM-DD", solar) is an anniversary of a death on `deathDate`
 * (a full solar date), counted in the tree's calendar for death dates:
 *  - solar: the same day and month (29 February falls on the 28th in other years);
 *  - lunisolar (ngày giỗ): the same lunar day and month. As is customary, a death in
 *    a leap month is remembered in the regular month of that number, and a death on
 *    the 30th falls on the 29th in years when that lunar month has only 29 days.
 * Only later years count, never the death itself.
 */
export function isAnniversary(deathDate: string, on: string, calendar: CalendarKind): boolean {
  const death = FULL_DATE.exec(deathDate);
  const day = FULL_DATE.exec(on);
  if (!death || !day || on <= deathDate) return false;

  if (calendar === 'solar') {
    if (day[2] === death[2] && day[3] === death[3]) return true;
    // Born-on-29-February rule, for deaths
    return death[2] === '02' && death[3] === '29' && day[2] === '02' && day[3] === '28' && !isLeapYear(Number(day[1]));
  }

  const died = lunarOf(deathDate)!;
  const today = lunarOf(on)!;
  if (today.leap || today.month !== died.month || today.year <= died.year) return false;
  const monthHas30 = lunarToSolar({ day: 30, month: today.month, year: today.year, leap: false }) !== null;
  const observed = died.day === 30 && !monthHas30 ? 29 : died.day;
  return today.day === observed;
}

/** "YYYY-MM-DD" in Vietnam (UTC+7, no daylight saving) at `now`, shifted by `days`. */
export function vietnamDate(now: Date, days = 0): string {
  return new Date(now.getTime() + 7 * 3600_000 + days * 86_400_000).toISOString().slice(0, 10);
}
