'use client';

import Link from 'next/link';
import { Suspense, useState, type FormEvent } from 'react';
import { useAuth } from '@/components/AuthProvider';
import { useI18n } from '@/components/I18nProvider';
import { api } from '@/lib/api';
import { useLinkToken } from '@/lib/useLinkToken';

function ResetPasswordForm() {
  const token = useLinkToken();
  const { refreshUser } = useAuth();
  const { t } = useI18n();
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!token) return;
    if (password !== confirm) {
      setError(t('reset.mismatch'));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await api.resetPassword(token, password);
      // The API signed us in; pick up the new session.
      await refreshUser();
      setDone(true);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (!token) {
    return (
      <div className="login-card">
        <h1>{t('reset.title')}</h1>
        <p className="error">{t('reset.missingToken')}</p>
        <Link href="/forgot-password" className="btn block">
          {t('reset.requestNew')}
        </Link>
      </div>
    );
  }

  if (done) {
    return (
      <div className="login-card">
        <h1>{t('reset.doneTitle')}</h1>
        <p className="muted">{t('reset.done')}</p>
        <Link href="/" className="btn primary block">
          {t('verifyPage.openTree')}
        </Link>
      </div>
    );
  }

  return (
    <div className="login-card">
      <h1>{t('reset.title')}</h1>
      <p className="muted">{t('reset.hint')}</p>
      <form className="form" onSubmit={submit}>
        <label>
          {t('reset.newPassword')}
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="new-password"
            minLength={8}
            maxLength={128}
            required
            autoFocus
          />
          <span className="hint">{t('login.passwordHint')}</span>
        </label>
        <label>
          {t('reset.confirmPassword')}
          <input
            type="password"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            autoComplete="new-password"
            minLength={8}
            maxLength={128}
            required
          />
        </label>
        {error && <p className="error">{error}</p>}
        <button type="submit" className="btn primary block" disabled={busy}>
          {busy ? t('common.pleaseWait') : t('reset.submit')}
        </button>
      </form>
      <p className="muted small">
        <Link href="/forgot-password">{t('reset.requestNew')}</Link>
      </p>
    </div>
  );
}

function Loading() {
  const { t } = useI18n();
  return <p className="muted">{t('common.loading')}</p>;
}

export default function ResetPasswordPage() {
  return (
    <div className="center">
      <Suspense fallback={<Loading />}>
        <ResetPasswordForm />
      </Suspense>
    </div>
  );
}
