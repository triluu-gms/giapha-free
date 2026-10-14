'use client';

import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useCallback, useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { useAuth } from '@/components/AuthProvider';
import { useI18n } from '@/components/I18nProvider';
import { ConsentNotice } from '@/components/PrivacyAgreement';
import { useTrees } from '@/components/TreeProvider';
import { api } from '@/lib/api';
import { rememberTree } from '@/lib/currentTree';
import type { JoinPreview } from '@/lib/types';

/**
 * Landing page of a tree's shareable "request access" link. Opening it grants
 * nothing: a signed-in visitor asks, and the tree's owner and admins decide.
 */
export default function JoinPage() {
  const { token } = useParams<{ token: string }>();
  const router = useRouter();
  const { user, status: authStatus } = useAuth();
  const { refreshTrees } = useTrees();
  const { t, tx, errorMessage } = useI18n();
  const [preview, setPreview] = useState<JoinPreview | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const here = `/join/${encodeURIComponent(token)}`;

  const load = useCallback(() => {
    api
      .joinPreview(token)
      .then((p) => {
        setPreview(p);
        setLoadError(null);
      })
      .catch((err) => setLoadError(errorMessage(err)));
  }, [token, errorMessage]);

  // Where the visitor stands depends on who is signed in: reload when that changes.
  useEffect(() => {
    if (authStatus !== 'loading') load();
  }, [authStatus, user?.id, user?.consentRequired, load]);

  async function ask(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const result = await api.requestAccess(token, message.trim());
      setPreview((p) => (p ? { ...p, status: result.status, treeId: result.treeId } : p));
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  async function cancel() {
    setBusy(true);
    setError(null);
    try {
      await api.cancelAccessRequest(token);
      setPreview((p) => (p ? { ...p, status: 'none' } : p));
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  async function openTree(treeId: string) {
    rememberTree(treeId);
    await refreshTrees(treeId);
    router.push('/');
  }

  // Reading the tree's name is public, but asking needs the accepted data agreement.
  if (user?.consentRequired) return <ConsentNotice />;

  let body: ReactNode;
  if (loadError) {
    body = (
      <>
        <h1>{t('join.invalidTitle')}</h1>
        <p className="error">{loadError}</p>
        <Link href="/" className="btn block">
          {t('common.goToApp')}
        </Link>
      </>
    );
  } else if (!preview || authStatus === 'loading') {
    body = <p className="muted">{t('common.loading')}</p>;
  } else {
    const intro = tx(preview.sharedBy ? 'join.introBy' : 'join.intro', {
      by: <strong>{preview.sharedBy}</strong>,
      tree: <strong>{preview.treeName}</strong>,
    });
    body = (
      <>
        <h1>{t('join.title')}</h1>
        <p>{intro}</p>
        {preview.status === 'member' ? (
          <>
            <p className="success">{t('join.member')}</p>
            <button className="btn primary block" onClick={() => void openTree(preview.treeId!)}>
              {t('join.openTree')}
            </button>
          </>
        ) : preview.status === 'pending' ? (
          <>
            <p className="success">{t('join.pending')}</p>
            <button className="btn block" onClick={() => void cancel()} disabled={busy}>
              {t('join.cancel')}
            </button>
          </>
        ) : preview.expired ? (
          <p className="error">{t('join.expired')}</p>
        ) : preview.status === 'anonymous' ? (
          <>
            <p className="muted">{t('join.signInFirst')}</p>
            <div className="provider-list">
              <Link className="btn primary block" href={`/login?mode=register&next=${encodeURIComponent(here)}`}>
                {t('join.register')}
              </Link>
              <Link className="btn" href={`/login?next=${encodeURIComponent(here)}`}>
                {t('join.signIn')}
              </Link>
            </div>
          </>
        ) : user?.verificationRequired ? (
          <>
            <p className="muted">{t('join.verifyFirst', { email: user.email ?? '' })}</p>
            <Link href="/" className="btn block">
              {t('common.goToApp')}
            </Link>
          </>
        ) : (
          <form className="form" onSubmit={ask}>
            <label>
              {t('join.messageLabel')}
              <textarea
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                maxLength={500}
                rows={3}
                placeholder={t('join.messagePlaceholder')}
              />
              <span className="hint">{t('join.messageHint')}</span>
            </label>
            <button className="btn primary block" disabled={busy}>
              {busy ? t('common.pleaseWait') : t('join.ask')}
            </button>
          </form>
        )}
        {error && <p className="error">{error}</p>}
        <p className="muted small">{t('join.privacyNote')}</p>
      </>
    );
  }

  return (
    <div className="center">
      <div className="login-card">{body}</div>
    </div>
  );
}
