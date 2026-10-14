import { z } from 'zod';

// Genealogy dates are often partial, so accept YYYY, YYYY-MM or YYYY-MM-DD.
const partialDate = z
  .string()
  .regex(/^\d{4}(-\d{2}(-\d{2})?)?$/, 'Use YYYY, YYYY-MM or YYYY-MM-DD');

const optionalText = (max: number) => z.string().trim().max(max).nullable().optional();

// A web link, or the path of a photo uploaded to the tree (see trees/photos.ts).
const photoUrl = z.union(
  [
    z.url({ protocol: /^https?$/ }).max(2000),
    z.string().regex(/^\/api\/trees\/[\w-]{1,100}\/photos\/[\w-]{1,100}$/),
  ],
  { error: 'Use an https:// link or an uploaded photo' },
);

export const genders = ['male', 'female', 'other', 'unknown'] as const;

export const personCreateSchema = z.object({
  firstName: z.string().trim().min(1, 'First name is required').max(100),
  lastName: optionalText(100),
  gender: z.enum(genders).optional(),
  birthDate: partialDate.nullable().optional(),
  deathDate: partialDate.nullable().optional(),
  birthPlace: optionalText(200),
  /** Where the person lives (or last lived). */
  address: optionalText(300),
  photoUrl: photoUrl.nullable().optional(),
  bio: optionalText(5000),
});

export const personUpdateSchema = personCreateSchema.partial();

/** A new person can be added as a relative of someone already in the tree, in one step. */
export const personCreateWithLinkSchema = personCreateSchema.extend({
  link: z
    .object({
      relation: z.enum(['parent', 'child', 'spouse']),
      /** The existing person the new one is a parent, child or spouse of. */
      personId: z.string().min(1).max(100),
    })
    .optional(),
});

export const PERSON_BULK_DELETE_MAX = 1000;

export const personBulkDeleteSchema = z.object({
  ids: z
    .array(z.string().min(1).max(100))
    .min(1, 'Select at least one person')
    .max(PERSON_BULK_DELETE_MAX, `Delete at most ${PERSON_BULK_DELETE_MAX} people at a time`),
});

// ---- Import from a CSV/Excel template ----
// The browser parses the file; `key` is the row's own ID column, which
// fatherKey/motherKey/spouseKeys refer to. `row` is the spreadsheet row number, for messages.
const importKey = z.string().trim().min(1).max(100);

export const IMPORT_MAX_ROWS = 2000;

export const importRowSchema = personCreateSchema.extend({
  row: z.number().int().positive(),
  key: z.string().trim().min(1, 'ID is required').max(100, 'ID is too long'),
  fatherKey: importKey.nullable().optional(),
  motherKey: importKey.nullable().optional(),
  spouseKeys: z.array(importKey).max(20, 'Too many spouses').optional(),
});

export const importSchema = z.object({
  people: z
    .array(z.unknown())
    .min(1, 'The file has no people in it')
    .max(IMPORT_MAX_ROWS, `Import at most ${IMPORT_MAX_ROWS} people at a time`),
  /** Only validate and count; nothing is written. */
  dryRun: z.boolean().optional(),
  /**
   * Row ID -> id of a person already in the tree that row stands for. Matched rows
   * aren't created; links to them link to that person (see trees/importPeople.ts).
   */
  matches: z
    .record(z.string().max(100), z.string().min(1).max(100))
    .refine((m) => Object.keys(m).length <= IMPORT_MAX_ROWS, 'Too many matches')
    .optional(),
});

/** POST /persons/merge: `removeId` is merged into `keepId`; `fields` are the kept person's values to set. */
export const personMergeSchema = z.object({
  keepId: z.string().min(1).max(100),
  removeId: z.string().min(1).max(100),
  fields: personUpdateSchema.optional(),
});

export const relationshipTypes = ['PARENT_OF', 'SPOUSE_OF'] as const;

export const relationshipSchema = z.object({
  type: z.enum(relationshipTypes),
  fromId: z.string().min(1),
  toId: z.string().min(1),
});

const email = z.string().trim().toLowerCase().max(254).pipe(z.email('Enter a valid email address'));

const newPassword = z.string().min(8, 'Password must be at least 8 characters').max(128, 'Password is too long');

const displayName = z.string().trim().min(1, 'Name is required').max(100);

export const profileUpdateSchema = z.object({ name: displayName });

export const registerSchema = z.object({
  name: displayName,
  email,
  password: newPassword,
  /** Present when registering from an invitation link. */
  inviteToken: z.string().min(1).max(200).optional(),
});

export const tokenSchema = z.object({ token: z.string().min(1).max(200) });

/** "All generations" in the UI; deep enough for any real family, and keeps traversals bounded. */
export const BRANCH_MAX_DEPTH = 20;

/** The branch an editor is limited to: a person and `depth` generations of descendants (see trees/branch.ts). */
export const editScopeSchema = z.object({
  rootId: z.string().min(1).max(100),
  depth: z.number().int().min(0).max(BRANCH_MAX_DEPTH),
});

export type EditScope = z.infer<typeof editScopeSchema>;

/** Roles a tree's members can have besides owner (admin: only the owner may grant it). */
const memberRole = z.enum(['admin', 'editor', 'viewer']);

export const inviteSchema = z.object({
  email,
  role: memberRole,
  /** Editors only: limit editing to this branch. Omitted or null: the whole tree. */
  scope: editScopeSchema.nullable().optional(),
});

export const memberRoleSchema = z.object({
  role: memberRole,
  scope: editScopeSchema.nullable().optional(),
});

export const transferOwnershipSchema = z.object({ userId: z.string().min(1).max(100) });

/** Account preferences for death anniversary (ngày giỗ) reminder emails. */
export const reminderPreferencesSchema = z
  .object({
    enabled: z.boolean().optional(),
    daysBefore: z.number().int().min(0).max(30).optional(),
  })
  .strict();

export const linkMeSchema = z.object({ personId: z.string().min(1).max(100) });

export const treeRenameSchema = z.object({ name: z.string().trim().min(1, 'Name is required').max(100) });

export const passwordLoginSchema = z.object({
  email,
  password: z.string().min(1, 'Password is required').max(128),
});

export const forgotPasswordSchema = z.object({ email });

export const resetPasswordSchema = z.object({
  token: z.string().min(1).max(200),
  password: newPassword,
});

export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1, 'Current password is required').max(128),
  newPassword,
});

export type Person ={ id: string } & z.infer<typeof personCreateSchema>;
