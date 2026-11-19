'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { daysBetween, lunarLabel, solarLabel, UPCOMING_DAYS, vietnamToday } from '@/lib/meetings';
import type { Meeting } from '@/lib/types';
import { useI18n } from './I18nProvider';
import Icon from './Icon';
import { useCurrentTree } from './TreeProvider';

/** Most meetings listed at once; the rest are a link away (Settings). */
const MAX_SHOWN = 3;
const HIDDEN_KEY = 'familyTree.meetingsHidden';

/**
 * Above the tree: the family meetings (họp họ, họp chi) in the next 30 days, with
 * their solar and lunar dates. ✕ hides them for this browser session, until the
 * list of coming meetings changes.
 */
export default function UpcomingMeetings({ version }: { version: number }) {
  const { t, locale, formatName } = useI18n();
  const { tree, treeApi } = useCurrentTree();
  const [meetings, setMeetings] = useState<Meeting[]>([]);
  const [hidden, setHidden] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    treeApi
      .listMeetings()
      .then((list) => !cancelled && setMeetings(list))
      .catch(() => undefined); // the tree works without them
    return () => {
      cancelled = true;
    };
  }, [treeApi, version]);

  useEffect(() => {
    try {
      setHidden(window.sessionStorage.getItem(`${HIDDEN_KEY}.${tree.id}`));
    } catch {
      // storage unavailable: always shown
    }
  }, [tree.id]);

  const today = vietnamToday();
  const soon = useMemo(
    () => meetings.filter((m) => m.next && daysBetween(today, m.next) <= UPCOMING_DAYS),
    [meetings, today],
  );
  // What's listed, so hiding it lasts only until a meeting is added, moved or due.
  const signature = soon.map((m) => `${m.id}@${m.next}`).join(',');
  if (!soon.length || hidden === signature) return null;

  const hide = () => {
    setHidden(signature);
    try {
      window.sessionStorage.setItem(`${HIDDEN_KEY}.${tree.id}`, signature);
    } catch {
      // storage unavailable: hidden until the page is reloaded
    }
  };

  return (
    <section className="meeting-banner" aria-label={t('meeting.upcoming')}>
      <span className="meeting-banner-icon" aria-hidden="true">
        <Icon name="calendar" />
      </span>
      <div className="meeting-banner-list">
        {soon.slice(0, MAX_SHOWN).map((m) => {
          const days = daysBetween(today, m.next!);
          return (
            <div key={m.id} className="meeting-banner-row">
              <div className="meeting-banner-what">
                <strong>{m.title}</strong>
                <span className="muted"> · {m.chiRoot ? t('meeting.chiOf', { name: formatName(m.chiRoot) }) : t('meeting.wholeTree')}</span>
              </div>
              <div className="meeting-banner-when small">
                {solarLabel(m.next!, locale)}
                <span className="muted"> ({lunarLabel(m.next!, locale)})</span>
                {m.time && <span> · {m.time}</span>}
                {m.place && <span> · {m.place}</span>}
              </div>
              <span className={days <= 3 ? 'badge meeting-soon' : 'badge neutral'}>
                {days === 0 ? t('meeting.today') : days === 1 ? t('meeting.tomorrow') : t('meeting.inDays', { count: days })}
              </span>
            </div>
          );
        })}
        <Link href="/settings#meetings" className="small">
          {soon.length > MAX_SHOWN ? t('meeting.more', { count: soon.length - MAX_SHOWN }) : t('meeting.viewAll')}
        </Link>
      </div>
      <button type="button" className="btn ghost icon-only" onClick={hide} aria-label={t('meeting.hide')} title={t('meeting.hide')}>
        <Icon name="close" />
      </button>
    </section>
  );
}
