'use client';

import Link from 'next/link';
import { useEffect, useState, type FormEvent } from 'react';
import { useAuth } from '@/components/AuthProvider';
import { useI18n } from '@/components/I18nProvider';
import Icon from '@/components/Icon';
import RequireAuth from '@/components/RequireAuth';
import { useTrees } from '@/components/TreeProvider';
import { api, treeApi } from '@/lib/api';
import type { ReminderPreferences } from '@/lib/types';

type Notice = { text: string; error?: boolean } | null;

function ChangePasswordForm() {
  const { t } = useI18n();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<Notice>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (next !== confirm) {
      setNotice({ text: t('reset.mismatch'), error: true });
      return;
    }
    setBusy(true);
    setNotice(null);
    try {
      await api.changePassword(current, next);
      setCurrent('');
      setNext('');
      setConfirm('');
      setNotice({ text: t('account.changed') });
    } catch (err) {
      setNotice({ text: (err as Error).message, error: true });
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="form" onSubmit={submit}>
      <label>
        {t('account.currentPassword')}
        <input
          type="password"
          value={current}
          onChange={(e) => setCurrent(e.target.value)}
          autoComplete="current-password"
          maxLength={128}
          required
        />
      </label>
      <label>
        {t('reset.newPassword')}
        <input
          type="password"
          value={next}
          onChange={(e) => setNext(e.target.value)}
          autoComplete="new-password"
          minLength={8}
          maxLength={128}
          required
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
      {notice && <p className={notice.error ? 'error' : 'success'}>{notice.text}</p>}
      <button type="submit" className="btn primary block" disabled={busy}>
        {busy ? t('common.saving') : t('account.changePassword')}
      </button>
    </form>
  );
}

/** Social-login accounts have no password; a reset link lets them add one. */
function AddPassword({ email }: { email: string | null }) {
  const { t, tx } = useI18n();
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<Notice>(null);

  if (!email) return <p className="muted">{t('account.noPasswordNoEmail')}</p>;

  async function send() {
    setBusy(true);
    setNotice(null);
    try {
      await api.forgotPassword(email!);
      setNotice({ text: t('account.linkSent', { email: email! }) });
    } catch (err) {
      setNotice({ text: (err as Error).message, error: true });
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <p className="muted">{tx('account.noPassword', { email: <strong>{email}</strong> })}</p>
      {notice && <p className={notice.error ? 'error' : 'success'}>{notice.text}</p>}
      <button className="btn primary block" onClick={send} disabled={busy}>
        {busy ? t('verify.sending') : t('account.addPassword')}
      </button>
    </>
  );
}

/**
 * Death anniversary (ngày giỗ) reminder emails: on/off, how many days before, and
 * the people you turned them on for (with 🔔 on their page in the tree).
 */
function Reminders({ email }: { email: string | null }) {
  const { t, formatName, errorMessage } = useI18n();
  const [prefs, setPrefs] = useState<ReminderPreferences | null>(null);
  const [days, setDays] = useState('3');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<Notice>(null);

  useEffect(() => {
    api
      .reminderPreferences()
      .then((p) => {
        setPrefs(p);
        setDays(String(p.daysBefore));
      })
      .catch((err: Error) => setNotice({ text: err.message, error: true }));
  }, []);

  async function save(changes: { enabled?: boolean; daysBefore?: number }) {
    setBusy(true);
    setNotice(null);
    try {
      const saved = await api.updateReminderPreferences(changes);
      setPrefs(saved);
      setDays(String(saved.daysBefore));
      setNotice({ text: t('reminder.saved') });
    } catch (err) {
      setNotice({ text: errorMessage(err), error: true });
    } finally {
      setBusy(false);
    }
  }

  async function stop(person: ReminderPreferences['people'][number]) {
    setBusy(true);
    setNotice(null);
    try {
      await treeApi(person.treeId).setReminder(person.personId, false);
      setPrefs((p) => p && { ...p, people: p.people.filter((x) => x.personId !== person.personId) });
    } catch (err) {
      setNotice({ text: errorMessage(err), error: true });
    } finally {
      setBusy(false);
    }
  }

  function saveDays(e: FormEvent) {
    e.preventDefault();
    void save({ daysBefore: Number(days) });
  }

  return (
    <section className="card account-card">
      <h2>{t('reminder.title')}</h2>
      {!email ? (
        <p className="muted">{t('reminder.noEmail')}</p>
      ) : !prefs ? (
        !notice && <p className="muted">{t('common.loading')}</p>
      ) : (
        <>
          <ul className="settings-list">
            <li>
              <label className="setting">
                <span>
                  <strong>{t('reminder.enable')}</strong>
                  <span className="muted small">{t('reminder.enableHint', { email })}</span>
                </span>
                <input
                  type="checkbox"
                  role="switch"
                  className="switch"
                  checked={prefs.enabled}
                  disabled={busy}
                  onChange={(e) => void save({ enabled: e.target.checked })}
                />
              </label>
            </li>
            <li>
              <form className="setting" onSubmit={saveDays}>
                <span>
                  <strong id="days-before-label">{t('reminder.daysBefore')}</strong>
                  <span className="muted small">{t('reminder.daysHint')}</span>
                </span>
                <span className="setting-control">
                  <input
                    type="number"
                    min={0}
                    max={30}
                    value={days}
                    onChange={(e) => setDays(e.target.value)}
                    disabled={busy}
                    required
                    aria-labelledby="days-before-label"
                  />
                  <button className="btn small primary" disabled={busy || Number(days) === prefs.daysBefore}>
                    {t('common.save')}
                  </button>
                </span>
              </form>
            </li>
          </ul>

          <h3>{t('reminder.people', { count: prefs.people.length })}</h3>
          {prefs.people.length === 0 ? (
            <p className="muted small">{t('reminder.none')}</p>
          ) : (
            <ul className="reminder-list">
              {prefs.people.map((p) => (
                <li key={p.personId}>
                  <span>
                    <strong>{formatName(p)}</strong> <span className="muted small">· {p.treeName}</span>
                  </span>
                  <button className="btn small ghost" disabled={busy} onClick={() => void stop(p)}>
                    {t('reminder.stop')}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
      {notice && <p className={notice.error ? 'error' : 'success'}>{notice.text}</p>}
    </section>
  );
}

/**
 * Changing the account's email: a confirmation link goes to the new address, and
 * the old one stays until it's clicked. The current password is asked again.
 */
function ChangeEmail() {
  const { user, refreshUser } = useAuth();
  const { t, tx, errorMessage } = useI18n();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<Notice>(null);
  if (!user) return null;

  async function submit(e: FormEvent) {
    e.preventDefault();
    const address = email.trim();
    setBusy(true);
    setNotice(null);
    try {
      await api.requestEmailChange(address, user!.hasPassword ? password : undefined);
      await refreshUser(); // shows the pending address
      setEmail('');
      setPassword('');
      setNotice({ text: t('emailChange.sent', { email: address }) });
    } catch (err) {
      setNotice({ text: errorMessage(err), error: true });
    } finally {
      setBusy(false);
    }
  }

  async function cancel() {
    setBusy(true);
    setNotice(null);
    try {
      await api.cancelEmailChange();
      await refreshUser();
    } catch (err) {
      setNotice({ text: errorMessage(err), error: true });
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="card account-card">
      <h2>{t('emailChange.title')}</h2>
      <p className="muted small">
        {tx('emailChange.current', { email: <strong>{user.email ?? t('emailChange.none')}</strong> })}
      </p>
      {user.pendingEmail && (
        <div className="callout">
          <span>{tx('emailChange.pending', { email: <strong>{user.pendingEmail}</strong> })}</span>
          <button type="button" className="btn small ghost" onClick={() => void cancel()} disabled={busy}>
            {t('emailChange.cancel')}
          </button>
        </div>
      )}
      <form className="form" onSubmit={submit}>
        <label>
          {t('emailChange.newEmail')}
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" maxLength={254} required />
        </label>
        {user.hasPassword && (
          <label>
            {t('account.currentPassword')}
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
              maxLength={128}
              required
            />
          </label>
        )}
        {notice && <p className={notice.error ? 'error' : 'success'}>{notice.text}</p>}
        <button type="submit" className="btn primary block" disabled={busy}>
          {busy ? t('verify.sending') : t('emailChange.submit')}
        </button>
      </form>
      <p className="muted small">{t('emailChange.hint')}</p>
    </section>
  );
}

/**
 * Deleting the account, and with it every tree it owns. Lists the owned trees other
 * people use, so they can be handed over first. Confirmed with the password, or
 * (Google/GitHub accounts) by typing the email.
 */
function DeleteAccount() {
  const { user } = useAuth();
  const { trees } = useTrees();
  const { t, tx, errorMessage } = useI18n();
  const [open, setOpen] = useState(false);
  const [proof, setProof] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (!user) return null;

  const owned = trees.filter((tr) => tr.role === 'owner');
  const shared = owned.filter((tr) => tr.memberCount > 1);
  const confirmWith = user.email ?? user.name ?? '';

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.deleteAccount(user!.hasPassword ? { password: proof } : { confirm: proof });
      // A full reload clears everything this browser held for the account.
      window.location.href = '/login';
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  }

  return (
    <section className="card account-card danger-zone">
      <h2>{t('deleteAccount.title')}</h2>
      <p className="muted small">{t('deleteAccount.hint', { count: owned.length })}</p>
      {shared.length > 0 && (
        <div className="callout warning">
          <p>{t('deleteAccount.sharedWarning')}</p>
          <ul>
            {shared.map((tr) => (
              <li key={tr.id}>
                <strong>{tr.name}</strong> · {t('deleteAccount.otherMembers', { count: tr.memberCount - 1 })}
              </li>
            ))}
          </ul>
          <p className="small">
            {tx('deleteAccount.handOver', { share: <Link href="/share">{t('nav.share')}</Link> })}
          </p>
        </div>
      )}
      {!open ? (
        <button type="button" className="btn danger" onClick={() => setOpen(true)}>
          <Icon name="trash" />
          {t('deleteAccount.start')}
        </button>
      ) : (
        <form className="form" onSubmit={submit}>
          <label>
            {user.hasPassword ? t('account.currentPassword') : t('deleteAccount.typeEmail', { email: confirmWith })}
            <input
              type={user.hasPassword ? 'password' : 'text'}
              value={proof}
              onChange={(e) => setProof(e.target.value)}
              autoComplete={user.hasPassword ? 'current-password' : 'off'}
              maxLength={254}
              required
              autoFocus
            />
          </label>
          {error && <p className="error">{error}</p>}
          <div className="actions">
            <button type="submit" className="btn danger" disabled={busy}>
              <Icon name="trash" />
              {busy ? t('deleteAccount.deleting') : t('deleteAccount.submit')}
            </button>
            <button type="button" className="btn" onClick={() => setOpen(false)} disabled={busy}>
              {t('common.cancel')}
            </button>
          </div>
        </form>
      )}
    </section>
  );
}

function Account() {
  const { user } = useAuth();
  const { t, tx } = useI18n();
  if (!user) return null;

  return (
    <div className="page">
      <h1>{t('account.title')}</h1>
      {user.email && <p className="muted">{tx('account.signedInAs', { email: <strong>{user.email}</strong> })}</p>}
      <section className="card account-card">
        <h2>{t('account.changePassword')}</h2>
        {user.hasPassword ? <ChangePasswordForm /> : <AddPassword email={user.email} />}
      </section>
      <ChangeEmail />
      <Reminders email={user.email} />
      <DeleteAccount />
    </div>
  );
}

export default function AccountPage() {
  return (
    <RequireAuth needsTree={false}>
      <Account />
    </RequireAuth>
  );
}
