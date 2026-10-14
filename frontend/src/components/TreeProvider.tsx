'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { api, treeApi, type TreeApi } from '@/lib/api';
import { getRememberedTree, rememberTree } from '@/lib/currentTree';
import { cachedGraph, clearGraphCache, DEFAULT_DEPTH, fetchGraph } from '@/lib/graphCache';
import type { TreeSummary } from '@/lib/types';
import { useAuth } from './AuthProvider';

interface TreeContextValue {
  trees: TreeSummary[];
  loading: boolean;
  error: string | null;
  /** The tree currently shown; the user's own tree unless they switched. */
  current: TreeSummary | null;
  /** API for people/relationships in the current tree. */
  currentApi: TreeApi | null;
  canEdit: boolean;
  /** An editor limited to one branch of the current tree (see useEditAccess for who they may change). */
  branchOnly: boolean;
  /** Owner or admin of the current tree: may invite people, manage members and change the tree's settings. */
  canManage: boolean;
  /** Owner of the current tree: also manages admins and can hand the tree over. */
  isOwner: boolean;
  switchTree: (id: string) => void;
  refreshTrees: (selectId?: string) => Promise<void>;
}

const TreeContext = createContext<TreeContextValue | null>(null);

export function TreeProvider({ children }: { children: ReactNode }) {
  const { user, status } = useAuth();
  const [trees, setTrees] = useState<TreeSummary[]>([]);
  const [currentId, setCurrentId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const ready = status === 'authenticated' && !!user && !user.verificationRequired && !user.consentRequired;

  // The tree list needs only the session cookie, so on page load it is fetched at the
  // same time as /api/auth/me instead of after it; the first refresh uses that answer.
  const prefetched = useRef<Promise<TreeSummary[] | null> | null>(null);
  useEffect(() => {
    prefetched.current = api.prefetchTrees();
  }, []);

  const refreshTrees = useCallback(async (selectId?: string) => {
    setLoading(true);
    try {
      const early = prefetched.current;
      prefetched.current = null;
      const list = (early && (await early)) || (await api.listTrees());
      setTrees(list);
      setError(null);
      setCurrentId((prev) => {
        // Falls back to the user's own tree if the previous one is gone (left or revoked).
        const wanted = selectId ?? prev ?? getRememberedTree();
        const next = list.find((t) => t.id === wanted) ?? list.find((t) => t.role === 'owner') ?? list[0];
        if (next) rememberTree(next.id);
        return next?.id ?? null;
      });
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (ready) void refreshTrees();
    else {
      setTrees([]);
      setCurrentId(null);
    }
  }, [ready, user?.id, refreshTrees]);

  // Graphs are per account: never show one account's copy to the next on this tab.
  useEffect(() => clearGraphCache, [user?.id]);

  const switchTree = useCallback((id: string) => {
    setCurrentId(id);
    rememberTree(id);
  }, []);

  // One API object per tree: components refetch when it changes, so it must not be
  // recreated whenever the tree list reloads (e.g. `loading` flipping in refreshTrees).
  const currentIdApi = useMemo(() => (currentId ? treeApi(currentId) : null), [currentId]);

  // While the browser is idle, load the current tree's default view (around "This is me",
  // or everyone), so opening the tree from another page draws it without waiting.
  const current = trees.find((t) => t.id === currentId);
  const warmRoot = current?.myPersonId ?? null;
  useEffect(() => {
    if (!currentIdApi || !currentId) return;
    const warm = () => {
      if (cachedGraph(currentId, warmRoot, DEFAULT_DEPTH)) return; // the tree page already has it
      void fetchGraph(currentIdApi, currentId, warmRoot, DEFAULT_DEPTH).catch(() => undefined);
    };
    if ('requestIdleCallback' in window) {
      const handle = window.requestIdleCallback(warm, { timeout: 2000 });
      return () => window.cancelIdleCallback(handle);
    }
    const handle = setTimeout(warm, 300);
    return () => clearTimeout(handle);
  }, [currentIdApi, currentId, warmRoot]);

  const value = useMemo<TreeContextValue>(() => {
    const current = trees.find((t) => t.id === currentId) ?? null;
    return {
      trees,
      loading,
      error,
      current,
      currentApi: current ? currentIdApi : null,
      canEdit: !!current && current.role !== 'viewer',
      branchOnly: current?.role === 'editor' && !!current.editScope,
      canManage: current?.role === 'owner' || current?.role === 'admin',
      isOwner: current?.role === 'owner',
      switchTree,
      refreshTrees,
    };
  }, [trees, currentId, currentIdApi, loading, error, switchTree, refreshTrees]);

  return <TreeContext.Provider value={value}>{children}</TreeContext.Provider>;
}

export function useTrees(): TreeContextValue {
  const ctx = useContext(TreeContext);
  if (!ctx) throw new Error('useTrees must be used inside <TreeProvider>');
  return ctx;
}

/** For components rendered inside <RequireAuth> (which waits for a tree). */
export function useCurrentTree() {
  const ctx = useTrees();
  if (!ctx.current || !ctx.currentApi) throw new Error('No current tree');
  return { ...ctx, tree: ctx.current, treeApi: ctx.currentApi };
}
