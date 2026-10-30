'use client';

import Link from 'next/link';
import { Suspense, useEffect, useRef, useState } from 'react';
import { useAuth } from '@/components/AuthProvider';
import { useI18n } from '@/components/I18nProvider';
import { api } from '@/lib/api';
import { useLinkToken } from '@/lib/useLinkToken';

type State =
  | { kind: 'working' }
  | { kind: 'done'; email: string | null }
  | { kind: 'error'; message: string | null }; // null = the link has no token

function Verify() {
  const linkToken = useLinkToken();
  const { status, refreshUser } = useAuth();
  const { t } = useI18n();
  const [state, setState] = useState<State>({ kind: 'working' });
  const started = useRef(false);

  useEffect(() => {
    // Strict mode runs effects twice in development; the token is single-use.
    if (started.current) return;
    started.current = true;
    const token = linkToken;
    if (!token) {
      setState({ kind: 'error', message: null });
      return;
    }
    api
      .verifyEmail(token)
      .then(async (result) => {
        setState({ kind: 'done', email: result.email });
        await refreshUser();
      })
      .catch((err: Error) => setState({ kind: 'error', message: err.message }));
  }, [linkToken, refreshUser]);

  return (
    <div className="login-card">
      {state.kind === 'working' && <p className="muted">{t('verifyPage.working')}</p>}
      {state.kind === 'done' && (
        <>
          <h1>{t('verifyPage.doneTitle')}</h1>
          <p className="muted">
            {state.email ? t('verifyPage.confirmed', { email: state.email }) : t('verifyPage.confirmedNoEmail')}
          </p>
          <Link href={status === 'authenticated' ? '/' : '/login'} className="btn primary block">
            {status === 'authenticated' ? t('verifyPage.openTree') : t('common.signIn')}
          </Link>
        </>
      )}
      {state.kind === 'error' && (
        <>
          <h1>{t('verifyPage.failedTitle')}</h1>
          <p className="error">{state.message ?? t('verifyPage.missingToken')}</p>
          <Link href="/" className="btn block">
            {t('common.goToApp')}
          </Link>
        </>
      )}
    </div>
  );
}

function Loading() {
  const { t } = useI18n();
  return <p className="muted">{t('common.loading')}</p>;
}

export default function VerifyEmailPage() {
  return (
    <div className="center">
      <Suspense fallback={<Loading />}>
        <Verify />
      </Suspense>
    </div>
  );
}
