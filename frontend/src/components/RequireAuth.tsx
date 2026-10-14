'use client';

import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useState, type ReactNode } from 'react';
import { api } from '@/lib/api';
import { useAuth } from './AuthProvider';
import { useI18n } from './I18nProvider';
import { useTrees } from './TreeProvider';

interface Props {
  children: ReactNode;
  /** Wait for the current tree before rendering (default true). */
  needsTree?: boolean;
}

/**
 * Renders children only for signed-in users with a verified email (and a
 * loaded tree, unless needsTree is false); sends anonymous visitors to /login.
 */
export default function RequireAuth({ children, needsTree = true }: Props) {
  const { status, user } = useAuth();
  const { current, error: treeError, refreshTrees } = useTrees();
  const { t } = useI18n();
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    if (status === 'anonymous') router.replace(`/login?next=${encodeURIComponent(pathname)}`);
  }, [status, router, pathname]);

  if (status !== 'authenticated' || !user) return <div className="center muted">{t('common.loading')}</div>;

  if (user.verificationRequired) return <VerifyEmailNotice email={user.email} />;

  if (needsTree && !current) {
    return treeError ? (
      <div className="center">
        <p className="error">{t('auth.treesError', { error: treeError })}</p>
        <button className="btn" onClick={() => void refreshTrees()}>
          {t('common.retry')}
        </button>
      </div>
    ) : (
      <div className="center muted">{t('common.loading')}</div>
    );
  }

  return <>{children}</>;
}

function VerifyEmailNotice({ email }: { email: string | null }) {
  const { logout, refreshUser } = useAuth();
  const { t, tx } = useI18n();
  const [message, setMessage] = useState<{ text: string; error?: boolean } | null>(null);
  const [busy, setBusy] = useState(false);

  async function resend() {
    setBusy(true);
    setMessage(null);
    try {
      const result = await api.resendVerification();
      if (result.alreadyVerified) {
        await refreshUser();
        return;
      }
      setMessage({ text: t('verify.newLink') });
    } catch (err) {
      setMessage({ text: (err as Error).message, error: true });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="center">
      <div className="login-card">
        <h1>{t('verify.title')}</h1>
        <p className="muted">{tx('verify.body', { email: <strong>{email}</strong> })}</p>
        {message && <p className={message.error ? 'error' : 'success'}>{message.text}</p>}
        <div className="provider-list">
          <button className="btn primary block" onClick={() => void refreshUser()}>
            {t('verify.done')}
          </button>
          <button className="btn" onClick={resend} disabled={busy}>
            {busy ? t('verify.sending') : t('verify.resend')}
          </button>
          <button className="btn" onClick={logout}>
            {t('common.signOut')}
          </button>
        </div>
      </div>
    </div>
  );
}
