import type { AuthUser } from '../auth/users';
import type { TreeAccess } from '../trees/trees';

declare global {
  namespace Express {
    interface Request {
      /** Set by requireAuth. */
      user?: AuthUser;
      /** Set by loadTree: the tree in the URL and the caller's role in it. */
      tree?: TreeAccess;
      /** Set by requireAuthForTrees: the caller's access to the tree in the URL, read with the session. */
      prefetchedTree?: { id: string; access: TreeAccess | null };
    }
  }
}

export {};
