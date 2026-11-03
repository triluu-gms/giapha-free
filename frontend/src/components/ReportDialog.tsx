'use client';

import { useEffect, useMemo, useRef, useState, type ChangeEvent } from 'react';
import { exportFileName, saveCanvas, type ExportFormat } from '@/lib/exportTree';
import { ACCEPTED_PHOTO_TYPES, loadImage, prepareForUpload } from '@/lib/photo';
import {
  clampArea,
  composeReport,
  REPORT_BACKGROUND_MAX_SIDE,
  REPORT_MARGIN_MAX,
  REPORT_ZOOM_MAX,
  REPORT_ZOOM_MIN,
  type ReportBackground,
} from '@/lib/report';
import {
  DEFAULT_PRESET,
  presetImage,
  presetOf,
  presetThumb,
  presetValue,
  REPORT_PRESETS,
  type ReportPreset,
} from '@/lib/reportPresets';
import { chiData, DEPTH_SIZE_MAX, DEPTH_SIZE_MIN, layOutReportTree, listChi, sizeReportTree } from '@/lib/reportTree';
import type { MessageKey } from '@/lib/i18n';
import type { LayoutOptions } from '@/lib/treeLayout';
import type { ReportArea, ReportDepthSizes, TreeData } from '@/lib/types';
import { useI18n } from './I18nProvider';
import Icon from './Icon';
import { useCurrentTree } from './TreeProvider';
import { useDates } from './useDates';
import { usePhotoUploads } from './usePhotoUploads';

/**
 * A ready-made background (lib/reportPresets.ts), the tree's saved photo, or an image
 * just chosen on this device (not uploaded until saved).
 */
type Source = { kind: 'preset'; id: string } | { kind: 'saved'; url: string } | { kind: 'file'; file: File };

/** The preview's longest side, in canvas pixels. */
const PREVIEW_SIDE = 1000;
const SIDES = ['top', 'right', 'bottom', 'left'] as const;
/** Each click of − or + changes the tree's size by this much (1 = fits its box). */
const ZOOM_STEP = 0.1;

const sameArea = (a: ReportArea | ReportDepthSizes, b: ReportArea | ReportDepthSizes) => a.every((v, i) => v === b[i]);

/** The report's card colours: background, name, dates, and lines (with the cards' borders). */
type CardColors = { card: string; name: string; dates: string; line: string };
const COLOR_FIELDS = ['card', 'name', 'dates', 'line'] as const;
const SETTING_OF = {
  card: 'reportCardColor',
  name: 'reportNameColor',
  dates: 'reportDatesColor',
  line: 'reportLineColor',
} as const;

/** Four sliders for one box's margins on the report (the title's or the tree's). */
function MarginsField({
  legend,
  hint,
  area,
  onChange,
}: {
  legend: string;
  hint: string;
  area: ReportArea;
  onChange: (area: ReportArea) => void;
}) {
  const { t } = useI18n();
  return (
    <fieldset className="report-margins">
      <legend>{legend}</legend>
      <p className="muted small">{hint}</p>
      {SIDES.map((side, i) => (
        <label key={side} className="photo-editor-slider">
          <span>
            {t(`report.${side}`)} <span className="muted">{area[i]}%</span>
          </span>
          <input
            type="range"
            min={0}
            max={REPORT_MARGIN_MAX}
            step={0.5}
            value={area[i]}
            onChange={(e) =>
              onChange(clampArea(area.map((v, j) => (j === i ? Number(e.target.value) : v)) as ReportArea))
            }
          />
        </label>
      ))}
    </fieldset>
  );
}

interface Props {
  /** The people and relationships shown (lib/reportTree.ts draws them). */
  data: TreeData;
  /** The tree page's Layout options: the report keeps the same structure. */
  layoutOptions: LayoutOptions;
  /** Suggested title and subtitle; both can be changed here. */
  title: string;
  subtitle: string;
  onClose: () => void;
}

/**
 * "Report": the tree shown, drawn over a background image such as a decorated frame,
 * with a title, downloaded as a PNG or PDF. The tree's owner and admins can save the
 * background and its margins for everyone in the tree; anyone can use an image of their own.
 */
export default function ReportDialog({
  data,
  layoutOptions,
  title: suggestedTitle,
  subtitle: suggestedSubtitle,
  onClose,
}: Props) {
  const { t, errorMessage, formatName } = useI18n();
  const { formatLifespan } = useDates(); // lunar years when the tree uses âm lịch
  const { tree, treeApi, canManage, refreshTrees } = useCurrentTree();
  const uploads = usePhotoUploads();
  const saved = tree.settings;
  const dialog = useRef<HTMLDialogElement>(null);
  const preview = useRef<HTMLCanvasElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  // A tree with no background saved yet starts with the first ready-made one and its boxes and colours.
  const savedPreset = presetOf(saved.reportBackground);
  const start = saved.reportBackground ? null : DEFAULT_PRESET;
  const [source, setSource] = useState<Source>(() =>
    savedPreset
      ? { kind: 'preset', id: savedPreset.id }
      : saved.reportBackground
        ? { kind: 'saved', url: saved.reportBackground }
        : { kind: 'preset', id: DEFAULT_PRESET.id },
  );
  const [area, setArea] = useState<ReportArea>(start?.area ?? saved.reportArea);
  const [titleArea, setTitleArea] = useState<ReportArea>(start?.titleArea ?? saved.reportTitleArea);
  // Per download, not saved: the right size depends on how much of the tree is shown.
  const [zoom, setZoom] = useState(1);
  // Per download, like the size: the first person of the one chi to print, or '' for all of them.
  const [chi, setChi] = useState('');
  const [textColor, setTextColor] = useState(start?.textColor ?? saved.reportTextColor);
  const [depthSizes, setDepthSizes] = useState<ReportDepthSizes>(saved.reportDepthSizes);
  const [colors, setColors] = useState<CardColors>(() =>
    start
      ? { ...start.colors }
      : {
          card: saved.reportCardColor,
          name: saved.reportNameColor,
          dates: saved.reportDatesColor,
          line: saved.reportLineColor,
        },
  );
  const [title, setTitle] = useState(suggestedTitle);
  const [subtitle, setSubtitle] = useState(suggestedSubtitle);
  const [background, setBackground] = useState<ReportBackground | null>(null);
  const [busy, setBusy] = useState<ExportFormat | 'save' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const font = useMemo(() => getComputedStyle(document.body).fontFamily || 'sans-serif', []);

  useEffect(() => {
    const el = dialog.current;
    el?.showModal();
    return () => {
      if (el?.open) el.close();
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      // Ready-made backgrounds and the tree's photos are same-origin, so the canvas stays exportable.
      const blob =
        source.kind === 'file'
          ? source.file
          : await fetch(source.kind === 'preset' ? presetImage(source.id) : source.url, {
              credentials: 'same-origin',
            }).then((res) => {
              if (!res.ok) throw new Error(String(res.status));
              return res.blob();
            });
      const image = await loadImage(blob);
      if (!cancelled) setBackground(image);
    })().catch(() => {
      if (cancelled) return;
      setBackground(null);
      setError(t('report.backgroundUnreadable'));
    });
    return () => {
      cancelled = true;
    };
  }, [source, t]);

  // Wrapped chi aim for the tree box's shape, as they aim for the screen's on the tree page
  // (rounded like there, so small margin changes don't lay the tree out again).
  const aspect = background
    ? Math.round(((background.width * (100 - area[1] - area[3])) / (background.height * (100 - area[0] - area[2]))) * 4) / 4 || 0.25
    : undefined;
  const chiLabel = useMemo(() => {
    const byId = new Map(data.nodes.map((p) => [p.id, p]));
    return (i: number, rootId: string) => {
      const root = byId.get(rootId);
      return t('tree.chiLabel', { n: i + 1, name: root ? formatName(root) : '' });
    };
  }, [data, t, formatName]);
  // The chi as the tree page numbers them, whether or not its rows are wrapped.
  const chiRoots = useMemo(() => listChi(data, layoutOptions), [data, layoutOptions]);
  const shown = useMemo(() => (chi && chiRoots.includes(chi) ? chiData(data, chi) : data), [data, chi, chiRoots]);
  const reportLayout = useMemo(
    () => layOutReportTree(shown, layoutOptions, { name: formatName, years: formatLifespan, chiLabel }, aspect),
    [shown, layoutOptions, formatName, formatLifespan, chiLabel, aspect],
  );
  // Larger cards spread the layout apart; only this step reruns when a size changes.
  const reportTree = useMemo(() => sizeReportTree(reportLayout, depthSizes), [reportLayout, depthSizes]);
  const treeStyle = useMemo(() => ({ ...colors, font }), [colors, font]);

  useEffect(() => {
    if (!background || !preview.current) return;
    composeReport(
      {
        background,
        tree: reportTree,
        treeStyle,
        area,
        titleArea,
        textColor,
        title,
        subtitle,
        font,
        zoom,
        maxSide: PREVIEW_SIDE,
        guides: true,
      },
      preview.current,
    );
  }, [background, reportTree, treeStyle, area, titleArea, textColor, title, subtitle, font, zoom]);

  const savedUrl = saved.reportBackground;
  // What would be saved as the background, before uploading a newly chosen image.
  const currentUrl = source.kind === 'preset' ? presetValue(source.id) : source.kind === 'saved' ? source.url : null;
  const changed =
    source.kind === 'file' ||
    currentUrl !== savedUrl ||
    textColor !== saved.reportTextColor ||
    COLOR_FIELDS.some((f) => colors[f] !== saved[SETTING_OF[f]]) ||
    !sameArea(depthSizes, saved.reportDepthSizes) ||
    !sameArea(area, saved.reportArea) ||
    !sameArea(titleArea, saved.reportTitleArea);
  // Saving a new image uploads it to the tree's photo storage, which a server may not have.
  const canSave = canManage && (source.kind !== 'file' || uploads);
  const ready = !!background;

  function choose(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = ''; // choosing the same file again still counts
    if (!file) return;
    setError(null);
    setNotice(null);
    setSource({ kind: 'file', file });
  }

  /** A ready-made background, with the boxes and colours that suit it (all adjustable afterwards). */
  function choosePreset(preset: ReportPreset) {
    setError(null);
    setNotice(null);
    setSource({ kind: 'preset', id: preset.id });
    setArea(preset.area);
    setTitleArea(preset.titleArea);
    setTextColor(preset.textColor);
    setColors({ ...preset.colors });
  }

  const zoomBy = (steps: number) =>
    setZoom((z) => Math.min(REPORT_ZOOM_MAX, Math.max(REPORT_ZOOM_MIN, Math.round((z + steps * ZOOM_STEP) * 10) / 10)));

  async function download(format: ExportFormat) {
    if (!background) return;
    setBusy(format);
    setError(null);
    try {
      const canvas = composeReport({
        background,
        tree: reportTree,
        treeStyle,
        area,
        titleArea,
        textColor,
        title,
        subtitle,
        font,
        zoom,
      });
      const name = title.trim() || tree.name;
      // JPEG inside the PDF: a photo background as PNG would make it several times larger.
      await saveCanvas(canvas, { format, fileName: exportFileName(name), title: name, subtitle, image: 'jpeg' });
    } catch (err) {
      setError(t('tree.exportFailed', { error: (err as Error).message }));
    } finally {
      setBusy(null);
    }
  }

  async function save() {
    setBusy('save');
    setError(null);
    setNotice(null);
    try {
      let url = currentUrl;
      if (source.kind === 'file') {
        let image: Blob;
        try {
          image = await prepareForUpload(source.file, REPORT_BACKGROUND_MAX_SIDE);
        } catch {
          throw new Error(t('report.backgroundUnreadable'));
        }
        url = (await treeApi.uploadPhoto(image)).url;
      }
      await treeApi.updateSettings({
        reportBackground: url,
        reportArea: area,
        reportTitleArea: titleArea,
        reportTextColor: textColor,
        reportCardColor: colors.card,
        reportNameColor: colors.name,
        reportDatesColor: colors.dates,
        reportLineColor: colors.line,
        reportDepthSizes: depthSizes,
      });
      if (url && source.kind === 'file') setSource({ kind: 'saved', url });
      await refreshTrees(tree.id); // the tree list carries the settings
      setNotice(t('report.saved'));
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(null);
    }
  }

  return (
    <dialog
      ref={dialog}
      className="report-dialog"
      aria-labelledby="report-dialog-title"
      onCancel={(e) => {
        e.preventDefault();
        if (!busy) onClose();
      }}
    >
      <div className="report-head">
        <h2 id="report-dialog-title">{t('report.title')}</h2>
        <button type="button" className="btn ghost icon-only" onClick={onClose} aria-label={t('common.close')}>
          <Icon name="close" />
        </button>
      </div>

      <div className="report-body">
        <div className="report-stage">
          {ready ? (
            <canvas ref={preview} className="report-preview" aria-label={t('report.previewLabel')} />
          ) : (
            <p className="muted">{t('tree.exporting')}</p>
          )}
        </div>

        <div className="report-controls">
          <input ref={fileInput} type="file" accept={ACCEPTED_PHOTO_TYPES} hidden onChange={choose} />
          <fieldset className="report-margins">
            <legend>{t('report.background')}</legend>
            <div className="report-gallery">
              {REPORT_PRESETS.map((preset) => (
                <button
                  key={preset.id}
                  type="button"
                  className="report-swatch"
                  aria-pressed={source.kind === 'preset' && source.id === preset.id}
                  onClick={() => choosePreset(preset)}
                  title={t(`report.preset.${preset.id}` as MessageKey)}
                >
                  <img src={presetThumb(preset.id)} alt="" width={120} height={80} />
                  <span>{t(`report.preset.${preset.id}` as MessageKey)}</span>
                </button>
              ))}
              <button
                type="button"
                className="report-swatch report-swatch-own"
                aria-pressed={source.kind === 'file' || source.kind === 'saved'}
                onClick={() => fileInput.current?.click()}
                title={t('report.uploadOwnTitle')}
              >
                <span className="report-swatch-icon" aria-hidden="true">
                  <Icon name="image" />
                </span>
                <span>{t('report.uploadOwn')}</span>
              </button>
            </div>
          </fieldset>

          {chiRoots.length > 1 && (
            <label className="report-field">
              <span>{t('report.chi')}</span>
              <select value={chiRoots.includes(chi) ? chi : ''} onChange={(e) => setChi(e.target.value)}>
                <option value="">{t('report.chiAll')}</option>
                {chiRoots.map((id, i) => (
                  <option key={id} value={id}>
                    {chiLabel(i, id)}
                  </option>
                ))}
              </select>
              <span className="muted small">{t('report.chiHint')}</span>
            </label>
          )}

          <label className="report-field">
            <span>{t('report.reportTitle')}</span>
            <input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={200} />
          </label>
          <label className="report-field">
            <span>{t('report.reportSubtitle')}</span>
            <input value={subtitle} onChange={(e) => setSubtitle(e.target.value)} maxLength={200} />
          </label>
          <label className="report-field report-color">
            <span>{t('report.textColor')}</span>
            <input type="color" value={textColor} onChange={(e) => setTextColor(e.target.value)} />
          </label>
          <MarginsField
            legend={t('report.titleArea')}
            hint={t('report.titleAreaHint')}
            area={titleArea}
            onChange={setTitleArea}
          />

          <fieldset className="report-margins report-colors">
            <legend>{t('report.cardColors')}</legend>
            {COLOR_FIELDS.map((field) => (
              <label key={field} className="report-field report-color">
                <span>{t(`report.${field}Color`)}</span>
                <input
                  type="color"
                  value={colors[field]}
                  onChange={(e) => setColors((c) => ({ ...c, [field]: e.target.value }))}
                />
              </label>
            ))}
          </fieldset>

          <MarginsField legend={t('report.treeArea')} hint={t('report.treeAreaHint')} area={area} onChange={setArea} />

          <fieldset className="report-margins">
            <legend>{t('report.depthSizes')}</legend>
            <p className="muted small">{t('report.depthSizesHint')}</p>
            {depthSizes.map((size, i) => (
              <label key={i} className="photo-editor-slider">
                <span>
                  {t(i === depthSizes.length - 1 ? 'report.depthLast' : 'report.depth', { n: i + 1 })}{' '}
                  <span className="muted">{size}%</span>
                </span>
                <input
                  type="range"
                  min={DEPTH_SIZE_MIN}
                  max={DEPTH_SIZE_MAX}
                  step={10}
                  value={size}
                  onChange={(e) =>
                    setDepthSizes((s) => s.map((v, j) => (j === i ? Number(e.target.value) : v)) as ReportDepthSizes)
                  }
                />
              </label>
            ))}
          </fieldset>

          <div className="report-zoom" role="group" aria-label={t('report.zoom')}>
            <span>{t('report.zoom')}</span>
            <button
              type="button"
              className="btn small icon-only"
              onClick={() => zoomBy(-1)}
              disabled={zoom <= REPORT_ZOOM_MIN}
              aria-label={t('report.zoomOut')}
              title={t('report.zoomOut')}
            >
              <Icon name="minus" />
            </button>
            <output className="report-zoom-value" aria-live="polite">
              {Math.round(zoom * 100)}%
            </output>
            <button
              type="button"
              className="btn small icon-only"
              onClick={() => zoomBy(1)}
              disabled={zoom >= REPORT_ZOOM_MAX}
              aria-label={t('report.zoomIn')}
              title={t('report.zoomIn')}
            >
              <Icon name="plus" />
            </button>
            <button type="button" className="btn small ghost" onClick={() => setZoom(1)} disabled={zoom === 1}>
              {t('report.zoomFit')}
            </button>
          </div>
          {zoom > 1 && <p className="muted small">{t('report.zoomCropHint')}</p>}
          <p className="muted small">{t('report.shapeHint')}</p>

          {canManage ? (
            <div className="report-save">
              <button
                type="button"
                className="btn small"
                onClick={() => void save()}
                disabled={!changed || !canSave || !!busy}
                title={t('report.saveTitle')}
              >
                <Icon name="save" />
                {busy === 'save' ? t('report.saving') : t('report.save')}
              </button>
              {!canSave && <p className="muted small">{t('report.noStorage')}</p>}
            </div>
          ) : (
            <p className="muted small">{t('report.notManager')}</p>
          )}
          {notice && <p className="small report-notice">{notice}</p>}
          {error && <p className="error small">{error}</p>}
        </div>
      </div>

      <div className="report-foot">
        <button type="button" className="btn" onClick={onClose} disabled={!!busy}>
          {t('common.close')}
        </button>
        <button type="button" className="btn" onClick={() => void download('png')} disabled={!ready || !!busy}>
          <Icon name="download" />
          {busy === 'png' ? t('tree.exporting') : t('tree.downloadPng')}
        </button>
        <button type="button" className="btn primary" onClick={() => void download('pdf')} disabled={!ready || !!busy}>
          <Icon name="download" />
          {busy === 'pdf' ? t('tree.exporting') : t('tree.downloadPdf')}
        </button>
      </div>
    </dialog>
  );
}
