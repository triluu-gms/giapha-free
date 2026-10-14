import type { TreeApi } from './api';
import type { TreeData } from './types';

// The tree view's graphs, kept in memory for this tab so coming back to the tree
// draws it at once from the last copy while a fresh one loads (stale-while-revalidate),
// and so it can be fetched ahead of time while the user is on another page.

/** Family hops shown around a person by default: great-grandparents to great-grandchildren. */
export const DEFAULT_DEPTH = 3;

const MAX_ENTRIES = 12;
const cache = new Map<string, TreeData>();
const inflight = new Map<string, Promise<TreeData>>();

const keyOf = (treeId: string, rootId: string | null, depth: number) => `${treeId}|${rootId ?? '*'}|${rootId ? depth : ''}`;

/** The last graph loaded for this view, if any. */
export function cachedGraph(treeId: string, rootId: string | null, depth: number): TreeData | null {
  return cache.get(keyOf(treeId, rootId, depth)) ?? null;
}

/** Loads the graph (sharing a request already on its way) and remembers it. */
export function fetchGraph(api: TreeApi, treeId: string, rootId: string | null, depth: number): Promise<TreeData> {
  const key = keyOf(treeId, rootId, depth);
  const pending = inflight.get(key);
  if (pending) return pending;
  const request = api
    .getGraph(rootId ?? undefined, depth)
    .then((data) => {
      cache.delete(key); // re-insert, so the Map's order is least recently loaded first
      cache.set(key, data);
      while (cache.size > MAX_ENTRIES) cache.delete(cache.keys().next().value!);
      return data;
    })
    .finally(() => inflight.delete(key));
  inflight.set(key, request);
  return request;
}

/** Forgets every graph, e.g. when another account signs in on this tab. */
export function clearGraphCache() {
  cache.clear();
  inflight.clear();
}
