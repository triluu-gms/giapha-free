'use client';

import { useEffect, useRef, useState } from 'react';
import type { LayoutOptions } from '@/lib/treeLayout';
import Icon from './Icon';
import { useI18n } from './I18nProvider';

interface Props {
  options: LayoutOptions;
  setOptions: (next: LayoutOptions) => void;
  reset: () => void;
  isDefault: boolean;
}

/** "Layout" in the tree toolbar: direction and the compacting switches, remembered on this device. */
export default function LayoutMenu({ options, setOptions, reset, isDefault }: Props) {
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

  const set = (change: Partial<LayoutOptions>) => setOptions({ ...options, ...change });
  const right = options.direction === 'right';

  const toggle = (id: string, label: string, hint: string, checked: boolean, onChange: (v: boolean) => void, disabled = false) => (
    <label className="layout-option" htmlFor={id}>
      <span>
        <strong>{label}</strong>
        <span className="muted small">{hint}</span>
      </span>
      <input
        id={id}
        type="checkbox"
        role="switch"
        className="switch"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
      />
    </label>
  );

  return (
    <div className="layout-menu" ref={root}>
      <button
        ref={button}
        type="button"
        className="btn tool"
        aria-haspopup="dialog"
        aria-expanded={open}
        title={t('layout.title')}
        onClick={() => setOpen((o) => !o)}
      >
        <Icon name="layout" />
        <span className="btn-label">{t('layout.button')}</span>
      </button>
      {open && (
        <div className="layout-menu-panel" role="dialog" aria-label={t('layout.title')}>
          <div className="layout-direction" role="group" aria-label={t('layout.direction')}>
            <span className="muted small">{t('layout.direction')}</span>
            <div className="segmented">
              {(['down', 'right'] as const).map((d) => (
                <button
                  key={d}
                  type="button"
                  className="btn small"
                  aria-pressed={options.direction === d}
                  onClick={() => set({ direction: d })}
                >
                  {t(d === 'down' ? 'layout.down' : 'layout.right')}
                </button>
              ))}
            </div>
          </div>
          {toggle(
            'layout-couples',
            t('layout.couples'),
            right ? t('layout.couplesRight') : t('layout.couplesHint'),
            right || options.couplesStacked,
            (v) => set({ couplesStacked: v }),
            right,
          )}
          {toggle('layout-siblings', t('layout.siblings'), t('layout.siblingsHint'), options.stackSiblings, (v) =>
            set({ stackSiblings: v }),
          )}
          {toggle('layout-wrap', t('layout.wrap'), t('layout.wrapHint'), options.wrapChi, (v) => set({ wrapChi: v }))}
          <div className="layout-menu-foot">
            <span className="muted small">{t('layout.saved')}</span>
            {!isDefault && (
              <button type="button" className="btn small ghost" onClick={reset}>
                {t('layout.reset')}
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
