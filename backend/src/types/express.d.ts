import type { AuthUser } from '../auth/users';
import type { TreeAccess } from '../trees/trees';

declare global {
  namespace Express {
    interface Request {
      /** Set by requireAuth. */
      user?: AuthUser;
      /** Set by loadTree: the tree in the URL and the caller's role in it. */
      tree?: TreeAccess;
    }
  }
}

export {};
