'use client';

import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useRef, useState } from 'react';
import { useAuth } from '@/components/AuthProvider';
import { useI18n } from '@/components/I18nProvider';
import { api } from '@/lib/api';

type State =
  | { kind: 'working' }
  | { kind: 'done'; email: string }
  | { kind: 'error'; message: string | null }; // null = the link has no token

/** Opened from the link emailed to a new address: makes it the account's email. */
function Confirm() {
  const params = useSearchParams();
  const { status, refreshUser } = useAuth();
  const { t, errorMessage } = useI18n();
  const [state, setState] = useState<State>({ kind: 'working' });
  const started = useRef(false);

  useEffect(() => {
    // Strict mode runs effects twice in development; the token is single-use.
    if (started.current) return;
    started.current = true;
    const token = params.get('token');
    if (!token) {
      setState({ kind: 'error', message: null });
      return;
    }
    api
      .confirmEmailChange(token)
      .then(async (result) => {
        setState({ kind: 'done', email: result.email });
        await refreshUser();
      })
      .catch((err) => setState({ kind: 'error', message: errorMessage(err) }));
  }, [params, refreshUser, errorMessage]);

  return (
    <div className="login-card">
      {state.kind === 'working' && <p className="muted">{t('emailChange.working')}</p>}
      {state.kind === 'done' && (
        <>
          <h1>{t('emailChange.doneTitle')}</h1>
          <p className="muted">{t('emailChange.done', { email: state.email })}</p>
          <Link href={status === 'authenticated' ? '/account' : '/login'} className="btn primary block">
            {status === 'authenticated' ? t('account.title') : t('common.signIn')}
          </Link>
        </>
      )}
      {state.kind === 'error' && (
        <>
          <h1>{t('emailChange.failedTitle')}</h1>
          <p className="error">{state.message ?? t('verifyPage.missingToken')}</p>
          <Link href="/account" className="btn block">
            {t('account.title')}
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

export default function ConfirmEmailPage() {
  return (
    <div className="center">
      <Suspense fallback={<Loading />}>
        <Confirm />
      </Suspense>
    </div>
  );
}
