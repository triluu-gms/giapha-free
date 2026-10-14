'use client';

import { useRouter } from 'next/navigation';
import { createContext, Fragment, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
import { dictionaries, translate, LOCALE_COOKIE, type Locale, type MessageKey } from '@/lib/i18n';
import { MIN_PARENT_AGE } from '@/lib/rules';
import { BRANCH_MAX_DEPTH, type EditScope, type Gender, type Person } from '@/lib/types';

interface I18nContextValue {
  locale: Locale;
  setLocale: (locale: Locale) => void;
  /** Translated string with `{placeholders}` filled in. */
  t: (key: MessageKey, vars?: Record<string, string | number>) => string;
  /** Like t(), but placeholders may be React nodes (e.g. <strong>). */
  tx: (key: MessageKey, vars: Record<string, ReactNode>) => ReactNode;
  /** Vietnamese order (Họ Tên) in Vietnamese, given-name first in English. */
  formatName: (p: Pick<Person, 'firstName' | 'lastName'>) => string;
  /** "1920 – 1985". `yearOf` picks a date's year (useDates passes the lunar year for dates kept in âm lịch). */
  formatLifespan: (
    p: Pick<Person, 'birthDate' | 'deathDate'>,
    yearOf?: (date: string | null | undefined, kind: 'birth' | 'death') => string | undefined,
  ) => string;
  formatGender: (g: Gender | undefined) => string;
  formatDate: (iso?: string | null) => string;
  /**
   * A branch's reach, counting its first person as the first đời: depth 0 → "1 đời",
   * depth 2 → "3 đời" (detailed: "3 đời (đến đời cháu)"), or "All generations".
   */
  formatBranchDepth: (depth: number, detailed?: boolean) => string;
  /** "Branch of Nguyễn Văn An · 2 generations". */
  formatBranch: (scope: Pick<EditScope, 'root' | 'depth'>) => string;
  /**
   * Text to show for a failed request or an import row error: our translation
   * when the API sent a known `code`, else the API's own (English) message.
   */
  errorMessage: (err: unknown) => string;
}

// Values the `error.*` translations may use.
const ERROR_VARS = { min: MIN_PARENT_AGE };

const I18nContext = createContext<I18nContextValue | null>(null);

const year = (date?: string | null) => date?.slice(0, 4);

export function I18nProvider({ initialLocale, children }: { initialLocale: Locale; children: ReactNode }) {
  const router = useRouter();
  const [locale, setLocaleState] = useState<Locale>(initialLocale);

  const setLocale = useCallback(
    (next: Locale) => {
      setLocaleState(next);
      document.cookie = `${LOCALE_COOKIE}=${next}; path=/; max-age=31536000; samesite=lax`;
      document.documentElement.lang = next;
      // Re-render server parts (page title, <html lang>) in the new language.
      router.refresh();
    },
    [router],
  );

  const value = useMemo<I18nContextValue>(() => {
    const t: I18nContextValue['t'] = (key, vars) => translate(locale, key, vars);
    const formatName: I18nContextValue['formatName'] = (p) =>
      (locale === 'vi' ? [p.lastName, p.firstName] : [p.firstName, p.lastName]).filter(Boolean).join(' ');
    // A branch's depth is stored as generations *below* its first person; people count
    // that person as the first đời, so depth 0 reads "1 đời", depth 2 "3 đời".
    const REACH = ['branch.reach1', 'branch.reach2', 'branch.reach3', 'branch.reach4', 'branch.reach5'] as const;
    const formatBranchDepth = (depth: number, detailed = false) => {
      if (depth >= BRANCH_MAX_DEPTH) return t('branch.depthAll');
      const count = depth + 1;
      const generations = t(count === 1 ? 'branch.generationCount_one' : 'branch.generationCount_other', { count });
      return detailed && depth < REACH.length
        ? t('branch.depthDetailed', { generations, reach: t(REACH[depth]) })
        : generations;
    };
    return {
      locale,
      setLocale,
      t,
      tx: (key, vars) => {
        const parts = translate(locale, key).split(/(\{\w+\})/g);
        return parts.map((part, i) => {
          const match = /^\{(\w+)\}$/.exec(part);
          return <Fragment key={i}>{match && match[1] in vars ? vars[match[1]] : part}</Fragment>;
        });
      },
      formatName,
      formatBranchDepth,
      formatBranch: ({ root, depth }) =>
        root
          ? t('branch.summary', { name: formatName(root), depth: formatBranchDepth(depth) })
          : t('branch.rootDeleted'),
      formatLifespan: (p, yearOf = year) => {
        const born = yearOf(p.birthDate, 'birth');
        const died = yearOf(p.deathDate, 'death');
        if (born && died) return `${born} – ${died}`;
        if (born) return t('life.born', { year: born });
        if (died) return t('life.died', { year: died });
        return '';
      },
      formatGender: (g) => t(`gender.${g ?? 'unknown'}` as MessageKey),
      formatDate: (iso) => (iso ? new Date(iso).toLocaleDateString(locale === 'vi' ? 'vi-VN' : 'en-US') : '—'),
      errorMessage: (err) => {
        const { code, message } = (err ?? {}) as { code?: unknown; message?: unknown };
        const key = `error.${String(code)}`;
        if (typeof code === 'string' && key in dictionaries.en) return t(key as MessageKey, ERROR_VARS);
        return typeof message === 'string' ? message : String(err);
      },
    };
  }, [locale, setLocale]);

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18nContextValue {
  const ctx = useContext(I18nContext);
  if (!ctx) throw new Error('useI18n must be used inside <I18nProvider>');
  return ctx;
}
