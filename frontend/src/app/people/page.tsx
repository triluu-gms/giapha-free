'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { useI18n } from '@/components/I18nProvider';
import RequireAuth from '@/components/RequireAuth';
import { useCurrentTree } from '@/components/TreeProvider';
import { useDates } from '@/components/useDates';
import { useEditAccess } from '@/components/useEditAccess';
import { requestSelection } from '@/lib/selection';
import type { Person } from '@/lib/types';

/** Matches PERSON_BULK_DELETE_MAX in the API; larger selections are sent in batches. */
const DELETE_BATCH = 1000;
/** Names listed in the confirmation before "and N more". */
const CONFIRM_NAMES = 5;

export default function PeoplePage() {
  return (
    <RequireAuth>
      <PeopleList />
    </RequireAuth>
  );
}

function PeopleList() {
  const { tree, treeApi: api, canEdit, refreshTrees } = useCurrentTree();
  const { t, formatName, formatGender, errorMessage } = useI18n();
  const { formatDate } = useDates(); // the tree's calendar
  // Bulk delete is a setting of this tree (see /settings).
  const canBulkDelete = canEdit && tree.settings.bulkDelete;
  const [search, setSearch] = useState('');
  const [people, setPeople] = useState<Person[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [deleting, setDeleting] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const selectAll = useRef<HTMLInputElement>(null);
  // Editors limited to a branch can only select people in it.
  const access = useEditAccess(reloadKey);

  useEffect(() => {
    let cancelled = false;
    const timer = setTimeout(() => {
      api
        .listPeople(search.trim())
        .then((rows) => {
          if (cancelled) return;
          setPeople(rows);
          setError(null);
          // Only people still listed can stay selected, so nothing hidden by the search gets deleted.
          setSelected((prev) => new Set(rows.filter((p) => prev.has(p.id)).map((p) => p.id)));
        })
        .catch((err: Error) => !cancelled && setError(err.message));
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [api, search, reloadKey]);

  // Switching trees starts with nothing selected.
  useEffect(() => setSelected(new Set()), [tree.id]);

  const shown = people ?? [];
  const selectable = shown.filter((p) => access.canDeletePerson(p.id));
  const allSelected = selectable.length > 0 && selectable.every((p) => selected.has(p.id));
  const someSelected = selected.size > 0 && !allSelected;

  useEffect(() => {
    if (selectAll.current) selectAll.current.indeterminate = someSelected;
  }, [someSelected]);

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleAll() {
    setSelected(allSelected ? new Set() : new Set(selectable.map((p) => p.id)));
  }

  async function deleteSelected() {
    const victims = shown.filter((p) => selected.has(p.id));
    if (!victims.length) return;
    const count = victims.length;
    const listed = victims.slice(0, CONFIRM_NAMES).map((p) => formatName(p)).join(', ');
    const names = count > CONFIRM_NAMES ? t('people.andMore', { names: listed, count: count - CONFIRM_NAMES }) : listed;
    if (!window.confirm(t(count === 1 ? 'people.deleteConfirm_one' : 'people.deleteConfirm_other', { count, names }))) {
      return;
    }

    setDeleting(true);
    setError(null);
    setNotice(null);
    let deleted = 0;
    try {
      const ids = victims.map((p) => p.id);
      for (let i = 0; i < ids.length; i += DELETE_BATCH) {
        deleted += (await api.deletePeople(ids.slice(i, i + DELETE_BATCH))).deleted;
      }
      setSelected(new Set());
    } catch (err) {
      setError(errorMessage(err));
      // The tree's owner may have just turned bulk delete off; refreshTrees below picks that up.
      if ((err as { code?: string }).code === 'bulkDeleteDisabled') setSelected(new Set());
    } finally {
      if (deleted) setNotice(t(deleted === 1 ? 'people.deleted_one' : 'people.deleted_other', { count: deleted }));
      setDeleting(false);
      setReloadKey((k) => k + 1);
      void refreshTrees(tree.id); // person counts
    }
  }

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1>{t('people.title')}</h1>
          <p className="muted small">{tree.name}</p>
        </div>
        <input
          type="search"
          placeholder={t('people.search')}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          aria-label={t('people.searchLabel')}
        />
      </div>

      {canBulkDelete && selected.size > 0 && (
        <div className="selection-bar" role="region" aria-live="polite">
          <span>
            {t(selected.size === 1 ? 'people.selected_one' : 'people.selected_other', { count: selected.size })}
          </span>
          <button className="btn" onClick={() => setSelected(new Set())} disabled={deleting}>
            {t('people.clearSelection')}
          </button>
          <button className="btn danger" onClick={deleteSelected} disabled={deleting}>
            {deleting ? t('people.deleting') : t('people.deleteSelected')}
          </button>
        </div>
      )}

      {notice && <p className="success">{notice}</p>}
      {error && <p className="error">{error}</p>}
      {!people && !error && <p className="muted">{t('common.loading')}</p>}
      {people?.length === 0 && <p className="muted">{t('people.none')}</p>}

      {people && people.length > 0 && (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                {canBulkDelete && (
                  <th className="check-cell">
                    <input
                      ref={selectAll}
                      type="checkbox"
                      checked={allSelected}
                      onChange={toggleAll}
                      disabled={deleting || selectable.length === 0}
                      aria-label={t('people.selectAll')}
                      title={t('people.selectAll')}
                    />
                  </th>
                )}
                <th>{t('people.name')}</th>
                <th>{t('person.gender')}</th>
                <th>{t('person.born')}</th>
                <th>{t('person.died')}</th>
                <th>{t('person.birthplace')}</th>
              </tr>
            </thead>
            <tbody>
              {people.map((p) => {
                const name = formatName(p);
                const isSelected = selected.has(p.id);
                return (
                  <tr key={p.id} className={isSelected ? 'selected-row' : undefined}>
                    {canBulkDelete && (
                      <td className="check-cell">
                        <input
                          type="checkbox"
                          checked={isSelected}
                          onChange={() => toggle(p.id)}
                          disabled={deleting || !access.canDeletePerson(p.id)}
                          aria-label={t('people.selectPerson', { name })}
                        />
                      </td>
                    )}
                    <td>
                      <Link href="/" onClick={() => requestSelection(p.id)}>
                        {name}
                      </Link>
                    </td>
                    <td>{formatGender(p.gender)}</td>
                    <td>{formatDate(p.birthDate, 'birth')}</td>
                    <td>{formatDate(p.deathDate, 'death')}</td>
                    <td>{p.birthPlace ?? '—'}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
