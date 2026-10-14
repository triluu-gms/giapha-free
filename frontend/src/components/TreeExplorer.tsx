'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from '@/lib/api';
import { cachedGraph, DEFAULT_DEPTH, fetchGraph } from '@/lib/graphCache';
import { computeKinship } from '@/lib/kinship';
import { takeRequestedSelection } from '@/lib/selection';
import type { TreeData } from '@/lib/types';
import { useAuth } from './AuthProvider';
import FamilyTree from './FamilyTree';
import Icon from './Icon';
import LayoutMenu from './LayoutMenu';
import { useLayoutPrefs } from './useLayoutPrefs';
import { useI18n } from './I18nProvider';
import PersonForm from './PersonForm';
import PendingInvitations from './PendingInvitations';
import PersonPanel from './PersonPanel';
import { useCurrentTree } from './TreeProvider';

const DEPTHS = [1, 2, 3, 4, 5, 6, 7, 8];
const KINSHIP_PREF = 'familyTree.showKinship';

export default function TreeExplorer() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { user } = useAuth();
  const { tree: activeTree, treeApi, canEdit: canEditTree, branchOnly, refreshTrees } = useCurrentTree();
  const { t, formatName, formatDate, formatBranch } = useI18n();
  // Editors limited to a branch add people as relatives of someone in it (in the side panel), never on their own.
  const canEdit = canEditTree && !branchOnly;
  const branch = branchOnly ? activeTree.editScope : null;
  // Compact on PC and tablet, left to right on phones; adjustable under "Layout".
  const layoutPrefs = useLayoutPrefs();

  // Drawn straight away from the last copy of this view, if there is one (refreshed below).
  const [tree, setTree] = useState<TreeData>(
    () => cachedGraph(activeTree.id, activeTree.myPersonId, DEFAULT_DEPTH) ?? { nodes: [], edges: [] },
  );
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // If you said who you are in this tree ("This is me"), it opens around you, a few
  // generations deep, instead of loading everyone; kinship labels then read from your side.
  // (This component remounts per tree, so these start fresh for each tree.)
  const me = activeTree.myPersonId;
  // Selection lives only in memory, so person ids never appear in the URL.
  const [selectedId, setSelectedId] = useState<string | null>(me);
  const [rootId, setRootId] = useState<string | null>(me);
  const [depth, setDepth] = useState(DEFAULT_DEPTH);
  const [creating, setCreating] = useState(false);
  const [version, setVersion] = useState(0);
  const [showKinship, setShowKinship] = useState(true);
  const [loadingSample, setLoadingSample] = useState(false);
  const [sampleError, setSampleError] = useState<string | null>(null);

  const refresh = useCallback(() => setVersion((v) => v + 1), []);

  async function loadSample() {
    setLoadingSample(true);
    setSampleError(null);
    try {
      await treeApi.loadSampleFamily();
      refresh();
      await refreshTrees(); // the tree switcher shows person counts
    } catch (err) {
      setSampleError((err as Error).message);
    } finally {
      setLoadingSample(false);
    }
  }

  // Pick up a person chosen elsewhere (People page). Old links with ?person=… still
  // work once, and the id is then removed from the address bar.
  useEffect(() => {
    const legacy = searchParams.get('person');
    const requested = takeRequestedSelection() ?? legacy;
    if (requested) {
      // Open the tree around them, so they're on screen even if they're far from you.
      setSelectedId(requested);
      setRootId(requested);
    }
    if (legacy) router.replace('/', { scroll: false });
  }, [searchParams, router]);

  useEffect(() => {
    try {
      if (window.localStorage.getItem(KINSHIP_PREF) === 'off') setShowKinship(false);
    } catch {
      // storage unavailable; keep the default
    }
  }, []);

  const toggleKinship = (on: boolean) => {
    setShowKinship(on);
    try {
      window.localStorage.setItem(KINSHIP_PREF, on ? 'on' : 'off');
    } catch {
      // ignore
    }
  };

  // What the selected person calls everyone connected to them (cô, chú, bác, ông, bà, cháu…).
  const kinship = useMemo(
    () => (showKinship && selectedId ? computeKinship(tree, selectedId) : null),
    [tree, selectedId, showKinship],
  );

  useEffect(() => {
    let cancelled = false;
    // Show the last copy of this view at once; the fresh one replaces it when it arrives.
    const cached = cachedGraph(activeTree.id, rootId, depth);
    if (cached) setTree(cached);
    setLoading(!cached);
    fetchGraph(treeApi, activeTree.id, rootId, depth)
      .then((data) => {
        if (cancelled) return;
        setTree(data);
        setError(null);
      })
      .catch((err: Error) => !cancelled && setError(err.message))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [treeApi, activeTree.id, rootId, depth, version]);

  // On phones the side panel becomes a bottom sheet over the tree. It opens when you
  // pick someone or start adding a person, and ✕ only hides it, so the selection
  // (and its kinship labels) stays. It starts hidden so a preselected "me" doesn't cover the tree.
  const [sheetHidden, setSheetHidden] = useState(true);
  const sheetOpen = (creating || !!selectedId) && !sheetHidden;

  const select = useCallback((id: string | null) => {
    setSelectedId(id);
    setCreating(false);
    setSheetHidden(false);
  }, []);

  const startCreating = () => {
    setCreating(true);
    setSelectedId(null);
    setSheetHidden(false);
  };

  const root = rootId ? tree.nodes.find((n) => n.id === rootId) : undefined;
  const selectedPerson = selectedId ? tree.nodes.find((n) => n.id === selectedId) : undefined;
  const count = tree.nodes.length;

  return (
    <div className="explorer">
      <section className="canvas">
        <PendingInvitations />
        {/* On phones the tool buttons show only their icons; .btn-label keeps their names for screen readers. */}
        <div className="toolbar">
          {canEdit ? (
            <button className="btn primary tool" onClick={startCreating} title={t('tree.addPerson')}>
              <Icon name="plus" />
              <span className="btn-label">{t('tree.addPerson')}</span>
            </button>
          ) : branch ? (
            <button
              type="button"
              className="btn chip tool"
              title={`${formatBranch(branch)}. ${t('tree.branchBadgeTitle')}`}
              onClick={() => {
                if (!branch.root) return;
                setRootId(branch.root.id);
                select(branch.root.id);
              }}
            >
              <Icon name="branch" />
              <span className="btn-label">{formatBranch(branch)}</span>
            </button>
          ) : (
            <span className="badge neutral" title={t('tree.sharedBy', { name: activeTree.ownerName ?? t('tree.theOwner') })}>
              {t('tree.viewOnly')}
            </span>
          )}
          {rootId ? (
            // What the tree is showing, as one compact control: around whom, how deep, or everyone.
            <div className="focus-pill" role="group" aria-label={t('tree.focusedOn')}>
              <Icon name="focus" />
              <span className="focus-pill-name">
                <span className="muted focus-pill-prefix">{t('tree.focusedOn')}</span>{' '}
                <strong>{root ? formatName(root) : '…'}</strong>
              </span>
              <label className="focus-pill-depth" title={t('tree.depth')}>
                <span className="sr-only">{t('tree.depth')}</span>
                <select value={depth} onChange={(e) => setDepth(Number(e.target.value))}>
                  {DEPTHS.map((d) => (
                    <option key={d} value={d}>
                      {t('tree.depthOption', { count: d })}
                    </option>
                  ))}
                </select>
              </label>
              <button
                className="btn small ghost tool"
                onClick={() => setRootId(null)}
                title={t('tree.showEveryoneTitle')}
              >
                <Icon name="users" />
                <span className="btn-label">{t('tree.showEveryone')}</span>
              </button>
            </div>
          ) : (
            selectedId && (
              <button className="btn tool" onClick={() => setRootId(selectedId)} title={t('tree.focusSelected')}>
                <Icon name="focus" />
                <span className="btn-label">{t('tree.focusSelected')}</span>
              </button>
            )
          )}
          {me && rootId !== me && (
            <button
              className="btn tool"
              title={t('tree.aroundMe')}
              onClick={() => {
                setRootId(me);
                setDepth(DEFAULT_DEPTH);
                select(me);
              }}
            >
              <Icon name="user" />
              <span className="btn-label">{t('tree.aroundMe')}</span>
            </button>
          )}
          <LayoutMenu
            options={layoutPrefs.options}
            setOptions={layoutPrefs.setOptions}
            reset={layoutPrefs.reset}
            isDefault={layoutPrefs.isDefault}
          />
          <button
            className="btn chip tool"
            aria-pressed={showKinship}
            onClick={() => toggleKinship(!showKinship)}
            title={`${t('tree.kinship')}: ${t('tree.kinshipTitle')}`}
          >
            <Icon name="kinship" />
            <span className="btn-label">{t('tree.kinship')}</span>
          </button>
          {kinship && selectedPerson && (
            <span className="muted small kinship-from">
              {t('tree.kinshipFrom')} <strong>{formatName(selectedPerson)}</strong>
            </span>
          )}
          <span className="muted small spacer">
            {loading
              ? t('common.loading')
              : rootId && activeTree.personCount > count
                ? t('tree.countShown', { count, total: activeTree.personCount })
                : t(count === 1 ? 'tree.count_one' : 'tree.count_other', { count })}
          </span>
        </div>

        <div className="canvas-body">
          {error ? (
            <div className="center">
              <p className="error">{t('tree.loadError', { error })}</p>
              <button className="btn" onClick={refresh}>
                {t('common.retry')}
              </button>
            </div>
          ) : !loading && count === 0 ? (
            <div className="center">
              {activeTree.role === 'owner' ? (
                <>
                  <h2>{user?.name ? t('tree.welcome', { name: user.name }) : t('tree.emptyOwn')}</h2>
                  <p className="muted">{t('tree.emptyOwnHint')}</p>
                </>
              ) : (
                <>
                  <h2>{t('tree.emptyShared', { name: activeTree.name })}</h2>
                  <p className="muted">{t('tree.emptySharedHint')}</p>
                </>
              )}
              {canEdit && (
                <button className="btn primary" onClick={startCreating} disabled={loadingSample}>
                  <Icon name="plus" />
                  {t('tree.addFirst')}
                </button>
              )}
              {activeTree.role === 'owner' && (
                <div className="sample-offer">
                  <p className="muted small">{t('tree.sampleHint')}</p>
                  <button className="btn" onClick={loadSample} disabled={loadingSample}>
                    {loadingSample ? t('tree.sampleLoading') : t('tree.sampleLoad')}
                  </button>
                  {sampleError && <p className="error">{sampleError}</p>}
                </div>
              )}
            </div>
          ) : (
            <FamilyTree
              data={tree}
              selectedId={selectedId}
              onSelect={select}
              kinship={kinship}
              meId={me}
              layoutOptions={layoutPrefs.options}
              exportInfo={{
                title: root ? `${activeTree.name} – ${formatName(root)}` : activeTree.name,
                subtitle: `${t(count === 1 ? 'tree.count_one' : 'tree.count_other', { count })} · ${formatDate(new Date().toISOString())}`,
              }}
            />
          )}
        </div>
      </section>

      <aside className={sheetOpen ? 'panel sheet-open' : 'panel'}>
        {(creating || selectedId) && (
          <button
            type="button"
            className="sheet-close"
            onClick={() => setSheetHidden(true)}
            aria-label={t('tree.closeDetails')}
          >
            ✕
          </button>
        )}
        {creating && canEdit ? (
          <PersonForm
            onCancel={() => setCreating(false)}
            onSaved={(person) => {
              refresh();
              select(person.id);
            }}
          />
        ) : selectedId ? (
          <PersonPanel
            personId={selectedId}
            version={version}
            onSelect={select}
            onFocus={(id) => setRootId(id)}
            onChanged={refresh}
            onDeleted={(id) => {
              if (id === rootId) setRootId(null);
              select(null);
              refresh();
            }}
          />
        ) : (
          <div className="panel-empty">
            <h2>{activeTree.name}</h2>
            <p className="muted">
              {activeTree.role === 'owner'
                ? t('tree.yourTree')
                : t('tree.sharedWithYou', {
                    owner: activeTree.ownerName ?? t('tree.itsOwner'),
                    access: branch
                      ? t('tree.youCanEditBranch', { branch: formatBranch(branch) })
                      : activeTree.role === 'admin'
                        ? t('tree.youAreAdmin')
                        : canEdit
                        ? t('tree.youCanEdit')
                        : t('tree.viewOnlyLower'),
                  })}{' '}
              {canEditTree ? t('tree.clickHintEdit') : t('tree.clickHint')}
            </p>
            {!me && count > 0 && <p className="muted small">{t('tree.linkMeHint')}</p>}
            {activeTree.role !== 'owner' && (
              <button
                className="btn danger"
                onClick={async () => {
                  if (!confirm(t('tree.leaveConfirm', { name: activeTree.name }))) return;
                  try {
                    await api.leaveTree(activeTree.id);
                    await refreshTrees();
                  } catch (err) {
                    alert((err as Error).message);
                  }
                }}
              >
                {t('tree.leave')}
              </button>
            )}
            <ul className="legend">
              <li>
                <span className="swatch line" /> {t('tree.legendParent')}
              </li>
              <li>
                <span className="swatch dashed" /> {t('tree.legendSpouse')}
              </li>
            </ul>
          </div>
        )}
      </aside>
    </div>
  );
}
