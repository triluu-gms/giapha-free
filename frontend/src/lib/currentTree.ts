// Remembers which tree the viewer last looked at (a per-browser convenience).
const STORAGE_KEY = 'familyTree.currentTree';

export function getRememberedTree(): string | null {
  try {
    return window.localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

export function rememberTree(id: string) {
  try {
    window.localStorage.setItem(STORAGE_KEY, id);
  } catch {
    // storage unavailable; the choice just won't be remembered
  }
}
