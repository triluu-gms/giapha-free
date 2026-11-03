import { z } from 'zod';
import { query } from '../db';

// Per-tree settings, stored as properties on the (:Tree) node. They only affect
// that tree. A missing property means its default, so existing trees need no migration.

const calendar = z.enum(['solar', 'lunisolar']);

/**
 * The report's ready-made backgrounds (frontend/src/lib/reportPresets.ts, images in
 * frontend/public/report-backgrounds/). A saved background is "preset:<id>" for one
 * of these, or one of the tree's uploaded photos.
 */
export const REPORT_BACKGROUND_PRESETS = ['cung-dinh', 'sen-hong', 'may-ngoc', 'toi-gian', 'hoang-hon'];
export const isReportPreset = (value: string) =>
  value.startsWith('preset:') && REPORT_BACKGROUND_PRESETS.includes(value.slice('preset:'.length));
const color = z.string().regex(/^#[0-9a-f]{6}$/i);
/** A card's size on the report, in percent of the tree page's card. */
const cardSize = z.number().min(40).max(300);

/** Percent of the background's width or height kept clear on one side of a box on the report. */
const margin = z.number().min(0).max(95);
/** [top, right, bottom, left] margins of a box, which keeps at least 5% of the background each way. */
const reportBox = z
  .tuple([margin, margin, margin, margin])
  .refine(([top, right, bottom, left]) => top + bottom <= 95 && left + right <= 95, 'The box is too small');

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
  /**
   * The printed report (frontend/src/lib/report.ts) draws the tree over this image,
   * e.g. a decorated frame: "preset:<id>" for a ready-made one, one of this tree's
   * uploaded photos (trees/photos.ts), or null.
   */
  reportBackground: z.string().max(300).nullable(),
  /**
   * Where the tree goes on the background: margins in percent of its size,
   * [top, right, bottom, left], so it sits inside the frame's border.
   */
  reportArea: reportBox,
  /** Where the title and subtitle go, the same way (e.g. on the frame's banner). */
  reportTitleArea: reportBox,
  /** The title's colour on the report. */
  reportTextColor: color,
  /** The report's person cards: background, the name, the dates, and the lines and card borders. */
  reportCardColor: color,
  reportNameColor: color,
  reportDatesColor: color,
  reportLineColor: color,
  /** Card sizes for the 1st, 2nd and 3rd đời, and for the 4th and every later one. */
  reportDepthSizes: z.tuple([cardSize, cardSize, cardSize, cardSize]),
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
  deathCalendar: coalesce(t.deathCalendar, t.calendar, 'solar'),
  reportBackground: t.reportBackground,
  reportArea: coalesce(t.reportArea, [24.0, 8.0, 10.0, 8.0]),
  reportTitleArea: coalesce(t.reportTitleArea, [12.0, 8.0, 78.0, 8.0]),
  reportTextColor: coalesce(t.reportTextColor, '#7a1f1f'),
  reportCardColor: coalesce(t.reportCardColor, '#b3261e'),
  reportNameColor: coalesce(t.reportNameColor, '#fff4c2'),
  reportDatesColor: coalesce(t.reportDatesColor, '#ffd27a'),
  reportLineColor: coalesce(t.reportLineColor, '#9c2a1f'),
  reportDepthSizes: coalesce(t.reportDepthSizes, [200.0, 150.0, 115.0, 85.0])
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
