'use client';

import { localeNames, locales, type Locale } from '@/lib/i18n';
import { useI18n } from './I18nProvider';

export default function LanguageSwitcher() {
  const { locale, setLocale, t } = useI18n();
  return (
    <label className="language-switcher" title={t('common.language')}>
      <span className="sr-only">{t('common.language')}</span>
      <span aria-hidden>🌐</span>
      <select value={locale} onChange={(e) => setLocale(e.target.value as Locale)}>
        {locales.map((l) => (
          <option key={l} value={l}>
            {localeNames[l]}
          </option>
        ))}
      </select>
    </label>
  );
}
