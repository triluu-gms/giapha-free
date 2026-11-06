import type { Locale } from '../auth/cookies';
import { query } from '../db';
import { HttpError } from '../errors';
import { isFullDate } from './anniversary';
import { DEFAULT_MEETING_DAYS_BEFORE } from './meetings';
import { DEFAULT_DAYS_BEFORE } from './run';

export interface ReminderPreferences {
  enabled: boolean;
  daysBefore: number;
  /** Family meeting (họp họ) emails (reminders/meetings.ts). */
  meetingsEnabled: boolean;
  meetingDaysBefore: number;
  /** Every meeting of the user's trees, or only the whole tree's and their own chi's. */
  meetingScope: 'all' | 'mine';
  /** The people you asked to be reminded about, in trees you still belong to. */
  people: {
    personId: string;
    firstName: string;
    lastName: string | null;
    deathDate: string | null;
    treeId: string;
    treeName: string;
  }[];
}

export async function getReminderPreferences(userId: string): Promise<ReminderPreferences> {
  const [row] = await query<ReminderPreferences>(
    `MATCH (u:User {id: $userId})
     RETURN coalesce(u.remindersEnabled, false) AS enabled,
            coalesce(u.reminderDaysBefore, $defaultDays) AS daysBefore,
            coalesce(u.meetingRemindersEnabled, false) AS meetingsEnabled,
            coalesce(u.meetingDaysBefore, $meetingDays) AS meetingDaysBefore,
            coalesce(u.meetingScope, 'all') AS meetingScope,
            COLLECT {
              MATCH (u)-[:REMINDS]->(p:Person), (u)-[:MEMBER_OF]->(t:Tree {id: p.treeId})
              RETURN {personId: p.id, firstName: p.firstName, lastName: p.lastName, deathDate: p.deathDate,
                      treeId: t.id, treeName: t.name}
            } AS people`,
    { userId, defaultDays: DEFAULT_DAYS_BEFORE, meetingDays: DEFAULT_MEETING_DAYS_BEFORE },
  );
  return (
    row ?? {
      enabled: false,
      daysBefore: DEFAULT_DAYS_BEFORE,
      meetingsEnabled: false,
      meetingDaysBefore: DEFAULT_MEETING_DAYS_BEFORE,
      meetingScope: 'all',
      people: [],
    }
  );
}

/** Saves the switches and lead times, and the language the reminder emails are written in. */
export async function updateReminderPreferences(
  userId: string,
  changes: {
    enabled?: boolean;
    daysBefore?: number;
    meetingsEnabled?: boolean;
    meetingDaysBefore?: number;
    meetingScope?: 'all' | 'mine';
  },
  locale: Locale,
): Promise<void> {
  await query(
    `MATCH (u:User {id: $userId})
     SET u.remindersEnabled = coalesce($enabled, u.remindersEnabled),
         u.reminderDaysBefore = coalesce($daysBefore, u.reminderDaysBefore),
         u.meetingRemindersEnabled = coalesce($meetingsEnabled, u.meetingRemindersEnabled),
         u.meetingDaysBefore = coalesce($meetingDaysBefore, u.meetingDaysBefore),
         u.meetingScope = coalesce($meetingScope, u.meetingScope),
         u.locale = $locale`,
    {
      userId,
      enabled: changes.enabled ?? null,
      daysBefore: changes.daysBefore ?? null,
      meetingsEnabled: changes.meetingsEnabled ?? null,
      meetingDaysBefore: changes.meetingDaysBefore ?? null,
      meetingScope: changes.meetingScope ?? null,
      locale,
    },
    'WRITE',
  );
}

/** Turns reminders about one person (in the caller's current tree) on or off. */
export async function setPersonReminder(userId: string, treeId: string, personId: string, on: boolean, locale: Locale) {
  if (!on) {
    await query(
      'MATCH (:User {id: $userId})-[r:REMINDS]->(:Person {id: $personId, treeId: $treeId}) DELETE r',
      { userId, personId, treeId },
      'WRITE',
    );
    return;
  }
  const [row] = await query<{ deathDate: string | null }>(
    `MATCH (u:User {id: $userId}), (p:Person {id: $personId, treeId: $treeId})
     WHERE p.deathDate =~ $fullDate
     MERGE (u)-[r:REMINDS]->(p)
     ON CREATE SET r.since = $now
     SET u.locale = coalesce(u.locale, $locale)
     RETURN p.deathDate AS deathDate`,
    { userId, personId, treeId, fullDate: '\\d{4}-\\d{2}-\\d{2}', now: new Date().toISOString(), locale },
    'WRITE',
  );
  if (!row) {
    const [person] = await query<{ deathDate: string | null }>(
      'MATCH (p:Person {id: $personId, treeId: $treeId}) RETURN p.deathDate AS deathDate',
      { personId, treeId },
    );
    if (!person) throw new HttpError(404, 'Person not found');
    if (!isFullDate(person.deathDate)) {
      throw new HttpError(400, 'Reminders need a full death date (year, month and day)', 'reminderNeedsFullDate');
    }
  }
}
