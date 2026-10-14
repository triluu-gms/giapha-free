'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { api } from '@/lib/api';
import ApiStatus from './ApiStatus';
import { useAuth } from './AuthProvider';
import { useI18n } from './I18nProvider';
import LanguageSwitcher from './LanguageSwitcher';
import { useTrees } from './TreeProvider';

/** The tree switcher's "+ New tree…" entry; never a real tree id. */
const NEW_TREE = '__new__';

export default function Header() {
  const { user, status, logout } = useAuth();
  const { trees, current, canEdit, branchOnly, canManage, switchTree, refreshTrees } = useTrees();
  const { t, errorMessage } = useI18n();
  const pathname = usePathname();
  const ready = user && !user.verificationRequired && !user.consentRequired;
  const roleSuffix = {
    owner: '',
    admin: t('header.suffixAdmin'),
    editor: t('header.suffixEditor'),
    viewer: t('header.suffixViewer'),
  };

  // On phones the links, language and account move into a menu behind the ☰ button.
  // On wider screens the menu is always shown inline and the button is hidden (CSS).
  const [menuOpen, setMenuOpen] = useState(false);
  const header = useRef<HTMLElement>(null);

  useEffect(() => setMenuOpen(false), [pathname]);

  useEffect(() => {
    if (!menuOpen) return;
    const close = (e: Event) => {
      if (e instanceof KeyboardEvent ? e.key === 'Escape' : !header.current?.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    };
    document.addEventListener('keydown', close);
    document.addEventListener('pointerdown', close);
    return () => {
      document.removeEventListener('keydown', close);
      document.removeEventListener('pointerdown', close);
    };
  }, [menuOpen]);

  async function createTree() {
    const name = window.prompt(t('header.newTreePrompt'))?.trim();
    if (!name) return;
    try {
      const tree = await api.createTree(name);
      await refreshTrees(tree.id); // and switch to it
    } catch (err) {
      window.alert(errorMessage(err));
    }
  }

  const navLink = (href: string, label: string, badge = 0) => (
    <Link
      href={href}
      className={pathname === href ? 'active' : undefined}
      aria-current={pathname === href ? 'page' : undefined}
      // Pages are rendered per request (the language cookie), so the default prefetch loads
      // nothing. The tree is the page people go back to most: prefetch it fully (its code
      // and payload), so the click doesn't wait on the server before asking for the graph.
      prefetch={href === '/' ? true : undefined}
    >
      {label}
      {badge > 0 && (
        <span className="nav-badge" title={t('accessRequest.badge', { count: badge })}>
          {badge}
          <span className="sr-only">{t('accessRequest.badge', { count: badge })}</span>
        </span>
      )}
    </Link>
  );

  return (
    <header className="topbar" ref={header}>
      <Link href="/" className="brand">
        <span aria-hidden>🌳</span> <span className="brand-name">{t('brand')}</span>
      </Link>

      {ready && current && (
        <label className="tree-switcher" title={t('header.switchTree')}>
          <span className="sr-only">{t('header.currentTree')}</span>
          <select
            value={current.id}
            onChange={(e) => {
              // The select stays on the current tree; creating one switches to it.
              if (e.target.value === NEW_TREE) void createTree();
              else switchTree(e.target.value);
            }}
          >
            <optgroup label={t('header.myTree')}>
              {trees
                .filter((tr) => tr.role === 'owner')
                .map((tr) => (
                  <option key={tr.id} value={tr.id}>
                    {tr.name}
                  </option>
                ))}
              <option value={NEW_TREE}>{t('header.newTree')}</option>
            </optgroup>
            {trees.some((tr) => tr.role !== 'owner') && (
              <optgroup label={t('header.sharedWithMe')}>
                {trees
                  .filter((tr) => tr.role !== 'owner')
                  .map((tr) => (
                    <option key={tr.id} value={tr.id}>
                      {tr.name}
                      {roleSuffix[tr.role]}
                    </option>
                  ))}
              </optgroup>
            )}
          </select>
        </label>
      )}

      <ApiStatus />

      <button
        type="button"
        className="menu-toggle"
        aria-expanded={menuOpen}
        aria-controls="topbar-menu"
        aria-label={menuOpen ? t('header.closeMenu') : t('header.openMenu')}
        onClick={() => setMenuOpen((open) => !open)}
      >
        <span aria-hidden>{menuOpen ? '✕' : '☰'}</span>
      </button>

      <div id="topbar-menu" className={menuOpen ? 'topbar-menu open' : 'topbar-menu'}>
        {ready && (
          <nav>
            {navLink('/', t('nav.tree'))}
            {navLink('/people', t('nav.people'))}
            {canEdit && !branchOnly && navLink('/import', t('nav.import'))}
            {canManage && navLink('/share', t('nav.share'), current?.accessRequestCount ?? 0)}
            {navLink('/settings', t('nav.settings'))}
          </nav>
        )}
        <div className="header-end">
          <LanguageSwitcher />
          {user ? (
            <div className="user-menu">
              <Link href="/account" className="user-menu user-link" title={t('header.account')}>
                {user.avatarUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={user.avatarUrl} alt="" className="user-avatar" referrerPolicy="no-referrer" />
                ) : (
                  <span className="user-avatar fallback" aria-hidden>
                    {(user.name ?? user.email ?? '?').charAt(0).toUpperCase()}
                  </span>
                )}
                <span className="user-name">{user.name ?? user.email}</span>
                <span className="sr-only">{t('header.account')}</span>
              </Link>
              <button className="btn" onClick={logout}>
                {t('common.signOut')}
              </button>
            </div>
          ) : (
            status === 'anonymous' && (
              <Link href="/login" className="btn primary">
                {t('common.signIn')}
              </Link>
            )
          )}
        </div>
      </div>
    </header>
  );
}
