import { config } from '../config';
import { query } from '../db';
import { sendEmail } from '../email/mailer';
import { meetingReminderEmail, type MeetingItem } from '../email/templates';
import { canChi, lunarOf } from '../lib/lunar';
import { nextOccurrence, type Meeting } from '../meetings/meetings';
import { vietnamDate } from './anniversary';

// Family meeting (họp họ) reminders, sent from the same daily cron as the death
// anniversary ones (app.ts, /api/cron/reminders). A member turns them on in their
// account (User.meetingRemindersEnabled), says how early (User.meetingDaysBefore) and
// whether for every meeting of their trees or only the whole tree's and their own
// chi's (User.meetingScope = 'mine'; their chi comes from "This is me").
// (:User)-[:MEETING_SENT {lastSentFor}]->(:Meeting) keeps a meeting from being sent twice.

export const DEFAULT_MEETING_DAYS_BEFORE = 7;
export const MAX_MEETING_DAYS_BEFORE = 30;

interface Row {
  userId: string;
  email: string;
  locale: string | null;
  daysBefore: number;
  meeting: Meeting;
  lastSentFor: string | null;
  treeName: string;
  chiName: { firstName: string; lastName: string | null } | null;
}

const fullName = (p: { firstName: string; lastName: string | null }, locale: 'en' | 'vi') =>
  (locale === 'vi' ? [p.lastName, p.firstName] : [p.firstName, p.lastName]).filter(Boolean).join(' ');

/**
 * Emails every member whose meetings are exactly their `daysBefore` days away (Vietnam
 * time): one email per member listing them all. Safe to run again the same day.
 */
export async function runMeetingReminders(
  now = new Date(),
  budgetMs = 20_000,
): Promise<{ emails: number; failed: number; postponed: number }> {
  const rows = await query<Row>(
    `MATCH (u:User)-[m:MEMBER_OF]->(t:Tree)
     WHERE u.meetingRemindersEnabled = true AND u.email IS NOT NULL AND coalesce(u.emailVerified, true)
       AND u.privacyAcceptedAt IS NOT NULL
     MATCH (e:Meeting {treeId: t.id})
     OPTIONAL MATCH (root:Person {id: e.chiRootId, treeId: t.id})
     WITH u, m, t, e, root
     // "Only my chi": the whole tree's meetings, and those of the chi "This is me" is in
     // (the chi's first person, a descendant, or the spouse of one).
     WHERE coalesce(u.meetingScope, 'all') = 'all' OR root IS NULL
        OR EXISTS {
          MATCH (root)-[:PARENT_OF*0..]->(d:Person {treeId: t.id})
          WHERE d.id = m.personId OR EXISTS { (d)-[:SPOUSE_OF]-(:Person {id: m.personId, treeId: t.id}) }
        }
     OPTIONAL MATCH (u)-[s:MEETING_SENT]->(e)
     RETURN u.id AS userId, u.email AS email, u.locale AS locale,
            coalesce(u.meetingDaysBefore, $defaultDays) AS daysBefore,
            e {.id, .title, .chiRootId, .repeat, .calendar, .month, .day, .weekday, .week, .date, .time, .place, .note} AS meeting,
            s.lastSentFor AS lastSentFor, t.name AS treeName,
            CASE WHEN root IS NULL THEN null ELSE root {.firstName, .lastName} END AS chiName`,
    { defaultDays: DEFAULT_MEETING_DAYS_BEFORE },
  );

  const due = new Map<string, { email: string; locale: 'en' | 'vi'; daysBefore: number; date: string; items: MeetingItem[]; meetingIds: string[] }>();
  for (const row of rows) {
    const daysBefore = Math.min(Math.max(Math.trunc(row.daysBefore), 0), MAX_MEETING_DAYS_BEFORE);
    const date = vietnamDate(now, daysBefore);
    if (row.lastSentFor === date || nextOccurrence(row.meeting, date) !== date) continue;
    const locale = row.locale === 'vi' ? 'vi' : 'en';
    const lunar = lunarOf(date)!;
    const entry = due.get(row.userId) ?? { email: row.email, locale, daysBefore, date, items: [], meetingIds: [] };
    entry.items.push({
      title: row.meeting.title,
      treeName: row.treeName,
      chiName: row.chiName && fullName(row.chiName, locale),
      date,
      lunar: { day: lunar.day, month: lunar.month, canChi: canChi(lunar.year) },
      time: row.meeting.time,
      place: row.meeting.place,
      note: row.meeting.note,
    });
    entry.meetingIds.push(row.meeting.id);
    due.set(row.userId, entry);
  }

  let emails = 0;
  let failed = 0;
  const queue = [...due];
  const started = Date.now();
  const worker = async () => {
    for (let next = queue.shift(); next; next = queue.shift()) {
      if (Date.now() - started > budgetMs) {
        queue.unshift(next);
        return;
      }
      const [userId, entry] = next;
      try {
        await sendEmail(
          meetingReminderEmail(entry.email, entry.locale, entry.items, entry.daysBefore, `${config.auth.publicAppUrl}/account`),
        );
        await query(
          `MATCH (u:User {id: $userId}), (e:Meeting) WHERE e.id IN $meetingIds
           MERGE (u)-[s:MEETING_SENT]->(e)
           SET s.lastSentFor = $date`,
          { userId, meetingIds: entry.meetingIds, date: entry.date },
          'WRITE',
        );
        emails++;
      } catch (err) {
        failed++;
        console.error(`Could not send meeting reminders to user ${userId}:`, err);
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(5, queue.length) }, worker));
  if (queue.length) console.error(`Meeting reminders: time budget used up, ${queue.length} user(s) not emailed today`);
  return { emails, failed, postponed: queue.length };
}
