import type {
  AccessLink,
  AccessRequest,
  AuthProviderInfo,
  BackupFrequency,
  BackupStatus,
  BranchInfo,
  DriveStatus,
  EditScopeInput,
  ImportCheck,
  ImportMatches,
  ImportRowInput,
  ImportSummary,
  Invitation,
  InvitationPreview,
  InviteRole,
  JoinPreview,
  Person,
  PersonDetail,
  PersonInput,
  PersonLink,
  RelationshipType,
  ReminderPreferences,
  TreeData,
  TreeMember,
  TreeSettings,
  TreeSummary,
  User,
} from './types';

// Requests go to this app's own /api/*, which next.config.ts proxies to the
// backend. Being same-origin, the HttpOnly session cookie is sent automatically.

/** Fired when the API answers 401, so the app can return to the login page. */
export const AUTH_EXPIRED_EVENT = 'familyTree:auth-expired';

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    /** Set for errors the UI translates itself (`error.<code>` in i18n.ts). */
    public readonly code?: string,
  ) {
    super(message);
  }
}

async function request<T>(path: string, init?: RequestInit, options?: { quiet?: boolean }): Promise<T> {
  const res = await fetch(path, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      // Required by the API on state-changing requests (CSRF protection).
      'X-Requested-With': 'fetch',
      ...init?.headers,
    },
    credentials: 'same-origin',
    cache: 'no-store',
  });
  if (!res.ok) {
    let message = `Request failed (${res.status})`;
    let code: string | undefined;
    try {
      const body = await res.json();
      message = body.issues?.length
        ? body.issues.map((i: { path: string; message: string }) => `${i.path}: ${i.message}`).join('; ')
        : (body.error ?? message);
      if (typeof body.code === 'string') code = body.code;
    } catch {
      // non-JSON error body; keep the generic message
    }
    if (res.status === 401 && !options?.quiet) window.dispatchEvent(new Event(AUTH_EXPIRED_EVENT));
    throw new ApiError(res.status, message, code);
  }
  return (res.status === 204 ? undefined : await res.json()) as T;
}

const enc = encodeURIComponent;

const qs = (params: Record<string, string | number | undefined>) => {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== '') search.set(key, String(value));
  }
  const s = search.toString();
  return s ? `?${s}` : '';
};

export const api = {
  health: () => request<{ status: string; database: string; error?: string }>('/api/health'),
  features: () => request<{ photoUploads: boolean; driveBackups: boolean }>('/api/features'),

  // ---- The user's own Google Drive (for tree backups) ----
  driveStatus: () => request<DriveStatus>('/api/drive'),
  /** Full-page navigation to Google's consent screen; comes back to `next` with ?drive=<result>. */
  driveConnectUrl: (next: string) => `/api/drive/connect${qs({ next })}`,
  disconnectDrive: () => request<void>('/api/drive', { method: 'DELETE' }),

  // ---- Auth ----
  authProviders: () => request<AuthProviderInfo[]>('/api/auth/providers'),
  me: () => request<User>('/api/auth/me'),
  /** Changes the signed-in user's display name. */
  updateProfile: (name: string) =>
    request<User>('/api/auth/me', { method: 'PATCH', body: JSON.stringify({ name }) }),
  /** Full-page URL that starts social login/registration and returns to `next` afterwards. */
  loginUrl: (provider: string, next = '/') => `/api/auth/${encodeURIComponent(provider)}/login${qs({ next })}`,
  logout: () => request<void>('/api/auth/logout', { method: 'POST' }),
  register: (input: { name: string; email: string; password: string; inviteToken?: string; privacyVersion: string }) =>
    request<User & { joinedTreeId?: string }>('/api/auth/register', { method: 'POST', body: JSON.stringify(input) }),
  passwordLogin: (email: string, password: string) =>
    request<User>('/api/auth/login', { method: 'POST', body: JSON.stringify({ email, password }) }),
  verifyEmail: (token: string) =>
    request<{ verified: boolean; email: string | null }>('/api/auth/verify-email', {
      method: 'POST',
      body: JSON.stringify({ token }),
    }),
  resendVerification: () =>
    request<{ sent: boolean; alreadyVerified?: boolean }>('/api/auth/resend-verification', { method: 'POST' }),
  forgotPassword: (email: string) =>
    request<{ sent: boolean }>('/api/auth/forgot-password', { method: 'POST', body: JSON.stringify({ email }) }),
  /** Sets the new password from an emailed link and signs in. */
  resetPassword: (token: string, password: string) =>
    request<User>('/api/auth/reset-password', { method: 'POST', body: JSON.stringify({ token, password }) }),
  changePassword: (currentPassword: string, newPassword: string) =>
    request<User>('/api/auth/change-password', {
      method: 'POST',
      body: JSON.stringify({ currentPassword, newPassword }),
    }),

  /** Emails a confirmation link to the new address; the account keeps its email until it's clicked. */
  requestEmailChange: (email: string, password?: string) =>
    request<User>('/api/auth/email', { method: 'POST', body: JSON.stringify({ email, password }) }),
  confirmEmailChange: (token: string) =>
    request<{ email: string }>('/api/auth/email/confirm', { method: 'POST', body: JSON.stringify({ token }) }),
  cancelEmailChange: () => request<User>('/api/auth/email', { method: 'DELETE' }),
  /** Accepts the personal data agreement version the user was shown. */
  acceptPrivacy: (version: string) =>
    request<User>('/api/auth/privacy', { method: 'POST', body: JSON.stringify({ version }) }),
  /** Withdraws consent: trees, invitations and reminders stop until it is given again. */
  withdrawPrivacy: () => request<User>('/api/auth/privacy', { method: 'DELETE' }),
  /** Deletes the account and the trees it owns. Confirm with the password, or (no password) the email typed out. */
  deleteAccount: (proof: { password?: string; confirm?: string }) =>
    request<void>('/api/auth/delete-account', { method: 'POST', body: JSON.stringify(proof) }),

  /** Death anniversary reminder emails: the switch, how early, and who for. */
  reminderPreferences: () => request<ReminderPreferences>('/api/auth/reminders'),
  updateReminderPreferences: (changes: { enabled?: boolean; daysBefore?: number }) =>
    request<ReminderPreferences>('/api/auth/reminders', { method: 'PATCH', body: JSON.stringify(changes) }),

  // ---- Trees ----
  listTrees: () => request<TreeSummary[]>('/api/trees'),
  /**
   * The same, fetched speculatively while /api/auth/me is still loading: null
   * instead of an error (signed out, agreement not accepted…), and no sign-out event.
   */
  prefetchTrees: () => request<TreeSummary[]>('/api/trees', undefined, { quiet: true }).catch(() => null),
  /** A new, empty tree that you own. */
  createTree: (name: string) =>
    request<TreeSummary>('/api/trees', { method: 'POST', body: JSON.stringify({ name }) }),
  renameTree: (treeId: string, name: string) =>
    request<TreeSummary>(`/api/trees/${enc(treeId)}`, { method: 'PATCH', body: JSON.stringify({ name }) }),
  /** Owner only: deletes the tree and everything in it, for every member. */
  deleteTree: (treeId: string) => request<void>(`/api/trees/${enc(treeId)}`, { method: 'DELETE' }),
  leaveTree: (treeId: string) => request<void>(`/api/trees/${enc(treeId)}/membership`, { method: 'DELETE' }),
  listMembers: (treeId: string) => request<TreeMember[]>(`/api/trees/${enc(treeId)}/members`),
  /** `scope` limits an editor to one branch; null gives them the whole tree. */
  updateMember: (treeId: string, userId: string, role: InviteRole, scope: EditScopeInput | null = null) =>
    request<void>(`/api/trees/${enc(treeId)}/members/${enc(userId)}`, {
      method: 'PATCH',
      body: JSON.stringify({ role, scope }),
    }),
  removeMember: (treeId: string, userId: string) =>
    request<void>(`/api/trees/${enc(treeId)}/members/${enc(userId)}`, { method: 'DELETE' }),
  /** Owner only: that member becomes the owner, and you stay on as an admin. */
  transferOwnership: (treeId: string, userId: string) =>
    request<{ ownerId: string }>(`/api/trees/${enc(treeId)}/transfer`, {
      method: 'POST',
      body: JSON.stringify({ userId }),
    }),

  // ---- Invitations ----
  listInvitations: (treeId: string) => request<Invitation[]>(`/api/trees/${enc(treeId)}/invitations`),
  invite: (treeId: string, email: string, role: InviteRole, scope: EditScopeInput | null = null) =>
    request<Invitation>(`/api/trees/${enc(treeId)}/invitations`, {
      method: 'POST',
      body: JSON.stringify({ email, role, scope }),
    }),
  resendInvitation: (treeId: string, id: string) =>
    request<Invitation>(`/api/trees/${enc(treeId)}/invitations/${enc(id)}/resend`, { method: 'POST' }),
  revokeInvitation: (treeId: string, id: string) =>
    request<void>(`/api/trees/${enc(treeId)}/invitations/${enc(id)}`, { method: 'DELETE' }),

  // ---- "Request access" link (owner and admins) ----
  getAccessLink: (treeId: string) => request<AccessLink | null>(`/api/trees/${enc(treeId)}/access-link`),
  /** A new link; the previous one stops working. */
  createAccessLink: (treeId: string, expiresInDays: 7 | 30 | null) =>
    request<AccessLink>(`/api/trees/${enc(treeId)}/access-link`, {
      method: 'POST',
      body: JSON.stringify({ expiresInDays }),
    }),
  revokeAccessLink: (treeId: string) => request<void>(`/api/trees/${enc(treeId)}/access-link`, { method: 'DELETE' }),
  listAccessRequests: (treeId: string) => request<AccessRequest[]>(`/api/trees/${enc(treeId)}/access-requests`),
  approveAccessRequest: (treeId: string, userId: string, role: InviteRole) =>
    request<void>(`/api/trees/${enc(treeId)}/access-requests/${enc(userId)}/approve`, {
      method: 'POST',
      body: JSON.stringify({ role }),
    }),
  declineAccessRequest: (treeId: string, userId: string) =>
    request<void>(`/api/trees/${enc(treeId)}/access-requests/${enc(userId)}`, { method: 'DELETE' }),

  // ---- The /join page (anyone with the link) ----
  joinPreview: (token: string) =>
    request<JoinPreview>('/api/join/preview', { method: 'POST', body: JSON.stringify({ token }) }),
  requestAccess: (token: string, message?: string) =>
    request<{ status: 'pending' | 'member'; treeId?: string }>('/api/join/request', {
      method: 'POST',
      body: JSON.stringify({ token, message: message || undefined }),
    }),
  cancelAccessRequest: (token: string) =>
    request<void>('/api/join/request', { method: 'DELETE', body: JSON.stringify({ token }) }),
  previewInvitation: (token: string) =>
    request<InvitationPreview>('/api/invitations/preview', { method: 'POST', body: JSON.stringify({ token }) }),
  myInvitations: () => request<Invitation[]>('/api/invitations/mine'),
  acceptInvitationToken: (token: string) =>
    request<{ treeId: string }>('/api/invitations/accept', { method: 'POST', body: JSON.stringify({ token }) }),
  acceptInvitation: (id: string) => request<{ treeId: string }>(`/api/invitations/${enc(id)}/accept`, { method: 'POST' }),
  declineInvitation: (id: string) => request<void>(`/api/invitations/${enc(id)}/decline`, { method: 'POST' }),

};

/** People, relationships and the graph of one tree. */
export function treeApi(treeId: string) {
  const base = `/api/trees/${enc(treeId)}`;
  return {
    listPeople: (search?: string, limit?: number) => request<Person[]>(`${base}/persons${qs({ search, limit })}`),
    getPerson: (id: string) => request<PersonDetail>(`${base}/persons/${enc(id)}`),
    /** With `link`, the new person is added as that relative of an existing one in the same step. */
    createPerson: (input: PersonInput, link?: PersonLink) =>
      request<Person>(`${base}/persons`, { method: 'POST', body: JSON.stringify({ ...input, link }) }),
    updatePerson: (id: string, input: PersonInput) =>
      request<Person>(`${base}/persons/${enc(id)}`, { method: 'PATCH', body: JSON.stringify(input) }),
    deletePerson: (id: string) => request<void>(`${base}/persons/${enc(id)}`, { method: 'DELETE' }),
    /** Deletes several people (and their relationships) at once. */
    deletePeople: (ids: string[]) =>
      request<{ deleted: number }>(`${base}/persons/delete`, { method: 'POST', body: JSON.stringify({ ids }) }),

    addRelationship: (type: RelationshipType, fromId: string, toId: string) =>
      request<void>(`${base}/relationships`, { method: 'POST', body: JSON.stringify({ type, fromId, toId }) }),
    removeRelationship: (type: RelationshipType, fromId: string, toId: string) =>
      request<void>(`${base}/relationships${qs({ type, fromId, toId })}`, { method: 'DELETE' }),

    /** Stores an image; save the returned url as a person's photoUrl. */
    uploadPhoto: (image: Blob) =>
      request<{ id: string; url: string }>(`${base}/photos`, {
        method: 'POST',
        body: image,
        headers: { 'Content-Type': image.type || 'application/octet-stream' },
      }),

    /** "This is me": links your membership of this tree to a person (replacing an earlier link). */
    linkMe: (personId: string) =>
      request<{ myPersonId: string }>(`${base}/me`, { method: 'PUT', body: JSON.stringify({ personId }) }),
    unlinkMe: () => request<void>(`${base}/me`, { method: 'DELETE' }),

    /** Email reminders of this person's death anniversary, for you (any member; needs a full death date). */
    setReminder: (personId: string, on: boolean) =>
      request<unknown>(`${base}/reminders/${enc(personId)}`, { method: on ? 'PUT' : 'DELETE' }),

    /** Who you may change, when you are an editor limited to one branch of this tree. */
    getBranch: () => request<BranchInfo>(`${base}/branch`),

    getGraph: (rootId?: string, depth?: number) =>
      request<TreeData>(`${base}/graph${qs({ rootId, depth: rootId ? depth : undefined })}`),

    /**
     * Validates rows from an import file without writing anything, and finds people
     * already in the tree who may be on a row. `matches` says which rows stand for them.
     */
    checkImport: (people: ImportRowInput[], matches: ImportMatches = {}) =>
      request<ImportCheck>(`${base}/import`, {
        method: 'POST',
        body: JSON.stringify({ people, matches, dryRun: true }),
      }),
    importPeople: (people: ImportRowInput[], matches: ImportMatches = {}) =>
      request<ImportSummary>(`${base}/import`, { method: 'POST', body: JSON.stringify({ people, matches }) }),
    /** Merges `removeId` into `keepId` (relationships, reminders, links); `fields` are the kept values. */
    mergePeople: (keepId: string, removeId: string, fields: PersonInput) =>
      request<Person>(`${base}/persons/merge`, { method: 'POST', body: JSON.stringify({ keepId, removeId, fields }) }),
    /** Changes this tree's settings (its owner only). Read them from the tree summary. */
    updateSettings: (changes: Partial<TreeSettings>) =>
      request<TreeSettings>(`${base}/settings`, { method: 'PATCH', body: JSON.stringify(changes) }),
    /** Scheduled backups to an admin's Google Drive. */
    backupStatus: () => request<BackupStatus>(`${base}/backup`),
    updateBackup: (changes: { frequency: BackupFrequency | 'off'; keep?: number }) =>
      request<BackupStatus>(`${base}/backup`, { method: 'PUT', body: JSON.stringify(changes) }),
    runBackup: () => request<BackupStatus>(`${base}/backup/run`, { method: 'POST' }),
    /** Same-origin download of the tree as the import CSV or a full JSON file (a plain link, so the browser saves it). */
    exportUrl: (format: 'csv' | 'json') => `${base}/export?format=${format}`,
    /** Fills the owner's empty tree with a sample Vietnamese family to try the app with. */
    loadSampleFamily: () => request<ImportSummary>(`${base}/sample`, { method: 'POST' }),
  };
}

export type TreeApi = ReturnType<typeof treeApi>;
