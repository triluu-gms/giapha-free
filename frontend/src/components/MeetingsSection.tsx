'use client';

import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { lunarOf, solarIsoOf } from '@/lib/lunar';
import {
  lunarLabel,
  lunarMonthName,
  nextOccurrence,
  ruleLabel,
  solarLabel,
  vietnamToday,
  weekdayName,
  weekName,
  WEEKS,
} from '@/lib/meetings';
import { listChi } from '@/lib/reportTree';
import type { CalendarKind, Meeting, MeetingInput, TreeData } from '@/lib/types';
import { useI18n } from './I18nProvider';
import Icon from './Icon';
import { useCurrentTree } from './TreeProvider';
import { useLayoutPrefs } from './useLayoutPrefs';

type Notice = { text: string; error?: boolean } | null;

/** The form's fields; a one-off lunar date is entered as day, month and lunar year. */
interface FormState {
  title: string;
  chiRootId: string;
  repeat: 'yearly' | 'once';
  calendar: CalendarKind;
  /** A yearly meeting: on a day of the month, or on the `week`-th `weekday` of it. */
  by: 'day' | 'weekday';
  day: number;
  weekday: number;
  week: number;
  month: number;
  /** A one-off meeting: its solar date, or (lunar) its lunar year. */
  date: string;
  lunarYear: number;
  time: string;
  place: string;
  note: string;
}

const range = (from: number, to: number) => Array.from({ length: to - from + 1 }, (_, i) => from + i);

function formFor(meeting: Meeting | null, defaultTitle: string, today: string): FormState {
  const lunarToday = lunarOf(today)!;
  if (!meeting) {
    return {
      title: defaultTitle,
      chiRootId: '',
      repeat: 'yearly',
      calendar: 'lunisolar',
      by: 'day',
      day: 10,
      weekday: 0,
      week: 3,
      month: 1,
      date: today,
      lunarYear: lunarToday.year,
      time: '',
      place: '',
      note: '',
    };
  }
  const onceLunar = meeting.repeat === 'once' && meeting.date ? lunarOf(meeting.date) : null;
  return {
    title: meeting.title,
    chiRootId: meeting.chiRootId ?? '',
    repeat: meeting.repeat,
    calendar: meeting.repeat === 'yearly' ? meeting.calendar : 'solar',
    by: meeting.weekday != null ? 'weekday' : 'day',
    day: meeting.day ?? onceLunar?.day ?? 1,
    weekday: meeting.weekday ?? 0,
    week: meeting.week ?? 3,
    month: meeting.month ?? onceLunar?.month ?? 1,
    date: meeting.date ?? today,
    lunarYear: onceLunar?.year ?? lunarToday.year,
    time: meeting.time ?? '',
    place: meeting.place ?? '',
    note: meeting.note ?? '',
  };
}

/** What gets saved; null when a one-off lunar date doesn't exist. */
function inputOf(f: FormState): MeetingInput | null {
  const common = {
    title: f.title.trim(),
    chiRootId: f.chiRootId || null,
    time: f.time || null,
    place: f.place.trim() || null,
    note: f.note.trim() || null,
  };
  if (f.repeat === 'yearly') {
    const byWeekday = f.by === 'weekday';
    return {
      ...common,
      repeat: 'yearly',
      calendar: f.calendar,
      month: f.month,
      day: byWeekday ? null : f.day,
      weekday: byWeekday ? f.weekday : null,
      week: byWeekday ? f.week : null,
      date: null,
    };
  }
  const date = f.calendar === 'lunisolar' ? solarIsoOf({ day: f.day, month: f.month, year: f.lunarYear, leap: false }) : f.date;
  return date ? { ...common, repeat: 'once', calendar: 'solar', day: null, month: null, weekday: null, week: null, date } : null;
}

function MeetingForm({
  meeting,
  chiOptions,
  onSaved,
  onCancel,
}: {
  meeting: Meeting | null;
  chiOptions: { id: string; label: string }[];
  onSaved: () => void;
  onCancel: () => void;
}) {
  const { t, locale, errorMessage } = useI18n();
  const { treeApi } = useCurrentTree();
  const today = vietnamToday();
  const [f, setF] = useState<FormState>(() => formFor(meeting, t('meeting.defaultTitle'), today));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = <K extends keyof FormState>(key: K, value: FormState[K]) => setF((s) => ({ ...s, [key]: value }));

  const input = inputOf(f);
  const next = input && nextOccurrence(input, today);
  const lunar = f.calendar === 'lunisolar';

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!input) return setError(t('meeting.badLunar'));
    setBusy(true);
    setError(null);
    try {
      if (meeting) await treeApi.updateMeeting(meeting.id, input);
      else await treeApi.createMeeting(input);
      onSaved();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="form meeting-form" onSubmit={submit}>
      <label>
        {t('meeting.name')}
        <input value={f.title} onChange={(e) => set('title', e.target.value)} maxLength={120} required />
      </label>
      <label>
        {t('meeting.for')}
        <select value={f.chiRootId} onChange={(e) => set('chiRootId', e.target.value)}>
          <option value="">{t('meeting.wholeTree')}</option>
          {chiOptions.map((c) => (
            <option key={c.id} value={c.id}>
              {c.label}
            </option>
          ))}
        </select>
      </label>
      <div className="segmented" role="group" aria-label={t('meeting.repeat')}>
        {(['yearly', 'once'] as const).map((r) => (
          <button key={r} type="button" className="btn small" aria-pressed={f.repeat === r} onClick={() => set('repeat', r)}>
            {t(r === 'yearly' ? 'meeting.yearly' : 'meeting.once')}
          </button>
        ))}
      </div>
      <label>
        {t('meeting.calendar')}
        <select value={f.calendar} onChange={(e) => set('calendar', e.target.value as CalendarKind)}>
          <option value="lunisolar">{t('meeting.lunar')}</option>
          <option value="solar">{t('meeting.solar')}</option>
        </select>
      </label>
      {f.repeat === 'yearly' && (
        <div className="segmented" role="group" aria-label={t('meeting.by')}>
          {(['day', 'weekday'] as const).map((by) => (
            <button key={by} type="button" className="btn small" aria-pressed={f.by === by} onClick={() => set('by', by)}>
              {t(by === 'day' ? 'meeting.byDay' : 'meeting.byWeekday')}
            </button>
          ))}
        </div>
      )}
      {f.repeat === 'yearly' && f.by === 'weekday' ? (
        <div className="row">
          <label>
            {t('meeting.week')}
            <select value={f.week} onChange={(e) => set('week', Number(e.target.value))}>
              {WEEKS.map((w) => (
                <option key={w} value={w}>
                  {weekName(w, locale)}
                </option>
              ))}
            </select>
          </label>
          <label>
            {t('meeting.weekday')}
            <select value={f.weekday} onChange={(e) => set('weekday', Number(e.target.value))}>
              {range(0, 6).map((d) => (
                <option key={d} value={d}>
                  {weekdayName(d, locale)}
                </option>
              ))}
            </select>
          </label>
          <label>
            {t('meeting.month')}
            <select value={f.month} onChange={(e) => set('month', Number(e.target.value))}>
              {range(1, 12).map((m) => (
                <option key={m} value={m}>
                  {lunar ? lunarMonthName(m, locale) : t('meeting.monthSolar', { n: m })}
                </option>
              ))}
            </select>
          </label>
        </div>
      ) : f.repeat === 'once' && !lunar ? (
        <label>
          {t('meeting.date')}
          <input type="date" value={f.date} onChange={(e) => set('date', e.target.value)} required />
        </label>
      ) : (
        <div className="row">
          <label>
            {t('meeting.day')}
            <select value={f.day} onChange={(e) => set('day', Number(e.target.value))}>
              {range(1, lunar ? 30 : 31).map((d) => (
                <option key={d} value={d}>
                  {d}
                </option>
              ))}
            </select>
          </label>
          <label>
            {t('meeting.month')}
            <select value={f.month} onChange={(e) => set('month', Number(e.target.value))}>
              {range(1, 12).map((m) => (
                <option key={m} value={m}>
                  {lunar ? lunarMonthName(m, locale) : t('meeting.monthSolar', { n: m })}
                </option>
              ))}
            </select>
          </label>
          {f.repeat === 'once' && (
            <label>
              {t('meeting.lunarYear')}
              <input
                type="number"
                min={1900}
                max={2199}
                value={f.lunarYear}
                onChange={(e) => set('lunarYear', Number(e.target.value))}
                required
              />
            </label>
          )}
        </div>
      )}
      <p className="small meeting-next" aria-live="polite">
        {!input ? (
          <span className="error">{t('meeting.badLunar')}</span>
        ) : next ? (
          <>
            {t('meeting.next')} <strong>{solarLabel(next, locale)}</strong>{' '}
            <span className="muted">({lunarLabel(next, locale)})</span>
          </>
        ) : (
          <span className="muted">{t('meeting.over')}</span>
        )}
      </p>
      <div className="row">
        <label>
          {t('meeting.time')}
          <input type="time" value={f.time} onChange={(e) => set('time', e.target.value)} />
        </label>
        <label>
          {t('meeting.place')}
          <input value={f.place} onChange={(e) => set('place', e.target.value)} maxLength={200} />
        </label>
      </div>
      <label>
        {t('meeting.note')}
        <textarea value={f.note} onChange={(e) => set('note', e.target.value)} maxLength={1000} rows={2} />
      </label>
      {error && <p className="error small">{error}</p>}
      <div className="actions">
        <button className="btn primary" disabled={busy || !input}>
          <Icon name="save" />
          {busy ? t('common.saving') : t('common.save')}
        </button>
        <button type="button" className="btn" onClick={onCancel} disabled={busy}>
          {t('common.cancel')}
        </button>
      </div>
    </form>
  );
}

/**
 * Settings → Họp họ: the tree's family meetings, for every member to see; the owner
 * and admins add, change and remove them. The tree page shows the coming ones, and
 * members can get email reminders (My account).
 */
export default function MeetingsSection() {
  const { t, locale, formatName, errorMessage } = useI18n();
  const { tree, treeApi, canManage } = useCurrentTree();
  const { options } = useLayoutPrefs();
  const [meetings, setMeetings] = useState<Meeting[] | null>(null);
  const [graph, setGraph] = useState<TreeData | null>(null);
  const [editing, setEditing] = useState<Meeting | 'new' | null>(null);
  const [notice, setNotice] = useState<Notice>(null);
  const [version, setVersion] = useState(0);

  useEffect(() => {
    let cancelled = false;
    treeApi
      .listMeetings()
      .then((list) => !cancelled && setMeetings(list))
      .catch((err: Error) => !cancelled && setNotice({ text: err.message, error: true }));
    return () => {
      cancelled = true;
    };
  }, [treeApi, version]);

  // The whole tree, for its chi (numbered as on the tree page); only needed to edit.
  useEffect(() => {
    if (!canManage) return;
    let cancelled = false;
    treeApi
      .getGraph()
      .then((data) => !cancelled && setGraph(data))
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [treeApi, canManage]);

  const chiOptions = useMemo(() => {
    if (!graph) return [];
    const byId = new Map(graph.nodes.map((p) => [p.id, p]));
    return listChi(graph, options).map((id, i) => {
      const root = byId.get(id);
      return { id, label: t('tree.chiLabel', { n: i + 1, name: root ? formatName(root) : '' }) };
    });
  }, [graph, options, t, formatName]);

  async function remove(m: Meeting) {
    if (!confirm(t('meeting.deleteConfirm', { title: m.title }))) return;
    try {
      await treeApi.deleteMeeting(m.id);
      setNotice({ text: t('meeting.deleted') });
      setVersion((v) => v + 1);
    } catch (err) {
      setNotice({ text: errorMessage(err), error: true });
    }
  }

  const saved = () => {
    setEditing(null);
    setNotice({ text: t('meeting.saved') });
    setVersion((v) => v + 1);
  };

  return (
    <section className="card" id="meetings">
      <h3>{t('meeting.title')}</h3>
      <p className="muted small">{t('meeting.intro', { name: tree.name })}</p>

      {!meetings ? (
        !notice && <p className="muted">{t('common.loading')}</p>
      ) : meetings.length === 0 && editing !== 'new' ? (
        <p className="muted small">{t('meeting.none')}</p>
      ) : (
        <ul className="meeting-list">
          {meetings.map((m) =>
            editing !== 'new' && editing?.id === m.id ? (
              <li key={m.id}>
                <MeetingForm meeting={m} chiOptions={chiOptions} onSaved={saved} onCancel={() => setEditing(null)} />
              </li>
            ) : (
              <li key={m.id} className="meeting-item">
                <div className="meeting-item-main">
                  <div>
                    <strong>{m.title}</strong>
                    <span className="muted small">
                      {' · '}
                      {m.chiRoot ? t('meeting.chiOf', { name: formatName(m.chiRoot) }) : t('meeting.wholeTree')}
                    </span>
                  </div>
                  <div className="small">
                    {ruleLabel(m, locale) ?? t('meeting.onceOn', { date: m.date ? solarLabel(m.date, locale) : '' })}
                    {m.time && ` · ${m.time}`}
                    {m.place && ` · ${m.place}`}
                  </div>
                  <div className="small muted">
                    {m.next ? (
                      <>
                        {t('meeting.next')} {solarLabel(m.next, locale)} ({lunarLabel(m.next, locale)})
                      </>
                    ) : (
                      t('meeting.over')
                    )}
                  </div>
                  {m.note && <div className="small meeting-note">{m.note}</div>}
                </div>
                {canManage && (
                  <span className="meeting-item-actions">
                    <button className="btn small" onClick={() => setEditing(m)} disabled={editing !== null}>
                      <Icon name="edit" />
                      {t('common.edit')}
                    </button>
                    <button className="btn small ghost danger-text" onClick={() => void remove(m)} disabled={editing !== null}>
                      <Icon name="trash" />
                      {t('common.delete')}
                    </button>
                  </span>
                )}
              </li>
            ),
          )}
        </ul>
      )}

      {canManage &&
        (editing === 'new' ? (
          <MeetingForm meeting={null} chiOptions={chiOptions} onSaved={saved} onCancel={() => setEditing(null)} />
        ) : (
          <button className="btn" onClick={() => setEditing('new')} disabled={editing !== null}>
            <Icon name="plus" />
            {t('meeting.add')}
          </button>
        ))}
      {notice && <p className={notice.error ? 'error small' : 'success small'}>{notice.text}</p>}
    </section>
  );
}
