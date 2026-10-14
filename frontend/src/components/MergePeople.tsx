'use client';

import { useEffect, useMemo, useState } from 'react';
import { matchesName } from '@/lib/search';
import type { Person, PersonDetail, PersonInput } from '@/lib/types';
import { useI18n } from './I18nProvider';
import { useCurrentTree } from './TreeProvider';
import { useDates } from './useDates';

// The API's maximum; the default of 500 would leave out people in big trees.
const MAX_PEOPLE = 2000;
const MAX_SHOWN = 30;

const FIELDS = ['firstName', 'lastName', 'gender', 'birthDate', 'deathDate', 'birthPlace', 'address', 'photoUrl', 'bio'] as const;
type Field = (typeof FIELDS)[number];

const present = (value: unknown) => value !== undefined && value !== null && value !== '' && value !== 'unknown';

interface Props {
  /** The person whose page this is: they are kept, the other one is merged into them. */
  detail: PersonDetail;
  onCancel: () => void;
  onMerged: (kept: Person) => void;
}

/**
 * Merges a duplicate into this person: pick the other record, choose which values
 * to keep where the two differ, then the API moves all of the other's relationships
 * (and reminders and "This is me" links) here and deletes it.
 */
export default function MergePeople({ detail, onCancel, onMerged }: Props) {
  const { treeApi: api, refreshTrees, tree } = useCurrentTree();
  const { t, formatName, formatGender, errorMessage } = useI18n();
  const { formatLifespan, formatDate } = useDates();
  const { person } = detail;
  const [people, setPeople] = useState<Person[] | null>(null);
  const [query, setQuery] = useState(() => formatName(person));
  const [other, setOther] = useState<PersonDetail | null>(null);
  const [choice, setChoice] = useState<Partial<Record<Field, 'keep' | 'other'>>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Their own parents, children and spouses can't be the same person.
  const related = useMemo(
    () => new Set([person.id, ...[...detail.parents, ...detail.children, ...detail.spouses].map((p) => p.id)]),
    [person.id, detail],
  );

  useEffect(() => {
    api
      .listPeople(undefined, MAX_PEOPLE)
      .then((all) => setPeople(all.filter((p) => !related.has(p.id))))
      .catch((err: Error) => setError(err.message));
  }, [api, related]);

  const matches = useMemo(() => (people ?? []).filter((p) => matchesName(p, query)), [people, query]);

  async function pick(id: string) {
    setError(null);
    try {
      setOther(await api.getPerson(id));
      setChoice({});
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  // Where only one of them has a value it is kept; where both differ, you choose (this person's by default).
  const conflicts = other
    ? FIELDS.filter((f) => present(person[f]) && present(other.person[f]) && person[f] !== other.person[f])
    : [];
  const resultOf = (f: Field) => {
    if (!other) return person[f];
    if (!present(person[f])) return other.person[f];
    if (!present(other.person[f])) return person[f];
    return (choice[f] ?? 'keep') === 'keep' ? person[f] : other.person[f];
  };

  async function merge() {
    if (!other) return;
    if (!confirm(t('merge.confirm', { other: formatName(other.person), keep: formatName(person) }))) return;
    const fields: PersonInput = {};
    for (const f of FIELDS) {
      const value = resultOf(f);
      if (value !== person[f]) (fields as Record<string, unknown>)[f] = value ?? null;
    }
    setBusy(true);
    setError(null);
    try {
      const kept = await api.mergePeople(person.id, other.person.id, fields);
      await refreshTrees(tree.id); // person counts
      onMerged(kept);
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  }

  const fieldLabel: Record<Field, string> = {
    firstName: t('form.firstName'),
    lastName: t('form.lastName'),
    gender: t('form.gender'),
    birthDate: t('form.born'),
    deathDate: t('form.died'),
    birthPlace: t('form.birthplace'),
    address: t('form.address'),
    photoUrl: t('form.photo'),
    bio: t('form.bio'),
  };
  const shown = (f: Field, p: Person) => {
    if (!present(p[f])) return '—';
    if (f === 'photoUrl') return t('merge.hasPhoto');
    if (f === 'gender') return formatGender(p.gender);
    if (f === 'birthDate') return formatDate(p.birthDate, 'birth'); // in the tree's calendars
    if (f === 'deathDate') return formatDate(p.deathDate, 'death');
    return String(p[f]);
  };

  return (
    <div className="merge-people">
      <h2>{t('merge.title', { name: formatName(person) })}</h2>

      {!other ? (
        <div className="person-picker">
          <p className="muted small">{t('merge.pickHint')}</p>
          <label>
            {t('merge.pickLabel')}
            <input type="search" value={query} onChange={(e) => setQuery(e.target.value)} autoComplete="off" autoFocus />
          </label>
          {!people && !error && <p className="muted small">{t('common.loading')}</p>}
          <ul className="pick-list" role="listbox" aria-label={t('merge.pickLabel')}>
            {matches.slice(0, MAX_SHOWN).map((p) => (
              <li key={p.id}>
                <button type="button" role="option" aria-selected={false} onClick={() => void pick(p.id)}>
                  <span>{formatName(p)}</span>
                  <span className="muted small">{formatLifespan(p)}</span>
                </button>
              </li>
            ))}
          </ul>
          {people && matches.length === 0 && <p className="muted small">{t('rel.noMatches')}</p>}
        </div>
      ) : (
        <>
          <p className="muted small">{t('merge.compareHint', { other: formatName(other.person) })}</p>
          <div className="table-wrap">
            <table className="merge-table">
              <thead>
                <tr>
                  <th />
                  <th>{t('merge.thisPerson')}</th>
                  <th>{t('merge.otherPerson')}</th>
                </tr>
              </thead>
              <tbody>
                {FIELDS.filter((f) => present(person[f]) || present(other.person[f])).map((f) => {
                  const conflict = conflicts.includes(f);
                  const which = choice[f] ?? 'keep';
                  return (
                    <tr key={f}>
                      <th scope="row">{fieldLabel[f]}</th>
                      {(['keep', 'other'] as const).map((side) => {
                        const p = side === 'keep' ? person : other.person;
                        return (
                          <td key={side} className={resultOf(f) === p[f] && present(p[f]) ? 'merge-kept' : undefined}>
                            {conflict ? (
                              <label className="merge-choice">
                                <input
                                  type="radio"
                                  name={`merge-${f}`}
                                  checked={which === side}
                                  onChange={() => setChoice((c) => ({ ...c, [f]: side }))}
                                />
                                {shown(f, p)}
                              </label>
                            ) : (
                              shown(f, p)
                            )}
                          </td>
                        );
                      })}
                    </tr>
                  );
                })}
                <tr>
                  <th scope="row">{t('merge.relatives')}</th>
                  {[detail, other].map((d, i) => (
                    <td key={i}>
                      {t('merge.relativesCount', {
                        parents: d.parents.length,
                        children: d.children.length,
                        spouses: d.spouses.length,
                      })}
                    </td>
                  ))}
                </tr>
              </tbody>
            </table>
          </div>
          <p className="muted small">{t('merge.whatHappens', { other: formatName(other.person) })}</p>
        </>
      )}

      {error && <p className="error">{error}</p>}
      <div className="actions">
        {other && (
          <button className="btn danger" onClick={() => void merge()} disabled={busy}>
            {busy ? t('merge.merging') : t('merge.submit')}
          </button>
        )}
        {other && (
          <button className="btn" onClick={() => setOther(null)} disabled={busy}>
            {t('merge.pickAnother')}
          </button>
        )}
        <button className="btn" onClick={onCancel} disabled={busy}>
          {t('common.cancel')}
        </button>
      </div>
    </div>
  );
}
