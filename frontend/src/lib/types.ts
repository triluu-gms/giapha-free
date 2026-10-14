export type Gender = 'male' | 'female' | 'other' | 'unknown';

export interface Person {
  id: string;
  firstName: string;
  lastName?: string | null;
  gender?: Gender;
  birthDate?: string | null;
  deathDate?: string | null;
  birthPlace?: string | null;
  address?: string | null;
  photoUrl?: string | null;
  bio?: string | null;
  createdAt?: string;
  updatedAt?: string;
}

/** One tree's settings; the tree's owner changes them on /settings. */
export interface TreeSettings {
  /** Editors can select several people on the People page and delete them at once. */
  bulkDelete: boolean;
  /** How birth dates are shown and entered. Dates are always stored as solar (Gregorian) dates. */
  birthCalendar: CalendarKind;
  /** The same for death dates, which Vietnamese families usually keep in âm lịch (for ngày giỗ). */
  deathCalendar: CalendarKind;
}

/** Which of a person's dates. */
export type DateKind = 'birth' | 'death';

/** solar: Gregorian. lunisolar: the Vietnamese lunar calendar (âm lịch). */
export type CalendarKind = 'solar' | 'lunisolar';

export type PersonInput = Partial<Omit<Person, 'id' | 'createdAt' | 'updatedAt'>>;

/**
 * The few fields the tree view and relative lists get (backend trees/summary.ts):
 * enough for a card, the layout and kinship terms. The rest of a person's details
 * come with GET /persons/:id, for the person clicked.
 */
export type PersonSummary = Pick<Person, 'id' | 'firstName' | 'lastName' | 'gender' | 'birthDate' | 'deathDate'>;

export interface PersonDetail {
  /** Everything about this person. */
  person: Person;
  parents: PersonSummary[];
  children: PersonSummary[];
  spouses: PersonSummary[];
  /** You get email reminders of this person's death anniversary (ngày giỗ). */
  remindMe: boolean;
}

/** Account preferences for death anniversary (ngày giỗ) reminder emails. */
export interface ReminderPreferences {
  enabled: boolean;
  /** How many days before the anniversary the email comes (0 = on the day). */
  daysBefore: number;
  people: {
    personId: string;
    firstName: string;
    lastName: string | null;
    deathDate: string | null;
    treeId: string;
    treeName: string;
  }[];
}

/** One spreadsheet row for POST /api/trees/:treeId/import. Dates and gender may still be invalid; the API checks them. */
export interface ImportRowInput {
  /** Spreadsheet row number (the header is row 1). */
  row: number;
  /** The row's ID, referred to by fatherKey/motherKey/spouseKeys. */
  key: string;
  firstName: string;
  lastName?: string;
  gender?: string;
  birthDate?: string;
  deathDate?: string;
  birthPlace?: string;
  address?: string;
  photoUrl?: string;
  bio?: string;
  fatherKey?: string;
  motherKey?: string;
  spouseKeys?: string[];
}

export interface ImportRowError {
  row: number;
  field?: string;
  message: string;
  /** Translatable error code (see `error.*` in i18n.ts); `message` is the English fallback. */
  code?: string;
}

export interface ImportSummary {
  /** New people created. */
  people: number;
  /** Rows that stood for people already in the tree. */
  matched: number;
  parentLinks: number;
  spouseLinks: number;
}

/** Someone already in the tree who may be the person on an import row. */
export interface ImportCandidate {
  id: string;
  firstName: string;
  lastName: string | null;
  birthDate: string | null;
  deathDate: string | null;
  /** Same name and same birth year; otherwise only the name matches. */
  strong: boolean;
}

export interface ImportCheck {
  valid: boolean;
  rowErrors: ImportRowError[];
  summary: ImportSummary | null;
  /** Row ID (lowercased) -> people already in the tree who may be that row. */
  candidates: Record<string, ImportCandidate[]>;
}

/** Row ID -> id of the person already in the tree that row stands for. */
export type ImportMatches = Record<string, string>;

export type RelationshipType = 'PARENT_OF' | 'SPOUSE_OF';

export interface TreeEdge {
  type: RelationshipType;
  from: string;
  to: string;
}

/** GET /graph: the tree's people as summaries, and the links between them. */
export interface TreeData {
  nodes: PersonSummary[];
  edges: TreeEdge[];
}

/** A signed-in account. Accounts are separate: each manages only its own tree. */
export interface User {
  id: string;
  email: string | null;
  emailVerified: boolean;
  /** Email+password account that hasn't confirmed its address yet. */
  verificationRequired: boolean;
  /** False for accounts that only sign in through Google or GitHub. */
  hasPassword: boolean;
  name: string | null;
  avatarUrl: string | null;
  createdAt: string;
  lastLoginAt: string;
}

export interface AuthProviderInfo {
  id: string;
  name: string;
}

/** Per tree. Admins edit everything and manage sharing and settings; only the owner manages admins and hands the tree over. */
export type TreeRole = 'owner' | 'admin' | 'editor' | 'viewer';
export type InviteRole = Exclude<TreeRole, 'owner'>;

/** "All generations" for a branch; matches BRANCH_MAX_DEPTH in the API. */
export const BRANCH_MAX_DEPTH = 20;

/**
 * Limits an editor to one branch: `rootId`, their descendants down to `depth`
 * generations below them, and the spouses of all of those.
 */
export interface EditScopeInput {
  rootId: string;
  depth: number;
}

export interface EditScope extends EditScopeInput {
  /** The branch's first person; null once they have been deleted (the editor can then change nobody). */
  root: Pick<Person, 'id' | 'firstName' | 'lastName'> | null;
}

/** GET /branch: who the caller may change, when they are limited to a branch. */
export type BranchInfo =
  | { scope: null }
  | {
      scope: EditScope;
      /** level: generations below the root; null for someone in the branch only as a spouse. */
      people: { id: string; level: number | null }[];
    };

export interface TreeSummary {
  id: string;
  name: string;
  role: TreeRole;
  settings: TreeSettings;
  /** The person in this tree you said is you ("This is me"), if any. The tree opens around them. */
  myPersonId: string | null;
  /** Set when you are an editor limited to one branch of this tree. */
  editScope: EditScope | null;
  ownerName: string | null;
  personCount: number;
  memberCount: number;
}

export interface TreeMember {
  id: string;
  name: string | null;
  email: string | null;
  avatarUrl: string | null;
  role: TreeRole;
  since: string | null;
  /** The person this member said is them in the tree, if any. */
  person: Pick<Person, 'id' | 'firstName' | 'lastName'> | null;
  /** The branch this editor is limited to; null for the whole tree. */
  editScope: EditScope | null;
}

export interface Invitation {
  id: string;
  email: string;
  role: InviteRole;
  treeId: string;
  treeName: string;
  inviterName: string;
  createdAt: string;
  expiresAt: string;
  expired: boolean;
  /** Editors only: the branch they'll be limited to; null for the whole tree. */
  editScope: EditScope | null;
}

export type InvitationPreview = Pick<
  Invitation,
  'email' | 'role' | 'treeName' | 'inviterName' | 'expired' | 'expiresAt' | 'editScope'
>;

/** Adds a new person as a relative of an existing one, in one request. */
export interface PersonLink {
  relation: 'parent' | 'child' | 'spouse';
  personId: string;
}
