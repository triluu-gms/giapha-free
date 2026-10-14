'use client';

import Link from 'next/link';
import { useState } from 'react';
import { api } from '@/lib/api';
import { privacyAgreement, PRIVACY_VERSION, type Agreement } from '@/lib/privacyAgreement';
import { useAuth } from './AuthProvider';
import { useI18n } from './I18nProvider';

/** The agreement's sections, in the UI language (the Vietnamese text is the one that applies). */
export function PrivacyAgreementText({ agreement, showTitle = true }: { agreement: Agreement; showTitle?: boolean }) {
  return (
    <div className="agreement">
      {showTitle && <h1>{agreement.title}</h1>}
      <p className="muted small">{agreement.subtitle}</p>
      {agreement.translationNote && <p className="callout">{agreement.translationNote}</p>}
      {agreement.sections.map((section) => (
        <section key={section.title}>
          <h2>{section.title}</h2>
          {section.blocks.map((block, i) =>
            typeof block === 'string' ? (
              <p key={i}>{block}</p>
            ) : (
              <ul key={i}>
                {block.list.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            ),
          )}
        </section>
      ))}
    </div>
  );
}

/**
 * Shown instead of the app until the signed-in user accepts the current
 * agreement: on first sign-in (Google/GitHub accounts and accounts made before
 * the agreement), after withdrawing consent, and when a new version comes out.
 */
export function ConsentNotice() {
  const { user, logout, refreshUser } = useAuth();
  const { t, locale, errorMessage } = useI18n();
  const agreement = privacyAgreement(locale);
  const [read, setRead] = useState(false);
  const [others, setOthers] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function accept() {
    setBusy(true);
    setError(null);
    try {
      await api.acceptPrivacy(PRIVACY_VERSION);
      await refreshUser();
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  }

  return (
    <div className="center consent-wrap">
      <div className="login-card consent-card">
        <h1>{agreement.title}</h1>
        {/* Accepted an earlier version: say the text changed, rather than greeting them as new. */}
        <p className="muted">{user?.privacyVersion ? t('privacy.updatedIntro') : t('privacy.intro')}</p>
        <div className="consent-scroll" tabIndex={0} aria-label={agreement.title}>
          <PrivacyAgreementText agreement={agreement} showTitle={false} />
        </div>
        <label className="check">
          <input type="checkbox" checked={read} onChange={(e) => setRead(e.target.checked)} />
          <span>{agreement.confirmRead}</span>
        </label>
        <label className="check">
          <input type="checkbox" checked={others} onChange={(e) => setOthers(e.target.checked)} />
          <span>{agreement.confirmOthers}</span>
        </label>
        {error && <p className="error">{error}</p>}
        <div className="provider-list">
          <button className="btn primary block" onClick={accept} disabled={!read || !others || busy}>
            {busy ? t('common.pleaseWait') : t('privacy.accept')}
          </button>
          <button className="btn" onClick={() => void logout()}>
            {t('privacy.declineSignOut')}
          </button>
        </div>
        <p className="muted small">
          {t('privacy.declineHint')}{' '}
          <Link href="/account#delete-account">{t('privacy.deleteLink')}</Link>
        </p>
      </div>
    </div>
  );
}
