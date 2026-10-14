// Family rules shared by the relationship, person and import endpoints.
// (frontend/src/lib/rules.ts mirrors this for instant feedback; the API is what enforces it.)

/** A parent must be at least this many years older than their child. */
export const MIN_PARENT_AGE = 16;

export const PARENT_TOO_YOUNG_MESSAGE = `A parent must be at least ${MIN_PARENT_AGE} years older than their child`;

/**
 * Error codes the frontend translates (`error.<code>` in i18n.ts). The `min`
 * placeholder is filled in with MIN_PARENT_AGE on the frontend.
 */
export const PARENT_AGE_CODES = {
  /** Linking or importing: the chosen parent is too close in age to the child. */
  link: 'parentTooYoung',
  /** Editing a birth date: it would be too close to one of the person's parents. */
  nearParent: 'birthDateNearParent',
  /** Editing a birth date: it would be too close to one of the person's children. */
  nearChild: 'birthDateNearChild',
} as const;

/**
 * True when both birth dates are known and the parent was clearly younger than
 * MIN_PARENT_AGE when the child was born. Dates may be partial (YYYY, YYYY-MM,
 * YYYY-MM-DD) and are compared at their common precision, so "1990" and
 * "2006-05-01" compare as 1990 + 16 = 2006 vs 2006: allowed.
 */
export function isTooYoungToBeParent(
  parentBirthDate: string | null | undefined,
  childBirthDate: string | null | undefined,
): boolean {
  if (!parentBirthDate || !childBirthDate) return false;
  const n = Math.min(parentBirthDate.length, childBirthDate.length);
  const year = Number(parentBirthDate.slice(0, 4)) + MIN_PARENT_AGE;
  // The parent's MIN_PARENT_AGE-th birthday, as a sortable date string.
  const cameOfAge = `${String(year).padStart(4, '0')}${parentBirthDate.slice(4, n)}`;
  return childBirthDate.slice(0, n) < cameOfAge;
}
