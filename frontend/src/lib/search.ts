/** Lowercase without accents, so "nguyen" matches "Nguyễn" and "dang" matches "Đặng". */
export const foldText = (value: string) =>
  value
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/đ/gi, 'd')
    .toLowerCase();

/**
 * True when every word of the query appears in the person's first or last name,
 * in any order: "an nguyen", "nguyen an" and "ngu" all find "Nguyễn Văn An".
 */
export function matchesName(person: { firstName: string; lastName?: string | null }, query: string): boolean {
  const words = foldText(query).split(/\s+/).filter(Boolean);
  if (!words.length) return true;
  const name = foldText(`${person.firstName} ${person.lastName ?? ''}`);
  return words.every((w) => name.includes(w));
}
