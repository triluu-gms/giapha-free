import type { Request, RequestHandler } from 'express';
import { HttpError, notFound } from '../errors';
import { getTreeAccess, hasTreeRole, type TreeRole } from './trees';

/** Loads the caller's membership of :treeId into req.tree. Non-members get 404. */
export const loadTree: RequestHandler = async (req, _res, next) => {
  if (!req.user) throw new HttpError(401, 'Authentication required');
  const treeId = req.params.treeId;
  const access = typeof treeId === 'string' ? await getTreeAccess(req.user.id, treeId) : null;
  if (!access) throw notFound('Tree');
  req.tree = access;
  next();
};

export const requireTreeRole =
  (minimum: TreeRole): RequestHandler =>
  (req, _res, next) => {
    if (!req.tree) throw notFound('Tree');
    if (!hasTreeRole(req.tree.role, minimum)) {
      throw new HttpError(403, minimum === 'owner' ? 'Only the tree owner can do this' : 'You have view-only access to this tree');
    }
    next();
  };

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/** Viewers can read; changing anything needs editor (or owner). */
export const editorForWrites: RequestHandler = (req, res, next) =>
  SAFE_METHODS.has(req.method) ? next() : requireTreeRole('editor')(req, res, next);

/**
 * Inviting people, managing members and the tree's settings: the tree's owner and
 * its admins. Every account owns its private tree, so every user can share their
 * own tree; editors and viewers can't share or manage a tree.
 */
export const requireTreeManager: RequestHandler = (req, _res, next) => {
  if (req.tree?.role !== 'owner' && req.tree?.role !== 'admin') {
    throw new HttpError(403, 'Only the owner or an admin of this tree can manage who has access and its settings');
  }
  next();
};

export type MemberRole = Exclude<TreeRole, 'owner'>;

/**
 * Roles the caller may give, change or take away: the owner manages everyone else
 * (admins included), an admin only editors and viewers.
 */
export function manageableRoles(req: Request): MemberRole[] {
  return req.tree?.role === 'owner' ? ['admin', 'editor', 'viewer'] : ['editor', 'viewer'];
}

export function assertCanGrant(req: Request, role: MemberRole) {
  if (!manageableRoles(req).includes(role)) {
    throw new HttpError(403, 'Only the tree owner can make someone an admin', 'ownerOnly');
  }
}

/** The current tree's id (routes behind loadTree). */
export function currentTreeId(req: Request): string {
  if (!req.tree) throw notFound('Tree');
  return req.tree.id;
}
