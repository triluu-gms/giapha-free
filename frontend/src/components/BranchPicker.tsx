'use client';

import { useEffect, useMemo, useState } from 'react';
import { matchesName } from '@/lib/search';
import { BRANCH_MAX_DEPTH, type EditScopeInput, type Person } from '@/lib/types';
import { useI18n } from './I18nProvider';
import { useCurrentTree } from './TreeProvider';
import { useDates } from './useDates';

// The API's maximum; the default of 500 would leave out people in big trees.
const MAX_PEOPLE = 2000;
const MAX_SHOWN = 8;
const DEFAULT_DEPTH = 2;
/** Generations offered below the branch's root, then "All generations". */
const DEPTHS = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, BRANCH_MAX_DEPTH];

interface Props {
  /** null: the whole tree. A branch with an empty rootId has no person chosen yet. */
  value: EditScopeInput | null;
  onChange: (value: EditScopeInput | null) => void;
  disabled?: boolean;
}

/** Chooses what an editor may change: the whole tree, or one person's branch down to some generations. */
export default function BranchPicker({ value, onChange, disabled }: Props) {
  const { treeApi } = useCurrentTree();
  const { t, formatName, formatBranchDepth } = useI18n();
  const { formatLifespan } = useDates();
  const [people, setPeople] = useState<Person[] | null>(null);
  const [query, setQuery] = useState('');
  const [error, setError] = useState<string | null>(null);

  const wantsBranch = value !== null;
  useEffect(() => {
    if (!wantsBranch || people) return;
    treeApi
      .listPeople(undefined, MAX_PEOPLE)
      .then(setPeople)
      .catch((err: Error) => setError(err.message));
  }, [treeApi, wantsBranch, people]);

  const matches = useMemo(() => (people ?? []).filter((p) => matchesName(p, query)), [people, query]);
  const root = value?.rootId ? people?.find((p) => p.id === value.rootId) : undefined;

  return (
    <div className="branch-picker">
      <label>
        {t('branch.canEdit')}
        <select
          value={value ? 'branch' : 'all'}
          disabled={disabled}
          onChange={(e) => onChange(e.target.value === 'branch' ? { rootId: '', depth: DEFAULT_DEPTH } : null)}
        >
          <option value="all">{t('branch.wholeTree')}</option>
          <option value="branch">{t('branch.oneBranch')}</option>
        </select>
      </label>

      {value && (
        <>
          <div className="person-picker">
            <label>
              {t('branch.startFrom')}
              <input
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={t('rel.searchPlaceholder')}
                autoComplete="off"
                disabled={disabled}
              />
            </label>
            {!people && !error && <p className="muted small">{t('common.loading')}</p>}
            {error && <p className="error small">{error}</p>}
            {people && (
              <ul className="pick-list" role="listbox" aria-label={t('branch.startFrom')}>
                {matches.slice(0, MAX_SHOWN).map((p) => (
                  <li key={p.id}>
                    <button
                      type="button"
                      role="option"
                      aria-selected={p.id === value.rootId}
                      className={p.id === value.rootId ? 'selected' : ''}
                      disabled={disabled}
                      onClick={() => onChange({ ...value, rootId: p.id })}
                    >
                      <span>{formatName(p)}</span>
                      <span className="muted small">{formatLifespan(p)}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
            {people && matches.length === 0 && <p className="muted small">{t('rel.noMatches')}</p>}
            {matches.length > MAX_SHOWN && (
              <p className="muted small">{t('rel.moreMatches', { count: matches.length - MAX_SHOWN })}</p>
            )}
            {root && (
              <p className="small">
                {t('rel.selected')} <strong>{formatName(root)}</strong>
              </p>
            )}
          </div>

          <label>
            {t('branch.generations')}
            <select
              value={value.depth}
              disabled={disabled}
              onChange={(e) => onChange({ ...value, depth: Number(e.target.value) })}
            >
              {DEPTHS.map((d) => (
                <option key={d} value={d}>
                  {formatBranchDepth(d, true)}
                </option>
              ))}
            </select>
          </label>
          <p className="muted small">{t('branch.hint')}</p>
        </>
      )}
    </div>
  );
}

/** A branch was chosen but not who it starts from. */
export const missingBranchRoot = (value: EditScopeInput | null) => !!value && !value.rootId;
