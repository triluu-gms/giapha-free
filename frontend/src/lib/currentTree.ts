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

/** On sign-out: the next account on this browser starts from its own tree. */
export function forgetRememberedTree() {
  try {
    window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    // storage unavailable; nothing was remembered
  }
}
