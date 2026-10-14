'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useState, type FormEvent } from 'react';
import { useAuth } from '@/components/AuthProvider';
import { useI18n } from '@/components/I18nProvider';
import Icon from '@/components/Icon';
import RequireAuth from '@/components/RequireAuth';
import { useCurrentTree } from '@/components/TreeProvider';
import { api } from '@/lib/api';
import type { BackupStatus, CalendarKind, DriveStatus, TreeSettings } from '@/lib/types';

type Notice = { text: string; error?: boolean } | null;

/** Your own name: every account can change it. */
function AccountSection() {
  const { user, refreshUser } = useAuth();
  const { t, errorMessage } = useI18n();
  const [name, setName] = useState(user?.name ?? '');
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<Notice>(null);

  useEffect(() => setName(user?.name ?? ''), [user?.name]);

  async function save(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    setNotice(null);
    try {
      await api.updateProfile(name.trim());
      await refreshUser(); // the header shows the name
      setNotice({ text: t('settings.nameSaved') });
    } catch (err) {
      setNotice({ text: errorMessage(err), error: true });
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="card">
      <h3>{t('settings.accountTitle')}</h3>
      <form className="inline-form" onSubmit={save}>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={100}
          required
          aria-label={t('settings.yourName')}
          placeholder={t('settings.yourName')}
          autoComplete="name"
        />
        <button className="btn primary" disabled={saving || !name.trim() || name.trim() === (user?.name ?? '')}>
          {saving ? t('common.saving') : t('common.save')}
        </button>
      </form>
      <p className="muted small">{t('settings.yourNameHint')}</p>
      {notice && <p className={notice.error ? 'error' : 'success'}>{notice.text}</p>}
    </section>
  );
}

/** The current tree's name and settings: only its owner changes them, and only this tree is affected. */
function TreeSection() {
  const { tree, treeApi, canManage, refreshTrees } = useCurrentTree();
  const { t, tx, errorMessage } = useI18n();
  const [treeName, setTreeName] = useState(tree.name);
  const [saving, setSaving] = useState<'name' | keyof TreeSettings | null>(null);
  const [notice, setNotice] = useState<Notice>(null);

  // Switching trees shows that tree's name.
  useEffect(() => {
    setTreeName(tree.name);
    setNotice(null);
  }, [tree.id, tree.name]);

  async function run(what: 'name' | keyof TreeSettings, action: () => Promise<unknown>, success: string) {
    setSaving(what);
    setNotice(null);
    try {
      await action();
      await refreshTrees(tree.id); // the tree list carries names and settings
      setNotice({ text: success });
    } catch (err) {
      setNotice({ text: errorMessage(err), error: true });
    } finally {
      setSaving(null);
    }
  }

  function rename(e: FormEvent) {
    e.preventDefault();
    void run('name', () => api.renameTree(tree.id, treeName.trim()), t('share.renamed'));
  }

  function change<K extends keyof TreeSettings>(key: K, value: TreeSettings[K]) {
    void run(key, () => treeApi.updateSettings({ [key]: value }), t('settings.saved'));
  }

  return (
    <section className="card">
      <h3>{t('settings.treeTitle')}</h3>
      {!canManage ? (
        <p className="muted">{t('settings.notManager')}</p>
      ) : (
        <>
          <p className="muted small">{tx('settings.intro', { name: <strong>{tree.name}</strong> })}</p>
          <form className="inline-form" onSubmit={rename}>
            <input
              value={treeName}
              onChange={(e) => setTreeName(e.target.value)}
              maxLength={100}
              required
              aria-label={t('share.nameLabel')}
              placeholder={t('share.nameLabel')}
            />
            <button className="btn primary" disabled={!!saving || !treeName.trim() || treeName.trim() === tree.name}>
              {saving === 'name' ? t('common.saving') : t('share.rename')}
            </button>
          </form>
          <p className="muted small">{t('share.nameHint')}</p>

          <ul className="settings-list">
            <li>
              <label className="setting">
                <span>
                  <strong>{t('settings.bulkDelete')}</strong>
                  <span className="muted small">{t('settings.bulkDeleteHint')}</span>
                </span>
                <input
                  type="checkbox"
                  role="switch"
                  className="switch"
                  checked={tree.settings.bulkDelete}
                  disabled={saving === 'bulkDelete'}
                  onChange={(e) => change('bulkDelete', e.target.checked)}
                />
              </label>
            </li>
            {(['birthCalendar', 'deathCalendar'] as const).map((key) => (
              <li key={key}>
                <div className="setting">
                  <span>
                    <strong id={`${key}-label`}>{t(`settings.${key}`)}</strong>
                    <span className="muted small">{t(`settings.${key}Hint`)}</span>
                  </span>
                  <select
                    aria-labelledby={`${key}-label`}
                    value={tree.settings[key]}
                    disabled={saving === key}
                    onChange={(e) => change(key, e.target.value as CalendarKind)}
                  >
                    <option value="solar">{t('settings.calendarSolar')}</option>
                    <option value="lunisolar">{t('settings.calendarLunisolar')}</option>
                  </select>
                </div>
              </li>
            ))}
          </ul>
          <p className="muted small">{t('settings.calendarHint')}</p>
        </>
      )}
      {notice && <p className={notice.error ? 'error' : 'success'}>{notice.text}</p>}
    </section>
  );
}

const DRIVE_RESULTS = ['connected', 'cancelled', 'noAccess', 'expired', 'failed'] as const;
type DriveResult = (typeof DRIVE_RESULTS)[number];

/**
 * Downloading the tree's data, and scheduled backups to the Google Drive of an
 * admin: a CSV in the import template's format plus a full JSON file, each time.
 */
function BackupSection() {
  const { tree, treeApi } = useCurrentTree();
  const { user } = useAuth();
  const { t, tx, locale, errorMessage } = useI18n();
  const router = useRouter();
  const params = useSearchParams();
  const [drive, setDrive] = useState<DriveStatus | null>(null);
  const [status, setStatus] = useState<BackupStatus | null>(null);
  const [frequency, setFrequency] = useState<BackupStatus['frequency']>('off');
  const [keep, setKeep] = useState(10);
  const [busy, setBusy] = useState<'save' | 'run' | 'disconnect' | null>(null);
  const [notice, setNotice] = useState<Notice>(null);

  // Coming back from Google's consent screen: say how it went, then tidy the URL.
  const driveResult = params.get('drive');
  useEffect(() => {
    if (!driveResult || !DRIVE_RESULTS.includes(driveResult as DriveResult)) return;
    setNotice({ text: t(`backup.drive.${driveResult as DriveResult}`), error: driveResult !== 'connected' });
    router.replace('/settings');
  }, [driveResult, router, t]);

  useEffect(() => {
    let cancelled = false;
    Promise.all([api.driveStatus(), treeApi.backupStatus()])
      .then(([d, s]) => {
        if (cancelled) return;
        setDrive(d);
        setStatus(s);
        setFrequency(s.frequency);
        setKeep(s.keep);
      })
      .catch((err) => !cancelled && setNotice({ text: errorMessage(err), error: true }));
    return () => {
      cancelled = true;
    };
  }, [treeApi, errorMessage]);

  async function act(what: 'save' | 'run' | 'disconnect', action: () => Promise<void>, success?: string) {
    setBusy(what);
    setNotice(null);
    try {
      await action();
      if (success) setNotice({ text: success });
    } catch (err) {
      setNotice({ text: errorMessage(err), error: true });
    } finally {
      setBusy(null);
    }
  }

  const save = (e: FormEvent) => {
    e.preventDefault();
    void act(
      'save',
      async () => {
        const s = await treeApi.updateBackup({ frequency, keep });
        setStatus(s);
      },
      t('backup.saved'),
    );
  };

  const runNow = () =>
    act('run', async () => {
      const s = await treeApi.runBackup();
      setStatus(s);
      setNotice(
        s.lastStatus === 'ok'
          ? { text: t('backup.ranOk') }
          : { text: t(`error.${s.lastError ?? 'backupFailed'}`), error: true },
      );
    });

  const disconnect = () => {
    if (!window.confirm(t('backup.disconnectConfirm'))) return;
    void act(
      'disconnect',
      async () => {
        await api.disconnectDrive();
        setDrive((d) => (d ? { ...d, connection: null } : d));
      },
      t('backup.disconnected'),
    );
  };

  const when = (iso: string | null) =>
    iso ? new Date(iso).toLocaleString(locale === 'vi' ? 'vi-VN' : 'en-GB', { dateStyle: 'medium', timeStyle: 'short' }) : '';
  const connected = !!drive?.connection;
  const someoneElse = status?.owner && status.owner.id !== user?.id ? status.owner : null;
  const unchanged = status !== null && frequency === status.frequency && keep === status.keep && !someoneElse;

  return (
    <section className="card">
      <h3>{t('backup.title')}</h3>
      <p className="muted small">{t('backup.intro')}</p>
      <div className="actions">
        <a className="btn" href={treeApi.exportUrl('csv')} download>
          <Icon name="download" />
          {t('backup.downloadCsv')}
        </a>
        <a className="btn" href={treeApi.exportUrl('json')} download>
          <Icon name="download" />
          {t('backup.downloadJson')}
        </a>
      </div>

      <h4>{t('backup.driveTitle')}</h4>
      {!drive || !status ? (
        <p className="muted">{t('common.loading')}</p>
      ) : !drive.configured ? (
        <p className="muted small">{t('backup.notConfigured')}</p>
      ) : (
        <>
          <div className="setting">
            <span>
              <strong>{t('backup.yourDrive')}</strong>
              <span className="muted small">
                {connected ? t('backup.connectedAs', { email: drive.connection!.email ?? '?' }) : t('backup.connectHint')}
              </span>
            </span>
            {connected ? (
              <button type="button" className="btn" onClick={disconnect} disabled={busy !== null}>
                {busy === 'disconnect' ? t('common.pleaseWait') : t('backup.disconnect')}
              </button>
            ) : (
              <a className="btn primary" href={api.driveConnectUrl('/settings')}>
                {t('backup.connect')}
              </a>
            )}
          </div>

          {someoneElse && (
            <p className="callout">
              {t('backup.otherOwner', {
                name: someoneElse.name ?? '?',
                email: someoneElse.driveEmail ?? '?',
              })}
            </p>
          )}

          <form className="backup-form" onSubmit={save}>
            <label>
              {t('backup.frequency')}
              <select value={frequency} onChange={(e) => setFrequency(e.target.value as BackupStatus['frequency'])}>
                {(['off', 'manual', 'daily', 'weekly', 'monthly'] as const).map((f) => (
                  <option key={f} value={f}>
                    {t(`backup.freq.${f}`)}
                  </option>
                ))}
              </select>
            </label>
            <label>
              {t('backup.keep')}
              <input
                type="number"
                min={1}
                max={100}
                value={keep}
                onChange={(e) => setKeep(Math.min(100, Math.max(1, Number(e.target.value) || 1)))}
                disabled={frequency === 'off'}
              />
            </label>
            <button
              className="btn primary"
              disabled={busy !== null || unchanged || (frequency !== 'off' && !connected)}
            >
              {busy === 'save' ? t('common.saving') : t('common.save')}
            </button>
          </form>
          {frequency !== 'off' && !connected && <p className="muted small">{t('backup.connectFirst')}</p>}

          {status.frequency !== 'off' && (
            <div className="backup-status">
              <p className="small">
                {status.lastRunAt
                  ? tx(status.lastStatus === 'ok' ? 'backup.lastOk' : 'backup.lastError', {
                      when: <strong>{when(status.lastRunAt)}</strong>,
                      error: status.lastError ? t(`error.${status.lastError}`) : '',
                    })
                  : t('backup.never')}
              </p>
              {status.nextRunAt && (
                <p className="muted small">{t('backup.next', { when: when(status.nextRunAt) })}</p>
              )}
              <div className="actions">
                <button type="button" className="btn" onClick={() => void runNow()} disabled={busy !== null}>
                  {busy === 'run' ? t('backup.running') : t('backup.runNow')}
                </button>
                {status.folderUrl && (
                  <a className="btn" href={status.folderUrl} target="_blank" rel="noreferrer">
                    {t('backup.openFolder')}
                  </a>
                )}
              </div>
            </div>
          )}
        </>
      )}
      {notice && <p className={notice.error ? 'error' : 'success'}>{notice.text}</p>}
    </section>
  );
}

/** Deleting the current tree: its owner only, confirmed by typing the tree's name. */
function DeleteTreeSection() {
  const { tree, refreshTrees } = useCurrentTree();
  const { t, errorMessage } = useI18n();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function remove() {
    const typed = window.prompt(t('settings.deleteTreeConfirm', { name: tree.name, count: tree.personCount }));
    if (typed === null) return;
    if (typed.trim() !== tree.name.trim()) {
      setError(t('settings.deleteTreeMismatch'));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await api.deleteTree(tree.id);
      await refreshTrees(); // falls back to another of your trees (or a new, empty one)
      router.push('/');
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  }

  return (
    <section className="card danger-zone">
      <h3>{t('settings.deleteTreeTitle')}</h3>
      <p className="muted small">{t('settings.deleteTreeHint', { count: tree.memberCount - 1 })}</p>
      <button className="btn danger" onClick={remove} disabled={busy}>
        <Icon name="trash" />
        {busy ? t('settings.deletingTree') : t('settings.deleteTree')}
      </button>
      {error && <p className="error">{error}</p>}
    </section>
  );
}

function SettingsPanel() {
  const { tree, isOwner, canManage } = useCurrentTree();
  const { t } = useI18n();
  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1>{t('settings.title')}</h1>
          <p className="muted small">{tree.name}</p>
        </div>
      </div>
      <AccountSection />
      <TreeSection />
      {canManage && (
        // useSearchParams (the ?drive= result) needs a Suspense boundary in the App Router.
        <Suspense fallback={null}>
          <BackupSection key={tree.id} />
        </Suspense>
      )}
      {isOwner && <DeleteTreeSection />}
    </div>
  );
}

export default function SettingsPage() {
  return (
    <RequireAuth>
      <SettingsPanel />
    </RequireAuth>
  );
}
