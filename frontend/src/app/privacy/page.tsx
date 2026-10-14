'use client';

import Link from 'next/link';
import { useAuth } from '@/components/AuthProvider';
import { useI18n } from '@/components/I18nProvider';
import { PrivacyAgreementText } from '@/components/PrivacyAgreement';
import { privacyAgreement } from '@/lib/privacyAgreement';

/** The personal data agreement, readable by anyone (signed in or not) at any time. */
export default function PrivacyPage() {
  const { user } = useAuth();
  const { t, locale, formatDate } = useI18n();

  return (
    <div className="page privacy-page">
      <PrivacyAgreementText agreement={privacyAgreement(locale)} />
      {user && (
        <div className="callout">
          <p>
            {user.consentRequired
              ? t('privacy.notAccepted')
              : t('privacy.acceptedOn', { version: user.privacyVersion ?? '', date: formatDate(user.privacyAcceptedAt) })}
          </p>
          <Link href={user.consentRequired ? '/' : '/account'} className="btn">
            {user.consentRequired ? t('privacy.readAndAccept') : t('account.title')}
          </Link>
        </div>
      )}
    </div>
  );
}
