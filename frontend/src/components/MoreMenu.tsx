'use client';

import { useEffect, useRef, useState } from 'react';
import Icon, { type IconName } from './Icon';
import { useI18n } from './I18nProvider';

export interface MoreMenuItem {
  label: string;
  icon: IconName;
  onSelect: () => void;
  danger?: boolean;
  title?: string;
}

/** A labelled button instead of "⋯", with the list opening to the right of its left edge. */
export interface MenuTrigger {
  label: string;
  icon: IconName;
}

/**
 * A "⋯" button that opens a short list of less common actions, so the main
 * actions stay uncluttered. Closes on a choice, Escape or a click elsewhere.
 * With `trigger`, it is a labelled button (e.g. the photo field's "Take photo / Choose").
 */
export default function MoreMenu({ items, trigger }: { items: MoreMenuItem[]; trigger?: MenuTrigger }) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (e: Event) => {
      if (e instanceof KeyboardEvent ? e.key === 'Escape' : !root.current?.contains(e.target as Node)) {
        setOpen(false);
        if (e instanceof KeyboardEvent) button.current?.focus();
      }
    };
    document.addEventListener('keydown', close);
    document.addEventListener('pointerdown', close);
    return () => {
      document.removeEventListener('keydown', close);
      document.removeEventListener('pointerdown', close);
    };
  }, [open]);

  if (!items.length) return null;

  return (
    <div className="more-menu" ref={root}>
      <button
        ref={button}
        type="button"
        className={trigger ? 'btn' : 'btn ghost icon-only'}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={trigger ? undefined : t('common.more')}
        title={trigger ? undefined : t('common.more')}
        onClick={() => setOpen((o) => !o)}
      >
        <Icon name={trigger?.icon ?? 'more'} />
        {trigger?.label}
      </button>
      {open && (
        <div className={trigger ? 'more-menu-list align-left' : 'more-menu-list'} role="menu">
          {items.map((item) => (
            <button
              key={item.label}
              type="button"
              role="menuitem"
              className={item.danger ? 'more-menu-item danger' : 'more-menu-item'}
              title={item.title}
              onClick={() => {
                setOpen(false);
                item.onSelect();
              }}
            >
              <Icon name={item.icon} />
              {item.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
