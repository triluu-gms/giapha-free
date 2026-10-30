'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Suspense, useEffect, useState } from 'react';
import { useAuth } from '@/components/AuthProvider';
import { useI18n } from '@/components/I18nProvider';
import { ConsentNotice } from '@/components/PrivacyAgreement';
import { useTrees } from '@/components/TreeProvider';
import { api } from '@/lib/api';
import { useLinkToken } from '@/lib/useLinkToken';
import { rememberTree } from '@/lib/currentTree';
import type { InvitationPreview } from '@/lib/types';

function InviteLanding() {
  const router = useRouter();
  const token = useLinkToken() ?? '';
  const { user, status, logout, refreshUser } = useAuth();
  const { refreshTrees } = useTrees();
  const { t, tx, formatBranch } = useI18n();

  const [preview, setPreview] = useState<InvitationPreview | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!token) {
      setLoadError(t('invite.incomplete'));
      return;
    }
    api
      .previewInvitation(token)
      .then(setPreview)
      .catch((err: Error) => setLoadError(err.message));
  }, [token, t]);

  async function accept() {
    setBusy(true);
    setActionError(null);
    try {
      const { treeId } = await api.acceptInvitationToken(token);
      rememberTree(treeId);
      // Accepting may also have verified the email; reload the user, then the trees.
      if (user?.verificationRequired) await refreshUser();
      else await refreshTrees(treeId);
      router.replace('/');
    } catch (err) {
      setActionError((err as Error).message);
      setBusy(false);
    }
  }

  if (loadError) {
    return (
      <div className="login-card">
        <h1>{t('invite.unavailable')}</h1>
        <p className="error">{loadError}</p>
        <Link href="/" className="btn block">
          {t('common.goToApp')}
        </Link>
      </div>
    );
  }
  if (!preview || status === 'loading') return <p className="muted">{t('invite.loading')}</p>;
  // Joining shows the tree's personal data: the agreement comes first. Accepting it reloads the user, so the
  // invitation shows again afterwards.
  if (user?.consentRequired && !preview.expired && user.email === preview.email) return <ConsentNotice />;

  const here = `/invite?token=${encodeURIComponent(token)}`;
  const sameEmail = user?.email === preview.email;

  return (
    <div className="login-card">
      <h1>{t('invite.title')}</h1>
      <p>
        {tx('invite.body', {
          inviter: <strong>{preview.inviterName}</strong>,
          email: <strong>{preview.email}</strong>,
          tree: <strong>{preview.treeName}</strong>,
          access: t(
            ({ admin: 'invite.accessAdmin', editor: 'invite.accessEdit', viewer: 'invite.accessView' } as const)[
              preview.role
            ],
          ),
        })}
      </p>
      {preview.role === 'editor' && preview.editScope && (
        <p className="muted small">{t('invite.branchNote', { branch: formatBranch(preview.editScope) })}</p>
      )}

      {preview.expired ? (
        <p className="error">{t('invite.expired', { inviter: preview.inviterName })}</p>
      ) : !user ? (
        <>
          <p className="muted">{t('invite.signedOut', { email: preview.email })}</p>
          <div className="provider-list">
            <Link
              className="btn primary block"
              href={`/login?mode=register&email=${encodeURIComponent(preview.email)}&invite=${encodeURIComponent(token)}`}
            >
              {t('invite.createAndJoin')}
            </Link>
            <Link className="btn" href={`/login?email=${encodeURIComponent(preview.email)}&next=${encodeURIComponent(here)}`}>
              {t('invite.haveAccount')}
            </Link>
          </div>
        </>
      ) : sameEmail ? (
        <div className="provider-list">
          <button className="btn primary block" onClick={accept} disabled={busy}>
            {busy ? t('invite.joining') : t('invite.join', { tree: preview.treeName })}
          </button>
          <Link className="btn" href="/">
            {t('invite.notNow')}
          </Link>
        </div>
      ) : (
        <>
          <p className="error">
            {t('invite.wrongAccount', { current: user.email ?? t('invite.noEmailAccount'), email: preview.email })}
          </p>
          <button className="btn block" onClick={() => void logout()}>
            {t('invite.switchAccount')}
          </button>
        </>
      )}
      {actionError && <p className="error">{actionError}</p>}
    </div>
  );
}

function Loading() {
  const { t } = useI18n();
  return <p className="muted">{t('common.loading')}</p>;
}

export default function InvitePage() {
  return (
    <div className="center">
      <Suspense fallback={<Loading />}>
        <InviteLanding />
      </Suspense>
    </div>
  );
}
