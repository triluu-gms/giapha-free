'use client';

import { useEffect, useRef, useState } from 'react';
import { lunarIso, lunarOf, solarIsoOf } from '@/lib/lunar';
import type { MessageKey } from '@/lib/i18n';
import type { DateKind } from '@/lib/types';
import { useI18n } from './I18nProvider';
import { useDates } from './useDates';

/** YYYY, YYYY-MM or YYYY-MM-DD, as the API accepts. */
export const DATE_PATTERN = '\\d{4}(-\\d{2}(-\\d{2})?)?';

interface Props {
  label: string;
  /** Birth and death dates can use different calendars (tree settings). */
  kind: DateKind;
  /** The stored (solar) value: "", "YYYY", "YYYY-MM" or "YYYY-MM-DD". */
  value: string;
  /** Called with the value to store. While an âm lịch entry is invalid the form can't be submitted. */
  onChange: (value: string) => void;
}

/** What a typed date means in this calendar: the value to store, or why it can't be stored. */
function interpret(text: string, leap: boolean, lunar: boolean): { stored: string; error?: MessageKey } {
  const value = text.trim();
  if (!lunar || !value || /^\d{4}$/.test(value)) return { stored: value };
  if (/^\d{4}-\d{2}$/.test(value)) return { stored: value, error: 'date.lunarNeedsDay' };
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!m) return { stored: value }; // the pattern attribute reports the format
  const solar = solarIsoOf({ year: Number(m[1]), month: Number(m[2]), day: Number(m[3]), leap });
  return solar ? { stored: solar } : { stored: value, error: 'date.invalidLunar' };
}

/**
 * A person's birth or death date. When the tree keeps that kind of date in âm
 * lịch, it is typed as a lunar date (plus "leap month"), shown with its solar
 * equivalent, and stored as that solar date. Year-only dates are kept as typed.
 */
export default function DateInput({ label, kind, value, onChange }: Props) {
  const { t } = useI18n();
  const lunar = useDates().isLunar(kind);
  const input = useRef<HTMLInputElement>(null);

  // What the field shows: the stored date, converted to its lunar date when needed.
  const display = (stored: string) => {
    const l = lunar ? lunarOf(stored) : null;
    return l ? { text: lunarIso(l), leap: l.leap } : { text: stored, leap: false };
  };
  const [text, setText] = useState(() => display(value).text);
  const [leap, setLeap] = useState(() => display(value).leap);
  // The last value this field reported, to tell its own changes from outside ones (a reset).
  const reported = useRef(value);

  // A value set from outside (e.g. the form reset after adding someone) replaces what was typed.
  useEffect(() => {
    if (value === reported.current) return;
    reported.current = value;
    const shown = display(value);
    setText(shown.text);
    setLeap(shown.leap);
  }, [value]); // eslint-disable-line react-hooks/exhaustive-deps -- display only reads `lunar`

  const { stored, error } = interpret(text, leap, lunar);

  useEffect(() => {
    input.current?.setCustomValidity(error ? t(error) : '');
  }, [error, t]);

  function update(nextText: string, nextLeap: boolean) {
    setText(nextText);
    setLeap(nextLeap);
    const next = interpret(nextText, nextLeap, lunar).stored;
    reported.current = next;
    onChange(next);
  }

  const showSolar = lunar && !error && /^\d{4}-\d{2}-\d{2}$/.test(stored);

  return (
    <div className="date-field">
      <label>
        {lunar ? t('date.labelLunar', { label }) : label}
        <input
          ref={input}
          value={text}
          onChange={(e) => update(e.target.value, leap)}
          placeholder="YYYY-MM-DD"
          pattern={DATE_PATTERN}
          title={t(lunar ? 'date.formatLunar' : 'form.dateFormat')}
        />
      </label>
      {lunar && (
        <label className="leap">
          <input type="checkbox" checked={leap} onChange={(e) => update(text, e.target.checked)} />
          {t('date.leapMonth')}
        </label>
      )}
      {error && <span className="error small">{t(error)}</span>}
      {showSolar && <span className="muted small">{t('date.solarEquivalent', { date: stored })}</span>}
    </div>
  );
}
