// Mirrors backend/src/trees/rules.ts so the UI can explain a rule before the API refuses.

/** A parent must be at least this many years older than their child. */
export const MIN_PARENT_AGE = 16;

/**
 * True when both birth dates are known and the parent was clearly younger than
 * MIN_PARENT_AGE when the child was born. Partial dates compare at their common precision.
 */
export function isTooYoungToBeParent(
  parentBirthDate: string | null | undefined,
  childBirthDate: string | null | undefined,
): boolean {
  if (!parentBirthDate || !childBirthDate) return false;
  const n = Math.min(parentBirthDate.length, childBirthDate.length);
  const year = Number(parentBirthDate.slice(0, 4)) + MIN_PARENT_AGE;
  const cameOfAge = `${String(year).padStart(4, '0')}${parentBirthDate.slice(4, n)}`;
  return childBirthDate.slice(0, n) < cameOfAge;
}
