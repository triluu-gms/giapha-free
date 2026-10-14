'use client';

import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { useAuth } from '@/components/AuthProvider';
import BranchPicker, { missingBranchRoot } from '@/components/BranchPicker';
import { useI18n } from '@/components/I18nProvider';
import RequireAuth from '@/components/RequireAuth';
import { useCurrentTree } from '@/components/TreeProvider';
import { api } from '@/lib/api';
import type {
  AccessLink,
  AccessRequest,
  EditScope,
  EditScopeInput,
  Invitation,
  InviteRole,
  TreeMember,
  TreeRole,
} from '@/lib/types';

function SharePanel() {
  const { user } = useAuth();
  const { tree, canManage, isOwner, refreshTrees } = useCurrentTree();
  const { t, formatDate, formatName, formatBranch, errorMessage } = useI18n();
  const [members, setMembers] = useState<TreeMember[]>([]);
  const [invitations, setInvitations] = useState<Invitation[]>([]);
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<InviteRole>('viewer');
  // Editors only: limit them to one branch of the tree (null: the whole tree).
  const [scope, setScope] = useState<EditScopeInput | null>(null);
  // The editor whose branch is being changed in the members table.
  const [editingBranch, setEditingBranch] = useState<{ userId: string; scope: EditScopeInput | null } | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ text: string; error?: boolean } | null>(null);
  // The "request access" link and the requests it brought in.
  const [accessLink, setAccessLink] = useState<AccessLink | null>(null);
  const [linkExpiry, setLinkExpiry] = useState<'7' | '30' | 'never'>('30');
  const [copied, setCopied] = useState(false);
  const [requests, setRequests] = useState<AccessRequest[]>([]);
  // The role chosen for each request before approving it (default: view only).
  const [requestRoles, setRequestRoles] = useState<Record<string, InviteRole>>({});

  const roleText = (r: TreeRole) => t(`treeRole.${r}`);

  const load = useCallback(async () => {
    const [m, i, l, r] = await Promise.all([
      api.listMembers(tree.id),
      api.listInvitations(tree.id),
      api.getAccessLink(tree.id),
      api.listAccessRequests(tree.id),
    ]);
    setMembers(m);
    setInvitations(i);
    setAccessLink(l);
    setRequests(r);
  }, [tree.id]);

  useEffect(() => {
    // Everything here belongs to one tree: after switching trees, never show the previous tree's lists.
    setMembers([]);
    setInvitations([]);
    setAccessLink(null);
    setRequests([]);
    setRequestRoles({});
    setNotice(null);
    setScope(null); // a branch is a person of one tree
    setEditingBranch(null);
    if (canManage) load().catch((err: Error) => setNotice({ text: err.message, error: true }));
  }, [canManage, load]);

  if (!canManage) {
    return (
      <div className="center">
        <h2>{t('share.unavailableTitle')}</h2>
        <p className="muted">{t('share.unavailableBody')}</p>
      </div>
    );
  }

  async function run(action: () => Promise<unknown>, success?: string) {
    setBusy(true);
    setNotice(null);
    try {
      await action();
      if (success) setNotice({ text: success });
      await load();
    } catch (err) {
      setNotice({ text: errorMessage(err), error: true });
    } finally {
      setBusy(false);
    }
  }

  function invite(e: FormEvent) {
    e.preventDefault();
    const address = email.trim();
    const branch = role === 'editor' ? scope : null;
    if (missingBranchRoot(branch)) {
      setNotice({ text: t('branch.pickPerson'), error: true });
      return;
    }
    void run(async () => {
      await api.invite(tree.id, address, role, branch);
      setEmail('');
    }, t('share.sent', { email: address }));
  }

  function saveBranch() {
    if (!editingBranch) return;
    if (missingBranchRoot(editingBranch.scope)) {
      setNotice({ text: t('branch.pickPerson'), error: true });
      return;
    }
    const { userId, scope: branch } = editingBranch;
    void run(async () => {
      await api.updateMember(tree.id, userId, 'editor', branch);
      setEditingBranch(null);
    }, t('branch.saved'));
  }

  /** What an editor may change, under their role. */
  const branchText = (editScope: EditScope | null) => (editScope ? formatBranch(editScope) : t('branch.wholeTree'));

  // The owner manages everyone; admins manage editors and viewers (the API enforces the same).
  const manageable: TreeRole[] = isOwner ? ['admin', 'editor', 'viewer'] : ['editor', 'viewer'];
  const canManageRole = (r: TreeRole) => manageable.includes(r);

  const roleOptions = (
    <>
      <option value="viewer">{roleText('viewer')}</option>
      <option value="editor">{roleText('editor')}</option>
      {isOwner && <option value="admin">{roleText('admin')}</option>}
    </>
  );

  function makeLink() {
    if (accessLink && !confirm(t('accessLink.replaceConfirm'))) return;
    const days = linkExpiry === 'never' ? null : (Number(linkExpiry) as 7 | 30);
    void run(() => api.createAccessLink(tree.id, days), t('accessLink.created'));
  }

  function turnOffLink() {
    if (!confirm(t('accessLink.offConfirm'))) return;
    void run(() => api.revokeAccessLink(tree.id), t('accessLink.turnedOff'));
  }

  async function copyLink(url: string) {
    try {
      await navigator.clipboard.writeText(url);
    } catch {
      // No clipboard access (old browser, or not HTTPS): the field is selected for a manual copy.
      (document.getElementById('access-link-url') as HTMLInputElement | null)?.select();
      return;
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  // Approving or declining changes the count on the Share link in the header too.
  function answer(r: AccessRequest, approve: boolean) {
    const name = r.name ?? r.email ?? '';
    const role = requestRoles[r.userId] ?? 'viewer';
    void run(async () => {
      if (approve) await api.approveAccessRequest(tree.id, r.userId, role);
      else await api.declineAccessRequest(tree.id, r.userId);
      await refreshTrees(tree.id);
    }, approve ? t('accessRequest.approved', { name }) : t('accessRequest.declined', { name }));
  }

  function transfer(m: TreeMember) {
    const name = m.name ?? m.email ?? '';
    if (!confirm(t('share.makeOwnerConfirm', { name, tree: tree.name }))) return;
    void run(async () => {
      await api.transferOwnership(tree.id, m.id);
      await refreshTrees(tree.id); // you're an admin of this tree now
    }, t('share.transferred', { name }));
  }

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1>{t('share.title', { tree: tree.name })}</h1>
          <p className="muted small">{t('share.subtitle')}</p>
        </div>
      </div>

      {notice && <p className={notice.error ? 'error' : 'success'}>{notice.text}</p>}

      <section className="card">
        <h3>{t('share.inviteTitle')}</h3>
        <form className="inline-form" onSubmit={invite}>
          <input
            type="email"
            placeholder={t('share.emailPlaceholder')}
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            aria-label={t('share.emailLabel')}
          />
          <select value={role} onChange={(e) => setRole(e.target.value as InviteRole)} aria-label={t('share.access')}>
            {roleOptions}
          </select>
          <button className="btn primary" disabled={busy}>
            {t('share.send')}
          </button>
        </form>
        {role === 'editor' && <BranchPicker value={scope} onChange={setScope} disabled={busy} />}
        {role === 'admin' && <p className="muted small">{t('share.adminHint')}</p>}
        <p className="muted small">{t('share.inviteHint')}</p>
      </section>

      {requests.length > 0 && (
        <section className="card highlight">
          <h3>{t('accessRequest.title', { count: requests.length })}</h3>
          <p className="muted small">{t('accessRequest.hint')}</p>
          <ul className="request-list">
            {requests.map((r) => (
              <li key={r.userId}>
                <div className="request-who">
                  <strong>{r.name ?? r.email ?? '—'}</strong>
                  {r.name && r.email && <span className="muted small"> · {r.email}</span>}
                  <div className="muted small">{formatDate(r.createdAt)}</div>
                  {r.message && <blockquote className="request-message">{r.message}</blockquote>}
                </div>
                <div className="actions">
                  <select
                    value={requestRoles[r.userId] ?? 'viewer'}
                    disabled={busy}
                    onChange={(e) => setRequestRoles((all) => ({ ...all, [r.userId]: e.target.value as InviteRole }))}
                    aria-label={t('share.accessFor', { name: r.name ?? r.email ?? '' })}
                  >
                    {roleOptions}
                  </select>
                  <button className="btn primary" disabled={busy} onClick={() => answer(r, true)}>
                    {t('accessRequest.approve')}
                  </button>
                  <button className="btn" disabled={busy} onClick={() => answer(r, false)}>
                    {t('accessRequest.decline')}
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="card">
        <h3>{t('accessLink.title')}</h3>
        <p className="muted small">{t('accessLink.intro')}</p>
        {accessLink?.url && !accessLink.expired && (
          <>
            <div className="inline-form">
              <input id="access-link-url" readOnly value={accessLink.url} onFocus={(e) => e.target.select()} aria-label={t('accessLink.title')} />
              <button className="btn primary" type="button" onClick={() => void copyLink(accessLink.url!)}>
                {copied ? t('accessLink.copied') : t('accessLink.copy')}
              </button>
            </div>
            <p className="muted small">
              {accessLink.expiresAt
                ? t('accessLink.expires', { date: formatDate(accessLink.expiresAt) })
                : t('accessLink.noExpiry')}
              {accessLink.createdByName && ` · ${t('accessLink.createdBy', { name: accessLink.createdByName })}`}
            </p>
          </>
        )}
        {accessLink && (accessLink.expired || !accessLink.url) && (
          <p className="error small">{accessLink.expired ? t('accessLink.expiredNote') : t('accessLink.unreadable')}</p>
        )}
        <div className="actions access-link-actions">
          <select value={linkExpiry} onChange={(e) => setLinkExpiry(e.target.value as '7' | '30' | 'never')} aria-label={t('accessLink.validFor')} disabled={busy}>
            <option value="7">{t('accessLink.days', { count: 7 })}</option>
            <option value="30">{t('accessLink.days', { count: 30 })}</option>
            <option value="never">{t('accessLink.untilOff')}</option>
          </select>
          <button className="btn" type="button" onClick={makeLink} disabled={busy}>
            {accessLink ? t('accessLink.newLink') : t('accessLink.create')}
          </button>
          {accessLink && (
            <button className="btn danger" type="button" onClick={turnOffLink} disabled={busy}>
              {t('accessLink.turnOff')}
            </button>
          )}
        </div>
      </section>

      <section className="card">
        <h3>{t('share.members', { count: members.length })}</h3>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>{t('share.colName')}</th>
                <th>{t('share.colAccess')}</th>
                <th>{t('share.colSince')}</th>
                <th aria-label={t('common.actions')} />
              </tr>
            </thead>
            <tbody>
              {members.map((m) => (
                <tr key={m.id}>
                  <td>
                    <div>
                      {m.name ?? '—'} {m.id === user?.id && <span className="muted small">{t('common.you')}</span>}
                    </div>
                    <div className="muted small">{m.email}</div>
                    {m.person && <div className="muted small">{t('share.linkedTo', { name: formatName(m.person) })}</div>}
                  </td>
                  <td>
                    {!canManageRole(m.role) ? (
                      roleText(m.role)
                    ) : (
                      <select
                        value={m.role}
                        disabled={busy}
                        onChange={(e) => {
                          setEditingBranch(null);
                          // A new editor starts with the whole tree; "Change" below limits them to a branch.
                          void run(() => api.updateMember(tree.id, m.id, e.target.value as InviteRole));
                        }}
                        aria-label={t('share.accessFor', { name: m.name ?? m.email ?? '' })}
                      >
                        {roleOptions}
                      </select>
                    )}
                    {m.role === 'editor' &&
                      (editingBranch?.userId === m.id ? (
                        <div className="branch-edit">
                          <BranchPicker
                            value={editingBranch.scope}
                            onChange={(next) => setEditingBranch({ userId: m.id, scope: next })}
                            disabled={busy}
                          />
                          <div className="actions">
                            <button className="btn primary" disabled={busy} onClick={saveBranch}>
                              {t('common.save')}
                            </button>
                            <button className="btn" disabled={busy} onClick={() => setEditingBranch(null)}>
                              {t('common.cancel')}
                            </button>
                          </div>
                        </div>
                      ) : (
                        <div className="muted small">
                          {branchText(m.editScope)}{' '}
                          <button
                            className="link"
                            disabled={busy}
                            onClick={() =>
                              setEditingBranch({
                                userId: m.id,
                                scope: m.editScope && { rootId: m.editScope.rootId, depth: m.editScope.depth },
                              })
                            }
                          >
                            {t('branch.change')}
                          </button>
                        </div>
                      ))}
                  </td>
                  <td>{formatDate(m.since)}</td>
                  <td className="actions">
                    {isOwner && m.role !== 'owner' && (
                      <button className="btn" disabled={busy} onClick={() => transfer(m)} title={t('share.makeOwnerTitle')}>
                        {t('share.makeOwner')}
                      </button>
                    )}
                    {canManageRole(m.role) && (
                      <button
                        className="btn danger"
                        disabled={busy}
                        onClick={() =>
                          confirm(t('share.removeConfirm', { name: m.name ?? m.email ?? '' })) &&
                          void run(() => api.removeMember(tree.id, m.id), t('share.removed'))
                        }
                      >
                        {t('common.remove')}
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="card">
        <h3>{t('share.pending', { count: invitations.length })}</h3>
        {invitations.length === 0 ? (
          <p className="muted small">{t('share.noPending')}</p>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>{t('share.colEmail')}</th>
                  <th>{t('share.colAccess')}</th>
                  <th>{t('share.colExpires')}</th>
                  <th aria-label={t('common.actions')} />
                </tr>
              </thead>
              <tbody>
                {invitations.map((i) => (
                  <tr key={i.id}>
                    <td>{i.email}</td>
                    <td>
                      {roleText(i.role)}
                      {i.role === 'editor' && <div className="muted small">{branchText(i.editScope)}</div>}
                    </td>
                    <td>{i.expired ? <span className="error">{t('share.expired')}</span> : formatDate(i.expiresAt)}</td>
                    <td className="actions">
                      {canManageRole(i.role) && (
                        <>
                          <button
                            className="btn"
                            disabled={busy}
                            onClick={() =>
                              void run(() => api.resendInvitation(tree.id, i.id), t('share.resent', { email: i.email }))
                            }
                          >
                            {t('share.resend')}
                          </button>
                          <button
                            className="btn danger"
                            disabled={busy}
                            onClick={() => void run(() => api.revokeInvitation(tree.id, i.id), t('share.revoked'))}
                          >
                            {t('share.revoke')}
                          </button>
                        </>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

    </div>
  );
}

export default function SharePage() {
  return (
    <RequireAuth>
      <SharePanel />
    </RequireAuth>
  );
}
