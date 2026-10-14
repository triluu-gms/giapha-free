'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import type { Invitation } from '@/lib/types';
import { useI18n } from './I18nProvider';
import { useTrees } from './TreeProvider';

/** Banner listing invitations sent to the signed-in user's email, with accept/decline. */
export default function PendingInvitations() {
  const { refreshTrees } = useTrees();
  const { t, tx, formatBranch } = useI18n();
  const [invitations, setInvitations] = useState<Invitation[]>([]);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .myInvitations()
      .then(setInvitations)
      .catch(() => setInvitations([]));
  }, []);

  if (invitations.length === 0) return null;

  async function respond(invitation: Invitation, accept: boolean) {
    setBusyId(invitation.id);
    setError(null);
    try {
      if (accept) {
        const { treeId } = await api.acceptInvitation(invitation.id);
        await refreshTrees(treeId);
      } else {
        await api.declineInvitation(invitation.id);
      }
      setInvitations((list) => list.filter((i) => i.id !== invitation.id));
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="invite-banner" role="status">
      {invitations.map((inv) => (
        <div key={inv.id} className="invite-banner-row">
          <span>
            {tx('pending.invited', { inviter: <strong>{inv.inviterName}</strong>, tree: <strong>{inv.treeName}</strong> })}
            <span className="muted small">
              {' · '}
              {inv.role === 'admin'
                ? t('pending.admin')
                : inv.role !== 'editor'
                  ? t('pending.viewOnly')
                  : inv.editScope
                    ? t('pending.canEditBranch', { branch: formatBranch(inv.editScope) })
                    : t('pending.canEdit')}
            </span>
          </span>
          <span className="actions">
            <button className="btn primary" disabled={busyId === inv.id} onClick={() => respond(inv, true)}>
              {t('pending.accept')}
            </button>
            <button className="btn" disabled={busyId === inv.id} onClick={() => respond(inv, false)}>
              {t('pending.decline')}
            </button>
          </span>
        </div>
      ))}
      {error && <p className="error small">{error}</p>}
    </div>
  );
}
