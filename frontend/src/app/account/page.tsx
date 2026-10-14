'use client';

import { useEffect, useState, type FormEvent } from 'react';
import { useAuth } from '@/components/AuthProvider';
import { useI18n } from '@/components/I18nProvider';
import RequireAuth from '@/components/RequireAuth';
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
      <Reminders email={user.email} />
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
