import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { query } from '../db';
import { HttpError, notFound } from '../errors';
import { lunarOf, lunarToSolar, solarIsoOf } from '../lib/lunar';
import { personSummary } from '../trees/summary';

// Family meetings (họp họ, or họp chi for one branch), stored as
// (:Meeting {id, treeId, title, chiRootId?, repeat, calendar, month?, day?, weekday?,
//            week?, date?, time?, place?, note?, createdBy, createdAt, updatedAt}).
// A meeting is either yearly, on a day of a lunar (âm lịch) or solar month, or on the
// Nth weekday of one ("Chủ nhật thứ ba của tháng Chạp"), or once, on a solar date. chiRootId is the chi's first person (one of the founders'
// children); without it the meeting is for the whole tree. The owner and admins
// manage them; every member sees them, and can get email reminders
// (reminders/meetings.ts).

const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Use HH:MM');
const fullDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD');
const optionalText = (max: number) => z.string().trim().max(max).nullable().optional();

export const meetingSchema = z
  .object({
    title: z.string().trim().min(1, 'Give the meeting a name').max(120),
    /** The chi's first person, or null for the whole tree. */
    chiRootId: z.string().min(1).max(100).nullable(),
    repeat: z.enum(['yearly', 'once']),
    /** For yearly meetings: which calendar `month` and `day` are in. */
    calendar: z.enum(['lunisolar', 'solar']).default('lunisolar'),
    month: z.number().int().min(1).max(12).nullable().optional(),
    day: z.number().int().min(1).max(31).nullable().optional(),
    /**
     * Instead of a day: the `week`-th `weekday` of the month (0 = Sunday … 6 = Saturday;
     * week 1–4, or -1 for the last), e.g. the third Sunday of tháng Chạp.
     */
    weekday: z.number().int().min(0).max(6).nullable().optional(),
    week: z
      .number()
      .int()
      .refine((w) => [1, 2, 3, 4, -1].includes(w), 'Use 1–4, or -1 for the last')
      .nullable()
      .optional(),
    /** For a meeting held once: its solar date. */
    date: fullDate.nullable().optional(),
    time: hhmm.nullable().optional(),
    place: optionalText(200),
    note: optionalText(1000),
  })
  .strict()
  .superRefine((m, ctx) => {
    if (m.repeat === 'yearly' && m.weekday != null) {
      if (!m.month || m.week == null) ctx.addIssue({ code: 'custom', message: 'Say which week and which month', path: ['week'] });
    } else if (m.repeat === 'yearly') {
      if (!m.month || !m.day) ctx.addIssue({ code: 'custom', message: 'A yearly meeting needs a day and a month', path: ['day'] });
      else if (m.calendar === 'lunisolar' && m.day > 30) ctx.addIssue({ code: 'custom', message: 'A lunar month has at most 30 days', path: ['day'] });
      else if (m.calendar === 'solar' && m.day > new Date(Date.UTC(2024, m.month, 0)).getUTCDate()) {
        ctx.addIssue({ code: 'custom', message: 'That month has fewer days', path: ['day'] });
      }
    } else if (!m.date || Number.isNaN(Date.parse(m.date))) {
      ctx.addIssue({ code: 'custom', message: 'A one-off meeting needs its date', path: ['date'] });
    }
  });

export type MeetingInput = z.infer<typeof meetingSchema>;

export interface Meeting {
  id: string;
  title: string;
  chiRootId: string | null;
  repeat: 'yearly' | 'once';
  calendar: 'lunisolar' | 'solar';
  month: number | null;
  day: number | null;
  /** The `week`-th (1–4, or -1 for the last) `weekday` (0 = Sunday) of the month, instead of `day`. */
  weekday: number | null;
  week: number | null;
  date: string | null;
  time: string | null;
  place: string | null;
  note: string | null;
}

const pad = (n: number) => String(n).padStart(2, '0');

/** A yearly solar meeting's date in `year`; 29 February falls on the 28th in other years. */
function solarOn(year: number, month: number, day: number) {
  const last = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return `${year}-${pad(month)}-${pad(Math.min(day, last))}`;
}

const addDays = (iso: string, days: number) =>
  new Date(Date.parse(`${iso}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);

/** A month's solar dates, in order: a solar month, or the regular lunar month of that number (29 or 30 days). */
function monthDays(calendar: Meeting['calendar'], year: number, month: number): string[] {
  if (calendar === 'solar') {
    const last = new Date(Date.UTC(year, month, 0)).getUTCDate();
    return Array.from({ length: last }, (_, i) => `${year}-${pad(month)}-${pad(i + 1)}`);
  }
  const first = solarIsoOf({ day: 1, month, year, leap: false });
  if (!first) return [];
  const length = lunarToSolar({ day: 30, month, year, leap: false }) ? 30 : 29;
  return Array.from({ length }, (_, i) => addDays(first, i));
}

type Rule = Pick<Meeting, 'repeat' | 'calendar' | 'month' | 'day' | 'weekday' | 'week' | 'date'>;

/** A yearly meeting's date in `year` (solar or lunar, as its calendar), or null if that day doesn't exist. */
function dateIn(m: Rule, year: number): string | null {
  if (!m.month) return null;
  if (m.weekday != null && m.week != null) {
    const matches = monthDays(m.calendar, year, m.month).filter((d) => new Date(`${d}T00:00:00Z`).getUTCDay() === m.weekday);
    return (m.week === -1 ? matches[matches.length - 1] : matches[m.week - 1]) ?? null;
  }
  if (!m.day) return null;
  if (m.calendar === 'solar') return solarOn(year, m.month, m.day);
  const day = m.day === 30 && !lunarToSolar({ day: 30, month: m.month, year, leap: false }) ? 29 : m.day;
  return solarIsoOf({ day, month: m.month, year, leap: false });
}

/**
 * The meeting's next date on or after `today` ("YYYY-MM-DD", solar), or null when a
 * one-off meeting is over. A yearly lunar meeting is held in the regular month of its
 * number (never the leap month), and on the 29th in years when its month has no 30th,
 * as for ngày giỗ (reminders/anniversary.ts); "the Nth weekday" counts the days of that
 * regular month.
 */
export function nextOccurrence(m: Rule, today: string): string | null {
  if (m.repeat === 'once') return m.date && m.date >= today ? m.date : null;
  const year = m.calendar === 'solar' ? Number(today.slice(0, 4)) : lunarOf(today)!.year;
  for (const y of [year, year + 1]) {
    const date = dateIn(m, y);
    if (date && date >= today) return date;
  }
  return null;
}

const MEETING_FIELDS = '.id, .title, .chiRootId, .repeat, .calendar, .month, .day, .weekday, .week, .date, .time, .place, .note';

/** The tree's meetings with their next date and their chi's first person, soonest first; past one-off meetings last. */
export async function listMeetings(treeId: string, today: string) {
  const rows = await query<{ meeting: Meeting; chiRoot: Record<string, unknown> | null }>(
    `MATCH (e:Meeting {treeId: $treeId})
     OPTIONAL MATCH (root:Person {id: e.chiRootId, treeId: $treeId})
     RETURN e {${MEETING_FIELDS}} AS meeting, CASE WHEN root IS NULL THEN null ELSE ${personSummary('root')} END AS chiRoot`,
    { treeId },
  );
  return rows
    .map(({ meeting, chiRoot }) => ({ ...meeting, chiRoot, next: nextOccurrence(meeting, today) }))
    .sort((a, b) => (a.next ?? '9999').localeCompare(b.next ?? '9999') || a.title.localeCompare(b.title));
}

/** The stored fields: only those that belong to the meeting's kind, the rest null. */
function storedFields(input: MeetingInput) {
  const yearly = input.repeat === 'yearly';
  return {
    title: input.title,
    chiRootId: input.chiRootId,
    repeat: input.repeat,
    calendar: yearly ? input.calendar : 'solar',
    month: yearly ? input.month : null,
    // Either a day of the month or the Nth weekday of it.
    day: yearly && input.weekday == null ? input.day : null,
    weekday: yearly && input.weekday != null ? input.weekday : null,
    week: yearly && input.weekday != null ? input.week : null,
    date: yearly ? null : input.date,
    time: input.time || null,
    place: input.place || null,
    note: input.note || null,
  };
}

async function assertChiRootInTree(treeId: string, personId: string | null) {
  if (!personId) return;
  const [row] = await query('MATCH (p:Person {id: $personId, treeId: $treeId}) RETURN p.id AS id', { personId, treeId });
  if (!row) throw new HttpError(400, 'Choose a chi from this tree', 'meetingChi');
}

export async function createMeeting(treeId: string, userId: string, input: MeetingInput) {
  await assertChiRootInTree(treeId, input.chiRootId);
  const id = randomUUID();
  await query(
    `CREATE (e:Meeting {id: $id, treeId: $treeId, createdBy: $userId,
                        createdAt: toString(datetime()), updatedAt: toString(datetime())})
     SET e += $fields`,
    { id, treeId, userId, fields: storedFields(input) },
    'WRITE',
  );
  return id;
}

export async function updateMeeting(treeId: string, id: string, input: MeetingInput) {
  await assertChiRootInTree(treeId, input.chiRootId);
  const [row] = await query(
    `MATCH (e:Meeting {id: $id, treeId: $treeId})
     SET e += $fields, e.updatedAt = toString(datetime())
     RETURN e.id AS id`,
    { id, treeId, fields: storedFields(input) },
    'WRITE',
  );
  if (!row) throw notFound('Meeting');
}

export async function deleteMeeting(treeId: string, id: string) {
  const [row] = await query(
    `MATCH (e:Meeting {id: $id, treeId: $treeId})
     DETACH DELETE e
     RETURN $id AS id`,
    { id, treeId },
    'WRITE',
  );
  if (!row) throw notFound('Meeting');
}
