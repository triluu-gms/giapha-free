'use client';

import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Suspense, useState, type FormEvent } from 'react';
import { useI18n } from '@/components/I18nProvider';
import { api } from '@/lib/api';

function ForgotPasswordForm() {
  const params = useSearchParams();
  const { t, tx } = useI18n();
  const [email, setEmail] = useState(params.get('email') ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sentTo, setSentTo] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    const address = email.trim();
    setBusy(true);
    setError(null);
    try {
      await api.forgotPassword(address);
      setSentTo(address);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="login-card">
      {sentTo ? (
        <>
          <h1>{t('forgot.sentTitle')}</h1>
          <p className="muted">{tx('forgot.sent', { email: <strong>{sentTo}</strong> })}</p>
        </>
      ) : (
        <>
          <h1>{t('forgot.title')}</h1>
          <p className="muted">{t('forgot.hint')}</p>
          <form className="form" onSubmit={submit}>
            <label>
              {t('login.email')}
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                autoComplete="email"
                required
                autoFocus
              />
            </label>
            {error && <p className="error">{error}</p>}
            <button type="submit" className="btn primary block" disabled={busy}>
              {busy ? t('common.pleaseWait') : t('forgot.submit')}
            </button>
          </form>
        </>
      )}
      <p className="muted small">
        <Link href="/login">{t('forgot.backToSignIn')}</Link>
      </p>
    </div>
  );
}

function Loading() {
  const { t } = useI18n();
  return <p className="muted">{t('common.loading')}</p>;
}

export default function ForgotPasswordPage() {
  return (
    <div className="center">
      <Suspense fallback={<Loading />}>
        <ForgotPasswordForm />
      </Suspense>
    </div>
  );
}
