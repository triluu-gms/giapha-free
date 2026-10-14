import { z } from 'zod';
import { query } from '../db';

// Per-tree settings, stored as properties on the (:Tree) node. They only affect
// that tree. A missing property means its default, so existing trees need no migration.

const calendar = z.enum(['solar', 'lunisolar']);

export const treeSettingsSchema = z.object({
  /** Editors can select several people on the People page and delete them at once. */
  bulkDelete: z.boolean(),
  /**
   * How the app shows and asks for birth dates and death dates: Gregorian, or the
   * Vietnamese lunisolar calendar (âm lịch), separately because death dates (for
   * ngày giỗ) are usually kept in âm lịch. Dates are always stored as solar dates,
   * so this only changes the display and the forms (see frontend/src/lib/lunar.ts).
   */
  birthCalendar: calendar,
  deathCalendar: calendar,
});

export type TreeSettings = z.infer<typeof treeSettingsSchema>;

export const treeSettingsUpdateSchema = treeSettingsSchema.partial().strict();

/**
 * Cypher map of a tree's settings with defaults filled in; `t` is the Tree node.
 * `t.calendar` is the earlier single setting for both kinds of date, still honoured.
 */
export const TREE_SETTINGS_CYPHER = `{
  bulkDelete: coalesce(t.bulkDelete, true),
  birthCalendar: coalesce(t.birthCalendar, t.calendar, 'solar'),
  deathCalendar: coalesce(t.deathCalendar, t.calendar, 'solar')
}`;

export async function updateTreeSettings(treeId: string, changes: Partial<TreeSettings>): Promise<TreeSettings> {
  const [row] = await query<{ settings: TreeSettings }>(
    `MATCH (t:Tree {id: $treeId})
     SET t += $changes
     RETURN ${TREE_SETTINGS_CYPHER} AS settings`,
    { treeId, changes },
    'WRITE',
  );
  return row.settings;
}
