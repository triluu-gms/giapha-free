'use client';

import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { isTooYoungToBeParent, MIN_PARENT_AGE } from '@/lib/rules';
import { matchesName } from '@/lib/search';
import type { Gender, Person, PersonDetail } from '@/lib/types';
import DateInput from './DateInput';
import { useI18n } from './I18nProvider';
import { GenderSelect } from './PersonForm';
import { useCurrentTree } from './TreeProvider';
import { useDates } from './useDates';
import type { EditAccess } from './useEditAccess';

type Relation = 'parent' | 'child' | 'spouse';
type Mode = 'new' | 'existing';

// The API's maximum; the default of 500 would leave out people in big trees.
const MAX_PEOPLE = 2000;
// Rows rendered at once; typing more of the name narrows the rest.
const MAX_SHOWN = 50;

interface Props {
  detail: PersonDetail;
  /** What you may change; an editor limited to a branch gets only the options that keep within it. */
  access: EditAccess;
  onAdded: () => void;
}

export default function AddRelative({ detail, access, onAdded }: Props) {
  const { treeApi: api } = useCurrentTree();
  const { t, locale, formatName, errorMessage } = useI18n();
  const { formatLifespan } = useDates();
  const { person } = detail;

  // A new person must land inside your branch: a child (within its generations) or spouse of someone in it.
  const canAddNew = (r: Relation) =>
    r === 'child' ? access.canAddChild(person.id) : r === 'spouse' ? access.canAddSpouse(person.id) : access.canAddUnlinked;
  const canLinkTo = (r: Relation, otherId: string) =>
    r === 'parent'
      ? access.canLink('PARENT_OF', otherId, person.id)
      : r === 'child'
        ? access.canLink('PARENT_OF', person.id, otherId)
        : access.canLink('SPOUSE_OF', person.id, otherId);

  const [relation, setRelation] = useState<Relation>('child');
  const [mode, setMode] = useState<Mode>('new');
  // Switching to a relation you can't create someone new for picks an existing person instead.
  const effectiveMode: Mode = canAddNew(relation) ? mode : 'existing';
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState(person.lastName ?? '');
  const [gender, setGender] = useState<Gender>('unknown');
  const [birthDate, setBirthDate] = useState('');
  const [birthPlace, setBirthPlace] = useState('');
  const [existingId, setExistingId] = useState('');
  const [candidates, setCandidates] = useState<Person[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [query, setQuery] = useState('');

  useEffect(() => {
    if (effectiveMode !== 'existing') return;
    const related = new Set([person.id, ...[...detail.parents, ...detail.children, ...detail.spouses].map((p) => p.id)]);
    api
      .listPeople(undefined, MAX_PEOPLE)
      .then((all) => setCandidates(all.filter((p) => !related.has(p.id))))
      .catch((err: Error) => setError(err.message));
  }, [api, effectiveMode, detail, person.id]);

  // Filtered in the browser, so it is instant and ignores accents and word order.
  // Editors limited to a branch only see people they may link this way.
  const matches = useMemo(
    () => candidates.filter((p) => canLinkTo(relation, p.id) && matchesName(p, query)),
    [candidates, query, relation, access, person.id], // everything canLinkTo reads
  );
  // Why someone can't be linked this way (the API enforces the same rule), or null.
  const blockedReason = (p: Person): string | null => {
    if (relation === 'parent' && isTooYoungToBeParent(p.birthDate, person.birthDate)) {
      return t('rel.parentTooYoung', { min: MIN_PARENT_AGE });
    }
    if (relation === 'child' && isTooYoungToBeParent(person.birthDate, p.birthDate)) {
      return t('rel.childTooOld', { min: MIN_PARENT_AGE });
    }
    return null;
  };
  const found = candidates.find((p) => p.id === existingId);
  // Switching the relation can make the chosen person invalid.
  const selected = found && !blockedReason(found) ? found : undefined;

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      if (effectiveMode === 'new') {
        const born = birthDate.trim() || undefined;
        if (blockedReason({ id: '', firstName: '', birthDate: born })) {
          throw new Error(t('error.parentTooYoung', { min: MIN_PARENT_AGE }));
        }
        // Created and linked in one request, so a refused link never leaves an unlinked person behind.
        await api.createPerson(
          {
            firstName: firstName.trim(),
            lastName: lastName.trim() || undefined,
            gender,
            birthDate: born,
            birthPlace: birthPlace.trim() || undefined,
          },
          { relation, personId: person.id },
        );
      } else if (relation === 'parent') await api.addRelationship('PARENT_OF', existingId, person.id);
      else if (relation === 'child') await api.addRelationship('PARENT_OF', person.id, existingId);
      else await api.addRelationship('SPOUSE_OF', person.id, existingId);

      setFirstName('');
      setBirthDate('');
      setBirthPlace('');
      setExistingId('');
      setQuery('');
      onAdded();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  const firstNameField = (
    <label key="first">
      {t('form.firstName')}
      <input value={firstName} onChange={(e) => setFirstName(e.target.value)} required />
    </label>
  );
  const lastNameField = (
    <label key="last">
      {t('form.lastName')}
      <input value={lastName} onChange={(e) => setLastName(e.target.value)} />
    </label>
  );

  return (
    <form className="form add-relative" onSubmit={submit}>
      <h3>{t('rel.title')}</h3>
      <div className="row">
        <label>
          {t('rel.relation')}
          <select value={relation} onChange={(e) => setRelation(e.target.value as Relation)}>
            <option value="child">{t('rel.child')}</option>
            <option value="parent">{t('rel.parent')}</option>
            <option value="spouse">{t('rel.spouse')}</option>
          </select>
        </label>
        <label>
          {t('rel.who')}
          <select value={effectiveMode} onChange={(e) => setMode(e.target.value as Mode)}>
            <option value="new" disabled={!canAddNew(relation)}>
              {t('rel.new')}
            </option>
            <option value="existing">{t('rel.existing')}</option>
          </select>
        </label>
      </div>
      {!canAddNew(relation) && !access.canAddUnlinked && <p className="muted small">{t('rel.branchNewHint')}</p>}

      {effectiveMode === 'new' ? (
        <>
          <div className="row">{locale === 'vi' ? [lastNameField, firstNameField] : [firstNameField, lastNameField]}</div>
          <div className="row">
            <label>
              {t('form.gender')}
              <GenderSelect value={gender} onChange={(e) => setGender(e.target.value as Gender)} />
            </label>
            <DateInput label={t('form.born')} kind="birth" value={birthDate} onChange={setBirthDate} />
          </div>
          <label>
            {t('form.birthplace')}
            <input value={birthPlace} onChange={(e) => setBirthPlace(e.target.value)} />
          </label>
        </>
      ) : (
        <div className="person-picker">
          <label>
            {t('rel.person')}
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t('rel.searchPlaceholder')}
              autoComplete="off"
            />
          </label>
          <ul className="pick-list" role="listbox" aria-label={t('rel.person')}>
            {matches.slice(0, MAX_SHOWN).map((p) => {
              const reason = blockedReason(p);
              return (
                <li key={p.id}>
                  <button
                    type="button"
                    role="option"
                    aria-selected={p.id === existingId && !reason}
                    aria-disabled={!!reason}
                    className={p.id === existingId && !reason ? 'selected' : ''}
                    disabled={!!reason}
                    title={reason ?? undefined}
                    onClick={() => setExistingId(p.id)}
                  >
                    <span>{formatName(p)}</span>
                    <span className="muted small">{reason ?? formatLifespan(p)}</span>
                  </button>
                </li>
              );
            })}
          </ul>
          {matches.length === 0 && <p className="muted small">{t('rel.noMatches')}</p>}
          {matches.length > MAX_SHOWN && (
            <p className="muted small">{t('rel.moreMatches', { count: matches.length - MAX_SHOWN })}</p>
          )}
          {selected && (
            <p className="small">
              {t('rel.selected')} <strong>{formatName(selected)}</strong>
            </p>
          )}
        </div>
      )}

      {error && <p className="error">{error}</p>}
      <div className="actions">
        <button type="submit" className="btn primary" disabled={busy || (effectiveMode === 'existing' && !selected)}>
          {busy ? t('rel.adding') : t(`rel.add.${relation}`)}
        </button>
      </div>
    </form>
  );
}
