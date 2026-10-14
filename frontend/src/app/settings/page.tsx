'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState, type FormEvent } from 'react';
import { useAuth } from '@/components/AuthProvider';
import { useI18n } from '@/components/I18nProvider';
import Icon from '@/components/Icon';
import RequireAuth from '@/components/RequireAuth';
import { useCurrentTree } from '@/components/TreeProvider';
import { api } from '@/lib/api';
import type { CalendarKind, TreeSettings } from '@/lib/types';

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
  const { tree, isOwner } = useCurrentTree();
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
