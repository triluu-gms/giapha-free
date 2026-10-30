import { config } from '../config';
import { query } from '../db';
import { sendEmail } from '../email/mailer';
import { anniversaryReminderEmail, type AnniversaryItem } from '../email/templates';
import { canChi, lunarOf } from '../lib/lunar';
import { isAnniversary, vietnamDate, type CalendarKind } from './anniversary';

// Death anniversary (ngày giỗ) reminders. A member marks a person with
// (:User)-[:REMINDS]->(:Person); their account preferences turn the emails on
// (User.remindersEnabled) and say how early (User.reminderDaysBefore). A daily
// cron (see app.ts and vercel.json) calls runReminders.

export const DEFAULT_DAYS_BEFORE = 3;
export const MAX_DAYS_BEFORE = 30;

interface Row {
  userId: string;
  email: string;
  locale: string | null;
  daysBefore: number;
  lastSentFor: string | null;
  person: { id: string; firstName: string; lastName: string | null; deathDate: string };
  treeName: string;
  calendar: CalendarKind;
}

const fullName = (p: Row['person'], locale: 'en' | 'vi') =>
  (locale === 'vi' ? [p.lastName, p.firstName] : [p.firstName, p.lastName]).filter(Boolean).join(' ');

/**
 * Emails every user whose reminded people have an anniversary exactly their
 * `daysBefore` days from today (Vietnam time): one email per user listing them all.
 * Each reminder records the anniversary it was sent for, so running twice a day
 * sends nothing twice. Only people in trees the user still belongs to count.
 */
export async function runReminders(
  now = new Date(),
  budgetMs = SEND_BUDGET_MS,
): Promise<{ date: string; emails: number; failed: number; postponed: number }> {
  const today = vietnamDate(now);
  const rows = await query<Row>(
    `MATCH (u:User)-[r:REMINDS]->(p:Person)
     WHERE u.remindersEnabled = true AND u.email IS NOT NULL AND coalesce(u.emailVerified, true)
       AND u.privacyAcceptedAt IS NOT NULL
       AND p.deathDate =~ $fullDate
     MATCH (u)-[:MEMBER_OF]->(t:Tree {id: p.treeId})
     RETURN u.id AS userId, u.email AS email, u.locale AS locale,
            coalesce(u.reminderDaysBefore, $defaultDays) AS daysBefore, r.lastSentFor AS lastSentFor,
            p {.id, .firstName, .lastName, .deathDate} AS person, t.name AS treeName,
            coalesce(t.deathCalendar, t.calendar, 'solar') AS calendar`,
    { fullDate: '\\d{4}-\\d{2}-\\d{2}', defaultDays: DEFAULT_DAYS_BEFORE },
  );

  // userId -> what to send
  const due = new Map<string, { email: string; locale: 'en' | 'vi'; daysBefore: number; date: string; items: AnniversaryItem[]; personIds: string[] }>();
  for (const row of rows) {
    const daysBefore = Math.min(Math.max(Math.trunc(row.daysBefore), 0), MAX_DAYS_BEFORE);
    const date = vietnamDate(now, daysBefore);
    if (row.lastSentFor === date || !isAnniversary(row.person.deathDate, date, row.calendar)) continue;
    const locale = row.locale === 'vi' ? 'vi' : 'en';
    const lunar = row.calendar === 'lunisolar' ? lunarOf(date) : null;
    const entry = due.get(row.userId) ?? { email: row.email, locale, daysBefore, date, items: [], personIds: [] };
    entry.items.push({
      personName: fullName(row.person, locale),
      treeName: row.treeName,
      date,
      lunar: lunar && { day: lunar.day, month: lunar.month, canChi: canChi(lunar.year) },
    });
    entry.personIds.push(row.person.id);
    due.set(row.userId, entry);
  }

  // A few emails at a time, and no new one once the time budget is spent, so the job
  // finishes inside the platform's time limit however many reminders there are.
  // What's left is reported (postponed) and logged.
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
          anniversaryReminderEmail(entry.email, entry.locale, entry.items, entry.daysBefore, `${config.auth.publicAppUrl}/account`),
        );
        await query(
          `MATCH (:User {id: $userId})-[r:REMINDS]->(p:Person)
           WHERE p.id IN $personIds
           SET r.lastSentFor = $date`,
          { userId, personIds: entry.personIds, date: entry.date },
          'WRITE',
        );
        emails++;
      } catch (err) {
        failed++;
        console.error(`Could not send anniversary reminders to user ${userId}:`, err);
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(SEND_CONCURRENCY, queue.length) }, worker));
  if (queue.length) console.error(`Reminders: time budget used up, ${queue.length} user(s) not emailed today`);
  return { date: today, emails, failed, postponed: queue.length };
}

/** Emails sent at the same time. */
const SEND_CONCURRENCY = 5;
/** Stop starting new emails after this, well inside the serverless function's time limit. */
const SEND_BUDGET_MS = 45_000;
