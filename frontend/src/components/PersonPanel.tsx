'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import type { DateKind, PersonDetail, PersonSummary, RelationshipType } from '@/lib/types';
import AddRelative from './AddRelative';
import Icon from './Icon';
import MergePeople from './MergePeople';
import MoreMenu from './MoreMenu';
import PhotoViewer from './PhotoViewer';
import { useI18n } from './I18nProvider';
import PersonForm from './PersonForm';
import { useCurrentTree } from './TreeProvider';
import { useDates } from './useDates';
import { useEditAccess } from './useEditAccess';

interface Props {
  personId: string;
  version: number; // bumps whenever the tree changes, so the panel refetches
  onSelect: (id: string) => void;
  onFocus: (id: string) => void;
  onChanged: () => void;
  onDeleted: (id: string) => void;
}

export default function PersonPanel({ personId, version, onSelect, onFocus, onChanged, onDeleted }: Props) {
  const { tree, treeApi: api, refreshTrees, canEdit, branchOnly } = useCurrentTree();
  const access = useEditAccess(version);
  const { t, tx, formatName, formatGender, errorMessage } = useI18n();
  const { formatLifespan, formatDateLong } = useDates();
  const [detail, setDetail] = useState<PersonDetail | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [merging, setMerging] = useState(false);
  const [viewingPhoto, setViewingPhoto] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoadError(null);
    api
      .getPerson(personId)
      .then((d) => !cancelled && setDetail(d))
      .catch((err: Error) => !cancelled && setLoadError(err.message));
    return () => {
      cancelled = true;
    };
  }, [api, personId, version]);

  useEffect(() => {
    setEditing(false);
    setMerging(false);
    setViewingPhoto(false);
    setActionError(null);
  }, [personId]);

  if (loadError) return <p className="error">{loadError}</p>;
  if (!detail || detail.person.id !== personId) return <p className="muted">{t('common.loading')}</p>;

  const { person } = detail;

  if (editing) {
    return (
      <PersonForm
        person={person}
        onCancel={() => setEditing(false)}
        onSaved={() => {
          setEditing(false);
          onChanged();
        }}
      />
    );
  }

  if (merging) {
    return (
      <MergePeople
        detail={detail}
        onCancel={() => setMerging(false)}
        onMerged={() => {
          setMerging(false);
          onChanged(); // the other record is gone and its relatives are now this person's
        }}
      />
    );
  }

  async function run(action: () => Promise<void>) {
    setActionError(null);
    try {
      await action();
    } catch (err) {
      setActionError(errorMessage(err));
    }
  }

  const remove = () =>
    run(async () => {
      if (!confirm(t('person.deleteConfirm', { name: formatName(person) }))) return;
      await api.deletePerson(person.id);
      onDeleted(person.id);
    });

  const isMe = tree.myPersonId === person.id;

  // "This is me" only changes your own membership, so viewers can do it too.
  const toggleMe = () =>
    run(async () => {
      if (isMe) await api.unlinkMe();
      else await api.linkMe(person.id);
      await refreshTrees(tree.id); // the tree summary carries myPersonId
    });

  // Email reminders of this person's ngày giỗ, just for you (viewers too). Needs a full death date.
  const canRemind = /^\d{4}-\d{2}-\d{2}$/.test(person.deathDate ?? '');
  const toggleReminder = () =>
    run(async () => {
      await api.setReminder(person.id, !detail.remindMe);
      setDetail({ ...detail, remindMe: !detail.remindMe });
    });

  const unlink = (type: RelationshipType, fromId: string, toId: string) =>
    run(async () => {
      await api.removeRelationship(type, fromId, toId);
      onChanged();
    });
  // Only links you're allowed to remove get an ×.
  const unlinker =
    (type: RelationshipType, from: (p: PersonSummary) => string, to: (p: PersonSummary) => string) => (p: PersonSummary) =>
    access.canLink(type, from(p), to(p)) ? () => unlink(type, from(p), to(p)) : undefined;

  const canEditThis = access.canEditPerson(person.id);
  // A branch editor can add relatives to people in their branch (AddRelative offers only what's allowed).
  const canAddRelative = access.canAddUnlinked || canEditThis;

  return (
    <div className="person-panel">
      <div className="person-header">
        {person.photoUrl && (
          <button
            type="button"
            className="avatar-button"
            onClick={() => setViewingPhoto(true)}
            aria-label={t('photo.view', { name: formatName(person) })}
            title={t('photo.view', { name: formatName(person) })}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={person.photoUrl} alt="" className="avatar" />
          </button>
        )}
        {viewingPhoto && person.photoUrl && (
          <PhotoViewer
            src={person.photoUrl}
            caption={[formatName(person), formatLifespan(person)].filter(Boolean).join(' · ')}
            onClose={() => setViewingPhoto(false)}
          />
        )}
        <div>
          <h2>
            {formatName(person)} {isMe && <span className="badge me-badge">{t('person.you')}</span>}
          </h2>
          <p className="muted">{formatLifespan(person) || t('person.datesUnknown')}</p>
        </div>
      </div>

      {/* The everyday actions; rarer and destructive ones wait behind "⋯". */}
      <div className="person-actions">
        {canEditThis && (
          <button className="btn primary" onClick={() => setEditing(true)}>
            <Icon name="edit" />
            {t('common.edit')}
          </button>
        )}
        <button className="btn" onClick={() => onFocus(person.id)} title={t('person.focusHereTitle')}>
          <Icon name="focus" />
          {t('person.focusHere')}
        </button>
        <button
          className="btn chip"
          onClick={toggleMe}
          aria-pressed={isMe}
          title={isMe ? t('person.notMeTitle') : t('person.thisIsMeTitle')}
        >
          <Icon name="user" />
          {t('person.thisIsMe')}
        </button>
        <MoreMenu
          items={[
            // Merging can move links anywhere in the tree, so not for editors limited to a branch.
            ...(canEdit && !branchOnly
              ? [{ label: t('merge.button'), icon: 'merge' as const, title: t('merge.buttonTitle'), onSelect: () => setMerging(true) }]
              : []),
            ...(access.canDeletePerson(person.id)
              ? [{ label: t('common.delete'), icon: 'trash' as const, danger: true, onSelect: () => void remove() }]
              : []),
          ]}
        />
      </div>
      {actionError && <p className="error">{actionError}</p>}

      <dl className="facts">
        <dt>{t('person.gender')}</dt>
        <dd>{formatGender(person.gender)}</dd>
        {person.birthDate && (
          <>
            <dt>{t('person.born')}</dt>
            <DateFact value={person.birthDate} kind="birth" format={formatDateLong} />
          </>
        )}
        {person.deathDate && (
          <>
            <dt>{t('person.died')}</dt>
            <DateFact value={person.deathDate} kind="death" format={formatDateLong} />
          </>
        )}
        {person.birthPlace && (
          <>
            <dt>{t('person.birthplace')}</dt>
            <dd>{person.birthPlace}</dd>
          </>
        )}
        {person.address && (
          <>
            <dt>{t('person.address')}</dt>
            <dd>{person.address}</dd>
          </>
        )}
      </dl>
      {canRemind && (
        <div className="reminder-toggle">
          <button className="btn small chip" onClick={toggleReminder} aria-pressed={detail.remindMe}>
            <Icon name="bell" />
            {detail.remindMe ? t('reminder.on') : t('reminder.turnOn')}
          </button>
          <span className="muted small">
            {tx(detail.remindMe ? 'reminder.hintOn' : 'reminder.hintOff', {
              account: <Link href="/account">{t('account.title')}</Link>,
            })}
          </span>
        </div>
      )}
      {person.bio && <p className="bio">{person.bio}</p>}

      <RelativeList title={t('person.parents')} people={detail.parents} onSelect={onSelect} remover={unlinker('PARENT_OF', (p) => p.id, () => person.id)} />
      <RelativeList title={t('person.spouses')} people={detail.spouses} onSelect={onSelect} remover={unlinker('SPOUSE_OF', () => person.id, (p) => p.id)} />
      <RelativeList title={t('person.children')} people={detail.children} onSelect={onSelect} remover={unlinker('PARENT_OF', () => person.id, (p) => p.id)} />

      {canAddRelative && <AddRelative detail={detail} access={access} onAdded={onChanged} />}
    </div>
  );
}

/** A date in the tree's calendar for that kind of date; with âm lịch, its solar date below it. */
function DateFact({
  value,
  kind,
  format,
}: {
  value: string;
  kind: DateKind;
  format: ReturnType<typeof useDates>['formatDateLong'];
}) {
  const { text, solar } = format(value, kind);
  return (
    <dd>
      {text}
      {solar && <div className="muted small">{solar}</div>}
    </dd>
  );
}

function RelativeList({
  title,
  people,
  onSelect,
  remover,
}: {
  title: string;
  /** Relatives come as summaries; clicking one loads their own details. */
  people: PersonSummary[];
  onSelect: (id: string) => void;
  /** Removes the link to that relative; undefined where you may not. */
  remover: (person: PersonSummary) => (() => void) | undefined;
}) {
  const { t, formatName } = useI18n();
  const { formatLifespan } = useDates();
  return (
    <section className="relatives">
      <h3>{title}</h3>
      {people.length === 0 ? (
        <p className="muted small">{t('person.noneRecorded')}</p>
      ) : (
        <ul>
          {people.map((p) => {
            const remove = remover(p);
            return (
              <li key={p.id}>
                <button className="link" onClick={() => onSelect(p.id)}>
                  {formatName(p)}
                </button>
                <span className="muted small">{formatLifespan(p)}</span>
                {remove && (
                  <button
                    className="icon-btn"
                    title={t('person.removeRelationship')}
                    aria-label={t('person.removeRelationshipWith', { name: formatName(p) })}
                    onClick={remove}
                  >
                    ×
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
