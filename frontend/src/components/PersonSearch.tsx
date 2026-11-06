'use client';

import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { foldText, matchesName } from '@/lib/search';
import type { Person } from '@/lib/types';
import { useI18n } from './I18nProvider';
import Icon from './Icon';
import { useCurrentTree } from './TreeProvider';
import { useDates } from './useDates';

/** Most people listed under the box at once; typing more narrows it down. */
const MAX_RESULTS = 8;
/** The tree's people, fetched for searching; enough for any family tree. */
const LOAD_LIMIT = 2000;

interface Props {
  /** Someone was picked: the tree page selects them and shows the tree around them. */
  onPick: (personId: string) => void;
  /** Changes when people are added, edited or removed, so the list is fetched again. */
  version: number;
}

/**
 * "Find a person" on the tree page: searches everyone in the tree, not only the people
 * shown, by name without accents and in any word order ("nguyen an" finds "Nguyễn Văn
 * An"). The tree's people are fetched the first time the box is used.
 */
export default function PersonSearch({ onPick, version }: Props) {
  const { t, formatName } = useI18n();
  const { formatLifespan } = useDates(); // lunar years when the tree uses âm lịch
  const { treeApi } = useCurrentTree();
  const listId = useId();
  const root = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [people, setPeople] = useState<Person[] | null>(null);
  const [loadedFor, setLoadedFor] = useState<number | null>(null);
  const [error, setError] = useState(false);

  // Fetched when the box is first used, and again after the tree has changed.
  const wanted = open || query !== '';
  useEffect(() => {
    if (!wanted || loadedFor === version) return;
    let cancelled = false;
    treeApi
      .listPeople('', LOAD_LIMIT)
      .then((list) => {
        if (cancelled) return;
        setPeople(list);
        setLoadedFor(version);
        setError(false);
      })
      .catch(() => !cancelled && setError(true));
    return () => {
      cancelled = true;
    };
  }, [wanted, loadedFor, version, treeApi]);

  const results = useMemo(() => {
    const q = query.trim();
    if (!q || !people) return [];
    const folded = foldText(q);
    const exact = q.toLowerCase();
    // Best first: names with what was typed, accents and all ("Nhẫn" before "Nhận"), then
    // names starting with it, then the rest; the list's own order otherwise (the sort is stable).
    const score = (p: Person) => {
      const name = formatName(p);
      return (name.toLowerCase().includes(exact) ? 0 : 2) + (foldText(name).startsWith(folded) ? 0 : 1);
    };
    return people
      .filter((p) => matchesName(p, q))
      .map((p) => ({ p, s: score(p) }))
      .sort((a, b) => a.s - b.s)
      .slice(0, MAX_RESULTS)
      .map(({ p }) => p);
  }, [people, query, formatName]);

  useEffect(() => setActive(0), [query]);

  // Closes on a click elsewhere.
  useEffect(() => {
    if (!open) return;
    const close = (e: PointerEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', close);
    return () => document.removeEventListener('pointerdown', close);
  }, [open]);

  function pick(person: Person) {
    onPick(person.id);
    setQuery('');
    setOpen(false);
    input.current?.blur();
  }

  function onKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      setOpen(true);
      if (results.length) setActive((i) => (i + (e.key === 'ArrowDown' ? 1 : -1) + results.length) % results.length);
    } else if (e.key === 'Enter') {
      if (results[active]) {
        e.preventDefault();
        pick(results[active]);
      }
    } else if (e.key === 'Escape') {
      if (query) setQuery('');
      else input.current?.blur();
      setOpen(false);
    }
  }

  const showList = open && query.trim() !== '';
  const optionId = (i: number) => `${listId}-${i}`;

  return (
    <div className="person-search" ref={root}>
      <span className="person-search-icon" aria-hidden="true">
        <Icon name="search" />
      </span>
      <input
        ref={input}
        type="search"
        role="combobox"
        aria-label={t('tree.searchLabel')}
        aria-expanded={showList}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={showList && results[active] ? optionId(active) : undefined}
        placeholder={t('tree.search')}
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={onKeyDown}
        autoComplete="off"
        spellCheck={false}
      />
      {showList && (
        <ul className="person-search-list" id={listId} role="listbox" aria-label={t('tree.searchLabel')}>
          {error ? (
            <li className="person-search-note error">{t('tree.searchError')}</li>
          ) : !people ? (
            <li className="person-search-note muted">{t('common.loading')}</li>
          ) : !results.length ? (
            <li className="person-search-note muted">{t('tree.searchNone')}</li>
          ) : (
            results.map((p, i) => {
              const years = formatLifespan(p);
              return (
                <li
                  key={p.id}
                  id={optionId(i)}
                  role="option"
                  aria-selected={i === active}
                  className={i === active ? 'person-search-option active' : 'person-search-option'}
                  // Before blur/click-outside handling, so the pick always lands.
                  onPointerDown={(e) => {
                    e.preventDefault();
                    pick(p);
                  }}
                  onMouseEnter={() => setActive(i)}
                >
                  <span className={`person-search-dot gender-${p.gender ?? 'unknown'}`} aria-hidden="true" />
                  <span className="person-search-name">{formatName(p)}</span>
                  {years && <span className="person-search-years muted small">{years}</span>}
                </li>
              );
            })
          )}
        </ul>
      )}
    </div>
  );
}
