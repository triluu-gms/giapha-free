// Ready-made report backgrounds (frontend/public/report-backgrounds/, drawn by
// scripts/report-backgrounds.mjs). Each comes with the boxes and colours that suit
// it: the title on its banner, the tree inside its border. A tree's saved
// background is "preset:<id>" for one of these, or the URL of an uploaded photo.

import type { ReportArea } from './types';

export interface ReportPreset {
  id: string;
  /** Where the tree goes, and the title, as margins in percent of the image. */
  area: ReportArea;
  titleArea: ReportArea;
  textColor: string;
  colors: { card: string; name: string; dates: string; line: string };
}

export const REPORT_PRESETS: ReportPreset[] = [
  {
    // Imperial red and gold: a Greek-key border and a ribbon banner.
    id: 'cung-dinh',
    area: [24, 7.5, 8.5, 7.5],
    titleArea: [12.5, 28, 79.5, 28],
    textColor: '#fff4c2',
    colors: { card: '#a8231a', name: '#fff4c2', dates: '#ffd27a', line: '#8e1b12' },
  },
  {
    // Soft pink with a lotus pond in the lower corners.
    id: 'sen-hong',
    area: [27, 9, 7, 9],
    titleArea: [13, 28, 77, 28],
    textColor: '#9c2f52',
    colors: { card: '#ffffff', name: '#8a2846', dates: '#a0675a', line: '#c4607a' },
  },
  {
    // Jade green with auspicious clouds and a plaque for the title.
    id: 'may-ngoc',
    area: [25, 6, 6, 6],
    titleArea: [11, 28, 79, 28],
    textColor: '#f3dc9a',
    colors: { card: '#1f5f4f', name: '#f6efd2', dates: '#cfe3c9', line: '#1f5f4f' },
  },
  {
    // Modern and minimal: warm white, navy lines.
    id: 'toi-gian',
    area: [28, 6.5, 6.5, 6.5],
    titleArea: [11.5, 20, 77, 20],
    textColor: '#1d2b4f',
    colors: { card: '#ffffff', name: '#1d2b4f', dates: '#6b7280', line: '#1d2b4f' },
  },
  {
    // Modern and warm: a sunset gradient over layered hills.
    id: 'hoang-hon',
    area: [25, 5, 9, 5],
    titleArea: [9.5, 22, 78, 22],
    textColor: '#7a2e22',
    colors: { card: '#ffffff', name: '#7a2e22', dates: '#b07255', line: '#c2573a' },
  },
];

/** The preset a tree starts with before anyone has chosen a background. */
export const DEFAULT_PRESET = REPORT_PRESETS[0];

const PREFIX = 'preset:';
export const presetValue = (id: string) => `${PREFIX}${id}`;
/** The preset a saved background value names, if it is one. */
export const presetOf = (value: string | null | undefined) =>
  value?.startsWith(PREFIX) ? REPORT_PRESETS.find((p) => p.id === value.slice(PREFIX.length)) : undefined;
export const presetImage = (id: string) => `/report-backgrounds/${id}.jpg`;
export const presetThumb = (id: string) => `/report-backgrounds/thumbs/${id}.jpg`;
