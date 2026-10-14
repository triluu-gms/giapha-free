import { Router } from 'express';
import { requireAuth, requirePrivacyConsent, requireVerifiedEmail } from '../auth/middleware';
import { markEmailVerified } from '../auth/users';
import { HttpError } from '../errors';
import { tokenSchema } from '../schemas';
import {
  acceptInvitation,
  declineInvitation,
  findInvitationById,
  findInvitationByToken,
  pendingInvitationsFor,
} from '../trees/invitations';

export const invitationsRouter = Router();

const NOT_VALID = 'This invitation is no longer valid. It may have been accepted, revoked or replaced by a newer one.';

// GET /api/invitations/preview?token=... (public) -> what the invite landing page shows
invitationsRouter.get('/preview', async (req, res) => {
  const token = typeof req.query.token === 'string' ? req.query.token : '';
  const invitation = token ? await findInvitationByToken(token) : null;
  if (!invitation) throw new HttpError(404, NOT_VALID);
  const { email, role, treeName, inviterName, expired, expiresAt, editScope } = invitation;
  // editScope names the branch's root, so the invitee knows which part they'll be able to edit.
  res.json({ email, role, treeName, inviterName, expired, expiresAt, editScope });
});

// POST /api/invitations/accept { token } -> accept from the emailed link.
// The link was delivered to the invited address, so it also proves the user
// owns that address: an unverified account with the same email is verified here.
invitationsRouter.post('/accept', requireAuth, requirePrivacyConsent, async (req, res) => {
  const { token } = tokenSchema.parse(req.body);
  const invitation = await findInvitationByToken(token);
  if (!invitation) throw new HttpError(404, NOT_VALID);

  let user = req.user!;
  if (user.verificationRequired && user.email === invitation.email && !invitation.expired) {
    user = (await markEmailVerified(user.id)) ?? user;
  }
  res.json({ treeId: await acceptInvitation(invitation, user) });
});

// Everything below needs the accepted data agreement and a verified email.
invitationsRouter.use(requireAuth, requirePrivacyConsent, requireVerifiedEmail);

// GET /api/invitations/mine -> pending invitations for my email address
invitationsRouter.get('/mine', async (req, res) => {
  res.json(await pendingInvitationsFor(req.user!));
});

// POST /api/invitations/:id/accept -> accept from the in-app list
invitationsRouter.post('/:id/accept', async (req, res) => {
  const invitation = await findInvitationById(req.params.id);
  if (!invitation) throw new HttpError(404, NOT_VALID);
  res.json({ treeId: await acceptInvitation(invitation, req.user!) });
});

invitationsRouter.post('/:id/decline', async (req, res) => {
  const invitation = await findInvitationById(req.params.id);
  if (!invitation) throw new HttpError(404, NOT_VALID);
  await declineInvitation(invitation, req.user!);
  res.status(204).end();
});
