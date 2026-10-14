// Hands a person to select over to the tree page without putting their id in
// the URL (e.g. clicking a name on the People page). One-shot, per browser tab.
const KEY = 'familyTree.selectPerson';

export function requestSelection(personId: string) {
  try {
    window.sessionStorage.setItem(KEY, personId);
  } catch {
    // storage unavailable; the tree just opens without a selection
  }
}

export function takeRequestedSelection(): string | null {
  try {
    const id = window.sessionStorage.getItem(KEY);
    window.sessionStorage.removeItem(KEY);
    return id;
  } catch {
    return null;
  }
}
