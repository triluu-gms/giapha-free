'use client';

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { encodeCanvas, loadImage, MAX_SIDE } from '@/lib/photo';
import {
  clampCrop,
  drawCrop,
  frameAspect,
  frameSize,
  initialCrop,
  MAX_TILT,
  MAX_ZOOM,
  outputFactor,
  zoomAround,
  type CropState,
  type FrameShape,
} from '@/lib/photoCrop';
import Icon from './Icon';
import { useI18n } from './I18nProvider';

type Img = ImageBitmap | HTMLImageElement;

interface Props {
  /** A photo just taken or chosen. */
  file: File;
  /** The adjusted photo (WebP or JPEG, at most 1200 px). */
  onDone: (photo: Blob) => void;
  onCancel: () => void;
  /** The file couldn't be read as an image. */
  onError: () => void;
}

/**
 * Crop, rotate and straighten a photo before it is used, in a modal over the page:
 * drag to move, pinch / scroll / slider to zoom, quarter turns, and a straighten
 * slider for tilted shots of printed photos. The circle shows the round avatar.
 */
export default function PhotoEditor({ file, onDone, onCancel, onError }: Props) {
  const { t } = useI18n();
  const dialog = useRef<HTMLDialogElement>(null);
  const stage = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const [img, setImg] = useState<Img | null>(null);
  const [shape, setShape] = useState<FrameShape>('square');
  const [crop, setCrop] = useState<CropState>(initialCrop);
  const [space, setSpace] = useState({ w: 320, h: 320 });
  const [busy, setBusy] = useState(false);
  const finished = useRef(false);

  // Open as a modal; Escape (the dialog's own close) counts as Cancel.
  useEffect(() => {
    const el = dialog.current;
    el?.showModal();
    return () => {
      if (el?.open) el.close();
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    let loaded: Img | null = null;
    loadImage(file)
      .then((image) => {
        loaded = image;
        if (!cancelled) setImg(image);
      })
      .catch(() => !cancelled && onError());
    return () => {
      cancelled = true;
      // A decoded camera photo is tens of MB; let it go as soon as the editor closes.
      if (loaded && 'close' in loaded) loaded.close();
    };
  }, [file, onError]);

  // The frame is as large as the space allows.
  useLayoutEffect(() => {
    const el = stage.current;
    if (!el) return;
    const measure = () => setSpace({ w: el.clientWidth, h: el.clientHeight });
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const iw = img?.width ?? 1;
  const ih = img?.height ?? 1;
  const { W, H } = frameSize(frameAspect(shape, iw, ih, crop.turns), space.w, space.h);
  const fix = useCallback((st: CropState) => clampCrop(st, iw, ih, W, H), [iw, ih, W, H]);

  // A new frame size or shape: keep the photo covering it.
  useEffect(() => setCrop((st) => fix(st)), [fix]);

  // Draw the preview: the same drawing as the saved photo, at the screen's pixel density.
  useEffect(() => {
    const el = canvas.current;
    if (!el || !img) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    el.width = Math.round(W * dpr);
    el.height = Math.round(H * dpr);
    const ctx = el.getContext('2d');
    if (ctx) drawCrop(ctx, img, crop, W, H, dpr);
  }, [img, crop, W, H]);

  // Dragging and pinching.
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const pinch = useRef(0);
  const local = (e: { clientX: number; clientY: number }) => {
    const r = canvas.current!.getBoundingClientRect();
    return { x: e.clientX - r.left - W / 2, y: e.clientY - r.top - H / 2 };
  };
  const onPointerDown = (e: React.PointerEvent) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()];
      pinch.current = Math.hypot(a.x - b.x, a.y - b.y);
    }
  };
  const onPointerMove = (e: React.PointerEvent) => {
    const prev = pointers.current.get(e.pointerId);
    if (!prev) return;
    const next = { x: e.clientX, y: e.clientY };
    pointers.current.set(e.pointerId, next);
    if (pointers.current.size === 1) {
      setCrop((st) => fix({ ...st, x: st.x + next.x - prev.x, y: st.y + next.y - prev.y }));
    } else if (pointers.current.size === 2 && pinch.current) {
      const [a, b] = [...pointers.current.values()];
      const dist = Math.hypot(a.x - b.x, a.y - b.y);
      const mid = local({ clientX: (a.x + b.x) / 2, clientY: (a.y + b.y) / 2 });
      setCrop((st) => zoomAround(st, (st.zoom * dist) / pinch.current, mid.x, mid.y, iw, ih, W, H));
      pinch.current = dist;
    }
  };
  const onPointerUp = (e: React.PointerEvent) => {
    pointers.current.delete(e.pointerId);
    pinch.current = 0;
  };
  useEffect(() => {
    const el = canvas.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const p = local(e);
      setCrop((st) => zoomAround(st, st.zoom * Math.exp(-e.deltaY * 0.002), p.x, p.y, iw, ih, W, H));
    };
    el.addEventListener('wheel', onWheel, { passive: false }); // passive listeners can't stop the page scrolling
    return () => el.removeEventListener('wheel', onWheel);
  });

  const turn = (by: number) => setCrop((st) => fix({ ...st, turns: (st.turns + by + 4) % 4, zoom: 1, x: 0, y: 0 }));

  async function use() {
    if (!img) return;
    setBusy(true);
    try {
      const k = outputFactor(crop, iw, ih, W, H, MAX_SIDE);
      const out = document.createElement('canvas');
      out.width = Math.max(1, Math.round(W * k));
      out.height = Math.max(1, Math.round(H * k));
      drawCrop(out.getContext('2d')!, img, crop, W, H, k);
      const blob = await encodeCanvas(out);
      finished.current = true;
      onDone(blob);
    } catch {
      setBusy(false);
      onError();
    }
  }

  const circle = Math.min(W, H);

  return (
    <dialog
      ref={dialog}
      className="photo-editor"
      aria-labelledby="photo-editor-title"
      // Escape. Not onClose: closing the dialog when it unmounts (as React does twice
      // in development) must not count as the user cancelling.
      onCancel={(e) => {
        e.preventDefault();
        if (!finished.current) onCancel();
      }}
    >
      <div className="photo-editor-head">
        <h2 id="photo-editor-title">{t('editor.title')}</h2>
        <button type="button" className="btn ghost icon-only" onClick={onCancel} aria-label={t('common.cancel')}>
          <Icon name="close" />
        </button>
      </div>

      <div className="photo-editor-stage" ref={stage}>
        {img ? (
          <div className="photo-editor-frame" style={{ width: W, height: H }}>
            <canvas
              ref={canvas}
              style={{ width: W, height: H }}
              onPointerDown={onPointerDown}
              onPointerMove={onPointerMove}
              onPointerUp={onPointerUp}
              onPointerCancel={onPointerUp}
              aria-label={t('editor.hint')}
            />
            {/* What the round avatar will show. */}
            <span className="photo-editor-circle" style={{ width: circle, height: circle }} aria-hidden="true" />
          </div>
        ) : (
          <p className="muted">{t('common.loading')}</p>
        )}
      </div>
      <p className="muted small photo-editor-hint">{t('editor.hint')}</p>

      <div className="photo-editor-controls">
        <div className="segmented three" role="group" aria-label={t('editor.shape')}>
          {(['square', 'portrait', 'original'] as const).map((s) => (
            <button
              key={s}
              type="button"
              className="btn small"
              aria-pressed={shape === s}
              onClick={() => {
                setShape(s);
                setCrop((st) => ({ ...st, zoom: 1, x: 0, y: 0 }));
              }}
            >
              {t(`editor.${s}`)}
            </button>
          ))}
        </div>
        <label className="photo-editor-slider">
          <span>{t('editor.zoom')}</span>
          <input
            type="range"
            min={1}
            max={MAX_ZOOM}
            step={0.01}
            value={crop.zoom}
            onChange={(e) => setCrop((st) => zoomAround(st, Number(e.target.value), 0, 0, iw, ih, W, H))}
          />
        </label>
        <label className="photo-editor-slider">
          <span>
            {t('editor.straighten')} <span className="muted">{crop.tilt > 0 ? '+' : ''}{crop.tilt}°</span>
          </span>
          <input
            type="range"
            min={-MAX_TILT}
            max={MAX_TILT}
            step={0.5}
            value={crop.tilt}
            onChange={(e) => setCrop((st) => fix({ ...st, tilt: Number(e.target.value) }))}
          />
        </label>
        <div className="photo-editor-row">
          <button type="button" className="btn small" onClick={() => turn(-1)}>
            <Icon name="rotateLeft" />
            {t('editor.rotateLeft')}
          </button>
          <button type="button" className="btn small" onClick={() => turn(1)}>
            <Icon name="rotateRight" />
            {t('editor.rotateRight')}
          </button>
          <button type="button" className="btn small ghost" onClick={() => setCrop(initialCrop)}>
            {t('editor.reset')}
          </button>
        </div>
      </div>

      <div className="photo-editor-foot">
        <button type="button" className="btn" onClick={onCancel} disabled={busy}>
          {t('common.cancel')}
        </button>
        <button type="button" className="btn primary" onClick={() => void use()} disabled={!img || busy}>
          <Icon name="save" />
          {busy ? t('editor.working') : t('editor.use')}
        </button>
      </div>
    </dialog>
  );
}
