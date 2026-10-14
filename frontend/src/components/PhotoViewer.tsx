'use client';

import { useEffect, useRef } from 'react';
import Icon from './Icon';
import { useI18n } from './I18nProvider';

interface Props {
  src: string;
  /** Shown under the photo, e.g. the person's name and years. */
  caption: string;
  onClose: () => void;
}

/**
 * A person's photo, large, over the page. A native modal <dialog>: it keeps
 * keyboard focus inside, closes with Escape, and gives focus back to the
 * thumbnail afterwards. A click outside the photo closes it too.
 */
export default function PhotoViewer({ src, caption, onClose }: Props) {
  const { t } = useI18n();
  const dialog = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const el = dialog.current;
    if (!el) return;
    el.showModal();
    return () => {
      if (el.open) el.close();
    };
  }, []);

  return (
    <dialog
      ref={dialog}
      className="photo-viewer"
      aria-label={caption}
      // Escape. Not onClose: closing the dialog when it unmounts (as React does twice
      // in development) must not count as the user closing it.
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      onClick={(e) => {
        // The dialog itself fills the screen; only its contents stop the click.
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <figure>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={src} alt={caption} />
        <figcaption>{caption}</figcaption>
      </figure>
      <button type="button" className="btn icon-only photo-viewer-close" onClick={onClose} aria-label={t('photo.close')} autoFocus>
        <Icon name="close" />
      </button>
    </dialog>
  );
}
