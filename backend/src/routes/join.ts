import { Router } from 'express';
import { requestLocale } from '../auth/cookies';
import { requireAuth, requirePrivacyConsent, requireVerifiedEmail } from '../auth/middleware';
import { HttpError } from '../errors';
import {
  accessRequestSchema,
  accessStatus,
  cancelAccessRequest,
  previewAccessLink,
  requestAccess,
} from '../trees/accessRequests';

// The /join/<token> page: asking for access to a tree through its shared link
// (see trees/accessRequests.ts). Mounted at /api/join.

export const joinRouter = Router();

const INVALID = () => new HttpError(404, 'This link is no longer valid. Ask for a new one.', 'accessLinkInvalid');

// GET /api/join/preview?token= (public) -> { treeName, sharedBy, expired, status, treeId? }
// status is 'anonymous' when not signed in; treeId only for members (to open the tree).
joinRouter.get('/preview', async (req, res) => {
  const token = typeof req.query.token === 'string' ? req.query.token : '';
  const link = token ? await previewAccessLink(token) : null;
  if (!link) throw INVALID();

  // The session is optional here: signed-in visitors also see where their request stands.
  let signedIn = false;
  try {
    await requireAuth(req, res, () => undefined);
    signedIn = Boolean(req.user);
  } catch {
    signedIn = false;
  }
  const status = signedIn ? await accessStatus(link.treeId, req.user!.id) : 'anonymous';
  res.json({
    treeName: link.treeName,
    sharedBy: link.sharedBy,
    expired: link.expired,
    status,
    ...(status === 'member' ? { treeId: link.treeId } : {}),
  });
});

// Asking needs an account that accepted the data agreement and verified its email.
joinRouter.use(requireAuth, requirePrivacyConsent, requireVerifiedEmail);

// POST /api/join/request { token, message? } -> { status: 'pending' | 'member', treeId? }
joinRouter.post('/request', async (req, res) => {
  const { token, message } = accessRequestSchema.parse(req.body);
  const { status, treeId } = await requestAccess(token, req.user!, message, requestLocale(req));
  res.status(status === 'pending' ? 201 : 200).json({ status, ...(status === 'member' ? { treeId } : {}) });
});

// DELETE /api/join/request?token= -> withdraws your pending request
joinRouter.delete('/request', async (req, res) => {
  const token = typeof req.query.token === 'string' ? req.query.token : '';
  const link = token ? await previewAccessLink(token) : null;
  if (!link) throw INVALID();
  await cancelAccessRequest(link.treeId, req.user!.id);
  res.status(204).end();
});
