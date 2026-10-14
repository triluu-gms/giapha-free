'use client';

import { useMemo } from 'react';
import { canChi, lunarOf } from '@/lib/lunar';
import type { CalendarKind, DateKind, Person } from '@/lib/types';
import { useI18n } from './I18nProvider';
import { useTrees } from './TreeProvider';

/**
 * Person dates in the current tree's calendars: one for birth dates and one for
 * death dates (often âm lịch, for ngày giỗ). Dates are stored as solar "YYYY",
 * "YYYY-MM" or "YYYY-MM-DD"; in âm lịch, full dates are shown as lunar dates.
 * Partial ones can't be converted (a year or month may straddle Tết), so they are
 * shown as entered.
 */
export function useDates() {
  const { current } = useTrees();
  const { t, formatLifespan } = useI18n();
  const birthCalendar: CalendarKind = current?.settings.birthCalendar ?? 'solar';
  const deathCalendar: CalendarKind = current?.settings.deathCalendar ?? 'solar';

  return useMemo(() => {
    const isLunar = (kind: DateKind) => (kind === 'birth' ? birthCalendar : deathCalendar) === 'lunisolar';
    const lunarDate = (value: string | null | undefined, kind: DateKind) => (isLunar(kind) ? lunarOf(value) : null);
    const leapText = (leap: boolean) => (leap ? t('date.leap') : '');
    const yearOf = (value: string | null | undefined, kind: DateKind) => {
      if (!value) return undefined;
      const l = lunarDate(value, kind);
      return l ? String(l.year) : value.slice(0, 4);
    };

    return {
      /** Whether this kind of date is shown and entered in âm lịch. */
      isLunar,
      formatLifespan: (p: Pick<Person, 'birthDate' | 'deathDate'>) => formatLifespan(p, yearOf),
      /** "15/8/1964 ÂL" for a full date in âm lịch; otherwise the date as stored. */
      formatDate: (value: string | null | undefined, kind: DateKind): string => {
        const l = lunarDate(value, kind);
        if (!l) return value ?? '—';
        return t('date.lunarShort', { day: l.day, month: l.month, year: l.year, leap: leapText(l.leap) });
      },
      /**
       * For the person panel: "Ngày 15 tháng 8 năm Giáp Thìn (1964) âm lịch", with the
       * solar date as `solar` so both can be shown. null `solar` when nothing was converted.
       */
      formatDateLong: (value: string, kind: DateKind): { text: string; solar: string | null } => {
        const l = lunarDate(value, kind);
        if (!l) return { text: value, solar: null };
        return {
          text: t('date.lunarLong', { day: l.day, month: l.month, year: l.year, leap: leapText(l.leap), canChi: canChi(l.year) }),
          solar: t('date.solarEquivalent', { date: value }),
        };
      },
    };
  }, [birthCalendar, deathCalendar, t, formatLifespan]);
}
