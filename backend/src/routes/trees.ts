import { Router } from 'express';
import { requestLocale } from '../auth/cookies';
import { HttpError, notFound } from '../errors';
import {
  importSchema,
  inviteSchema,
  linkMeSchema,
  memberRoleSchema,
  transferOwnershipSchema,
  treeRenameSchema,
} from '../schemas';
import {
  backupUpdateSchema,
  getBackupStatus,
  getDriveConnection,
  runBackup,
  updateBackupSchedule,
} from '../backups/backups';
import { exportCsv, exportFileStem, exportJson, loadTreeExport } from '../backups/exportTree';
import { setPersonReminder } from '../reminders/preferences';
import {
  accessLinkSchema,
  approveAccessRequest,
  createAccessLink,
  declineAccessRequest,
  getAccessLink,
  listAccessRequests,
  revokeAccessLink,
} from '../trees/accessRequests';
import { assertBranchRoot, assertNotBranchEditor, branchOf } from '../trees/branch';
import { loadExistingTree, planImport, runImport } from '../trees/importPeople';
import { assertPhotoInTree } from '../trees/photos';
import { addSampleFamily } from '../trees/sampleFamily';
import { treeSettingsUpdateSchema, updateTreeSettings } from '../trees/settings';
import {
  assertCanGrant,
  currentTreeId,
  editorForWrites,
  loadTree,
  manageableRoles,
  requireTreeManager,
  requireTreeRole,
} from '../trees/access';
import { createInvitation, listInvitations, resendInvitation, revokeInvitation, chargeInviteQuota } from '../trees/invitations';
import {
  createTree,
  deleteTree,
  ensurePersonalTree,
  linkMemberToPerson,
  listMembers,
  listTrees,
  MAX_OWNED_TREES,
  removeMember,
  renameTree,
  transferOwnership,
  unlinkMember,
  updateMemberRole,
} from '../trees/trees';
import { graphRouter } from './graph';
import { personsRouter } from './persons';
import { photosRouter } from './photos';
import { relationshipsRouter } from './relationships';

// Mounted at /api/trees behind requireAuth + requireVerifiedEmail.
export const treesRouter = Router();

const BACKUP_COOLDOWN_MS = 60 * 1000;

// GET /api/trees -> the user's own trees plus every tree shared with them
// Read first: only an account that owns no tree yet needs the (write) step that creates one.
treesRouter.get('/', async (req, res) => {
  let trees = await listTrees(req.user!.id);
  if (!trees.some((tree) => tree.role === 'owner')) {
    await ensurePersonalTree(req.user!, requestLocale(req));
    trees = await listTrees(req.user!.id);
  }
  res.json(trees);
});

// POST /api/trees { name } -> a new, empty tree owned by the caller
treesRouter.post('/', async (req, res) => {
  const { name } = treeRenameSchema.parse(req.body);
  const id = await createTree(req.user!.id, name);
  if (!id) {
    throw new HttpError(409, `You can own at most ${MAX_OWNED_TREES} trees`, 'treeLimit');
  }
  const created = (await listTrees(req.user!.id)).find((tree) => tree.id === id);
  res.status(201).json(created);
});

// Everything under /:treeId requires membership of that tree.
treesRouter.use('/:treeId', loadTree);

treesRouter.patch('/:treeId', requireTreeManager, async (req, res) => {
  const { name } = treeRenameSchema.parse(req.body);
  await renameTree(currentTreeId(req), name);
  res.json({ ...req.tree, name });
});

// ---- This tree's settings: members read them, the owner and admins change them ----
treesRouter.get('/:treeId/settings', (req, res) => {
  res.json(req.tree!.settings);
});

treesRouter.patch('/:treeId/settings', requireTreeManager, async (req, res) => {
  const changes = treeSettingsUpdateSchema.parse(req.body);
  res.json(await updateTreeSettings(currentTreeId(req), changes));
});

// ---- Backups to Google Drive and downloads: the owner and admins ----

// GET /api/trees/:treeId/backup -> the schedule and how the last backup went
treesRouter.get('/:treeId/backup', requireTreeManager, async (req, res) => {
  res.json(await getBackupStatus(currentTreeId(req)));
});

// PUT /api/trees/:treeId/backup { frequency, keep? } -> backups go to the caller's connected Drive
treesRouter.put('/:treeId/backup', requireTreeManager, async (req, res) => {
  const changes = backupUpdateSchema.parse(req.body);
  if (changes.frequency !== 'off' && !(await getDriveConnection(req.user!.id))) {
    throw new HttpError(400, 'Connect your Google Drive first', 'driveNotConnected');
  }
  res.json(await updateBackupSchedule(currentTreeId(req), req.user!.id, changes, requestLocale(req)));
});

// POST /api/trees/:treeId/backup/run -> backs up now (at most once a minute)
treesRouter.post('/:treeId/backup/run', requireTreeManager, async (req, res) => {
  const treeId = currentTreeId(req);
  const status = await getBackupStatus(treeId);
  if (status.frequency === 'off') throw new HttpError(409, 'Turn on backups first', 'backupOff');
  if (status.lastRunAt && Date.now() - Date.parse(status.lastRunAt) < BACKUP_COOLDOWN_MS) {
    throw new HttpError(429, 'A backup ran less than a minute ago', 'backupTooSoon');
  }
  const result = await runBackup(treeId);
  if (result === 'busy') throw new HttpError(409, 'A backup of this tree is already running', 'backupRunning');
  res.json(result);
});

// GET /api/trees/:treeId/export?format=csv|json -> the same files as a backup, downloaded
treesRouter.get('/:treeId/export', requireTreeManager, async (req, res) => {
  const format = req.query.format === 'json' ? 'json' : 'csv';
  const data = await loadTreeExport(currentTreeId(req));
  const now = new Date();
  const stem = exportFileStem(data.tree.name, now);
  res.setHeader('Content-Disposition', `attachment; filename="${stem}.${format}"`);
  res.setHeader('Cache-Control', 'no-store');
  if (format === 'json') res.type('application/json').send(exportJson(data, now.toISOString()));
  else res.type('text/csv; charset=utf-8').send(exportCsv(data, requestLocale(req)));
});

// ---- Tree content: viewers read, editors and owners write ----
treesRouter.use('/:treeId/persons', editorForWrites, personsRouter);
treesRouter.use('/:treeId/relationships', editorForWrites, relationshipsRouter);
treesRouter.use('/:treeId/photos', editorForWrites, photosRouter);
treesRouter.use('/:treeId/graph', graphRouter);

// GET /api/trees/:treeId/branch -> what the caller may edit when they are limited to a branch:
// { scope: null } for everyone else, or { scope, people: [{ id, level }] } where level is the
// generation below the branch's root (null for someone in it only as a spouse).
treesRouter.get('/:treeId/branch', async (req, res) => {
  const branch = await branchOf(req);
  if (!branch) {
    res.json({ scope: null });
    return;
  }
  res.json({
    scope: req.tree!.editScope,
    people: [...branch.levels].map(([id, level]) => ({ id, level, ...(branch.readOnly.has(id) && { readOnly: true }) })),
  });
});

// POST /api/trees/:treeId/import { people: [...], dryRun?, matches? }
// Adds people (and the parent/spouse links between them) from a filled-in
// template. Everything is checked first; nothing is written unless every row is valid.
// The dry run also lists, per row ID, people already in the tree who may be the same
// person (`candidates`); `matches` then says which rows stand for which of them.
// Not for editors limited to a branch: imported people aren't linked to anyone in the tree.
treesRouter.post('/:treeId/import', requireTreeRole('editor'), async (req, res) => {
  assertNotBranchEditor(req);
  const { people, dryRun, matches } = importSchema.parse(req.body);
  // Rows are checked one by one later; a photo path to another tree is refused up front.
  for (const person of people) assertPhotoInTree(currentTreeId(req), (person as { photoUrl?: unknown } | null)?.photoUrl);
  const { issues, plan, candidates } = planImport(people, await loadExistingTree(currentTreeId(req)), matches);
  const summary = plan && {
    people: plan.people,
    matched: plan.matched,
    parentLinks: plan.parentLinks,
    spouseLinks: plan.spouseLinks,
  };

  if (dryRun) {
    res.json({ valid: !!plan, rowErrors: issues, summary, candidates });
    return;
  }
  if (!plan) {
    res.status(400).json({ error: 'The file has errors; nothing was imported.', rowErrors: issues });
    return;
  }
  res.status(201).json(await runImport(currentTreeId(req), plan));
});

// POST /api/trees/:treeId/sample -> adds the sample family to the owner's empty tree.
// Owner only, so a sample never turns up in a tree someone shared.
treesRouter.post('/:treeId/sample', requireTreeRole('owner'), async (req, res) => {
  res.status(201).json(await addSampleFamily(currentTreeId(req)));
});

// ---- "This is me": link your own membership to a person in the tree ----
// Any member can do this (it changes only their own membership, not the tree).
// The tree then opens around that person, a few generations deep, instead of loading everyone.
treesRouter.put('/:treeId/me', async (req, res) => {
  const { personId } = linkMeSchema.parse(req.body);
  const status = await linkMemberToPerson(currentTreeId(req), req.user!.id, personId);
  if (status === 'notFound') throw notFound('Person');
  if (status === 'taken') {
    throw new HttpError(409, 'Another member of this tree is already linked to this person', 'personTaken');
  }
  res.json({ myPersonId: personId });
});

treesRouter.delete('/:treeId/me', async (req, res) => {
  await unlinkMember(currentTreeId(req), req.user!.id);
  res.status(204).end();
});

// ---- Death anniversary reminders: any member, for themselves ----
// PUT turns on email reminders of this person's ngày giỗ (needs a full death date); DELETE turns them off.
treesRouter.put('/:treeId/reminders/:personId', async (req, res) => {
  await setPersonReminder(req.user!.id, currentTreeId(req), String(req.params.personId), true, requestLocale(req));
  res.json({ remindMe: true });
});

treesRouter.delete('/:treeId/reminders/:personId', async (req, res) => {
  await setPersonReminder(req.user!.id, currentTreeId(req), String(req.params.personId), false, requestLocale(req));
  res.status(204).end();
});

// ---- Leaving a shared tree ----
treesRouter.delete('/:treeId/membership', async (req, res) => {
  if (req.tree!.role === 'owner') {
    throw new HttpError(400, "You can't leave a tree you own. Make someone else its owner first.");
  }
  await removeMember(currentTreeId(req), req.user!.id, ['admin', 'editor', 'viewer']);
  res.status(204).end();
});

// ---- Members and invitations: the tree's owner and admins ----
// Admins manage editors and viewers; only the owner manages admins (manageableRoles).
treesRouter.get('/:treeId/members', requireTreeManager, async (req, res) => {
  res.json(await listMembers(currentTreeId(req)));
});

treesRouter.patch('/:treeId/members/:userId', requireTreeManager, async (req, res) => {
  const { role, scope = null } = memberRoleSchema.parse(req.body);
  assertCanGrant(req, role);
  const treeId = currentTreeId(req);
  if (role === 'editor') await assertBranchRoot(treeId, scope);
  if (!(await updateMemberRole(treeId, String(req.params.userId), role, scope, manageableRoles(req)))) {
    throw notFound('Member');
  }
  res.json({ id: String(req.params.userId), role, scope: role === 'editor' ? scope : null });
});

treesRouter.delete('/:treeId/members/:userId', requireTreeManager, async (req, res) => {
  if (!(await removeMember(currentTreeId(req), String(req.params.userId), manageableRoles(req)))) {
    throw notFound('Member');
  }
  res.status(204).end();
});

// DELETE /api/trees/:treeId -> the tree and everything in it, for every member. Owner only.
treesRouter.delete('/:treeId', requireTreeRole('owner'), async (req, res) => {
  if (!(await deleteTree(currentTreeId(req)))) throw notFound('Tree');
  res.status(204).end();
});

// POST /api/trees/:treeId/transfer { userId } -> that member becomes the owner; you become an admin.
treesRouter.post('/:treeId/transfer', requireTreeRole('owner'), async (req, res) => {
  const { userId } = transferOwnershipSchema.parse(req.body);
  if (userId === req.user!.id) throw new HttpError(400, 'You already own this tree');
  const result = await transferOwnership(currentTreeId(req), req.user!.id, userId);
  if (result === 'notMember') throw notFound('Member');
  if (result === 'limit') {
    throw new HttpError(409, `That member already owns ${MAX_OWNED_TREES} trees, the most one account can own`, 'transferLimit');
  }
  res.json({ ownerId: userId, yourRole: 'admin' });
});

// ---- "Request access" link and the requests it brings: the owner and admins ----

// GET /api/trees/:treeId/access-link -> { url, createdAt, createdByName, expiresAt, expired } | null
treesRouter.get('/:treeId/access-link', requireTreeManager, async (req, res) => {
  res.json(await getAccessLink(currentTreeId(req)));
});

// POST /api/trees/:treeId/access-link { expiresInDays: 7 | 30 | null } -> a new link (the old one stops working)
treesRouter.post('/:treeId/access-link', requireTreeManager, async (req, res) => {
  const { expiresInDays } = accessLinkSchema.parse(req.body);
  res.status(201).json(await createAccessLink(currentTreeId(req), req.user!.id, expiresInDays));
});

treesRouter.delete('/:treeId/access-link', requireTreeManager, async (req, res) => {
  await revokeAccessLink(currentTreeId(req));
  res.status(204).end();
});

treesRouter.get('/:treeId/access-requests', requireTreeManager, async (req, res) => {
  res.json(await listAccessRequests(currentTreeId(req)));
});

// POST /api/trees/:treeId/access-requests/:userId/approve { role, scope? } -> grants access, emails the requester
treesRouter.post('/:treeId/access-requests/:userId/approve', requireTreeManager, async (req, res) => {
  const { role, scope = null } = memberRoleSchema.parse(req.body);
  assertCanGrant(req, role);
  const treeId = currentTreeId(req);
  if (role === 'editor') await assertBranchRoot(treeId, scope);
  if (!(await approveAccessRequest(treeId, String(req.params.userId), role, scope, requestLocale(req)))) {
    throw notFound('Access request');
  }
  res.status(204).end();
});

// DELETE /api/trees/:treeId/access-requests/:userId -> declines, emails the requester
treesRouter.delete('/:treeId/access-requests/:userId', requireTreeManager, async (req, res) => {
  if (!(await declineAccessRequest(currentTreeId(req), String(req.params.userId), requestLocale(req)))) {
    throw notFound('Access request');
  }
  res.status(204).end();
});

treesRouter.get('/:treeId/invitations', requireTreeManager, async (req, res) => {
  res.json(await listInvitations(currentTreeId(req)));
});

treesRouter.post('/:treeId/invitations', requireTreeManager, async (req, res) => {
  const { email, role, scope = null } = inviteSchema.parse(req.body);
  if (email === req.user!.email) throw new HttpError(400, "You can't invite yourself");
  assertCanGrant(req, role);
  const treeId = currentTreeId(req);
  if (role === 'editor') await assertBranchRoot(treeId, scope);
  await chargeInviteQuota(req.user!);
  const invitation = await createInvitation({
    treeId,
    email,
    role,
    scope,
    invitedBy: req.user!.id,
    manageable: manageableRoles(req),
  });
  res.status(201).json(invitation);
});

treesRouter.post('/:treeId/invitations/:id/resend', requireTreeManager, async (req, res) => {
  await chargeInviteQuota(req.user!);
  const invitation = await resendInvitation(currentTreeId(req), String(req.params.id), manageableRoles(req));
  if (!invitation) throw notFound('Invitation');
  res.json(invitation);
});

treesRouter.delete('/:treeId/invitations/:id', requireTreeManager, async (req, res) => {
  if (!(await revokeInvitation(currentTreeId(req), String(req.params.id), manageableRoles(req)))) {
    throw notFound('Invitation');
  }
  res.status(204).end();
});
