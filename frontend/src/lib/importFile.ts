// Reads a filled-in import template (CSV, .xlsx or .xls) into rows for
// POST /api/trees/:treeId/import, and builds the downloadable templates.
// SheetJS is loaded on demand so it isn't part of every page's bundle.

import type { WorkBook } from 'xlsx';
import { locales, translate, type Locale, type MessageKey } from './i18n';
import { foldText } from './search';
import type { Gender, ImportRowInput } from './types';

export const IMPORT_MAX_ROWS = 2000;

export type ImportField = Exclude<keyof ImportRowInput, 'row'>;

interface Column {
  field: ImportField;
  /** Extra header spellings accepted on top of the translated headers (compared after normalizeHeader). */
  aliases: string[];
  required?: boolean;
}

export const IMPORT_COLUMNS: Column[] = [
  { field: 'key', aliases: ['id', 'key', 'ma', 'maso', 'stt'] },
  { field: 'firstName', aliases: ['firstname', 'givenname', 'ten', 'tenvatendem'], required: true },
  { field: 'lastName', aliases: ['lastname', 'surname', 'familyname', 'ho'] },
  { field: 'gender', aliases: ['gender', 'sex', 'gioitinh'] },
  { field: 'birthDate', aliases: ['birthdate', 'born', 'dob', 'dateofbirth', 'ngaysinh', 'namsinh'] },
  { field: 'deathDate', aliases: ['deathdate', 'died', 'dod', 'dateofdeath', 'ngaymat', 'nammat'] },
  { field: 'birthPlace', aliases: ['birthplace', 'placeofbirth', 'noisinh', 'quequan'] },
  { field: 'address', aliases: ['address', 'homeaddress', 'residence', 'diachi', 'noio', 'choohientai'] },
  { field: 'fatherKey', aliases: ['fatherid', 'father', 'macha', 'cha', 'mabo', 'bo'] },
  { field: 'motherKey', aliases: ['motherid', 'mother', 'mame', 'me'] },
  { field: 'spouseKeys', aliases: ['spouseids', 'spouseid', 'spouses', 'spouse', 'mavochong', 'vochong'] },
  { field: 'photoUrl', aliases: ['photourl', 'photo', 'anh', 'anhurl'] },
  { field: 'bio', aliases: ['bio', 'biography', 'notes', 'tieusu', 'ghichu'] },
];

export const columnHeaderKey = (field: ImportField) => `import.col.${field}` as MessageKey;
export const columnHelpKey = (field: ImportField) => `import.help.${field}` as MessageKey;

/** "Ngày sinh", "birth_date" and "Birth Date" all become comparable keys. */
const normalizeHeader = (value: string) => foldText(value).replace(/[^a-z0-9]/g, '');

const headerToField = new Map<string, ImportField>();
for (const col of IMPORT_COLUMNS) {
  const names = [...col.aliases, ...locales.map((l) => translate(l, columnHeaderKey(col.field)))];
  for (const name of names) headerToField.set(normalizeHeader(name), col.field);
}

const genderWords = new Map<string, Gender>();
for (const gender of ['male', 'female', 'other', 'unknown'] as const) {
  for (const l of locales) genderWords.set(normalizeHeader(translate(l, `gender.${gender}`)), gender);
  genderWords.set(gender, gender);
}
for (const [word, gender] of [
  ['m', 'male'], ['f', 'female'], ['trai', 'male'], ['gai', 'female'], ['nu', 'female'], ['khac', 'other'],
] as const) {
  genderWords.set(word, gender);
}

// ---------- Cell values ----------

const pad = (n: number | string) => String(n).padStart(2, '0');

function cellText(value: unknown): string {
  if (value == null) return '';
  if (value instanceof Date) return formatDate(value);
  return String(value).trim();
}

// Excel date cells come back as Dates in the local time zone.
const formatDate = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

/** Normalizes common date spellings to YYYY, YYYY-MM or YYYY-MM-DD; anything else is passed on for the API to reject. */
function partialDate(value: unknown): string | undefined {
  if (value instanceof Date) return formatDate(value);
  const text = cellText(value);
  if (!text) return undefined;
  let m = /^(\d{4})(?:[-/.](\d{1,2}))?(?:[-/.](\d{1,2}))?$/.exec(text);
  if (m) return [m[1], m[2] && pad(m[2]), m[3] && pad(m[3])].filter(Boolean).join('-');
  // Day first, as written in Vietnam and most of the world: 02/03/1950, 03/1950.
  m = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$/.exec(text);
  if (m) return `${m[3]}-${pad(m[2])}-${pad(m[1])}`;
  m = /^(\d{1,2})[-/.](\d{4})$/.exec(text);
  if (m) return `${m[2]}-${pad(m[1])}`;
  return text;
}

function gender(value: unknown): string | undefined {
  const text = cellText(value);
  if (!text) return undefined;
  return genderWords.get(normalizeHeader(text)) ?? text;
}

const optional = (value: unknown) => cellText(value) || undefined;

// ---------- Reading ----------

export class ImportFileError extends Error {
  constructor(public readonly code: 'noHeader' | 'empty') {
    super(code);
  }
}

export interface ParsedImport {
  rows: ImportRowInput[];
  sheetName: string;
  /** Headers that matched no column. */
  ignoredColumns: string[];
  hasIdColumn: boolean;
}

async function readWorkbook(file: File): Promise<WorkBook> {
  const XLSX = await import('xlsx');
  if (/\.(csv|txt)$/i.test(file.name) || file.type === 'text/csv') {
    // Decode as UTF-8 ourselves (Vietnamese names) and keep every value as text.
    return XLSX.read(await file.text(), { type: 'string', raw: true });
  }
  return XLSX.read(await file.arrayBuffer(), { type: 'array', cellDates: true });
}

export async function parseImportFile(file: File): Promise<ParsedImport> {
  const XLSX = await import('xlsx');
  const workbook = await readWorkbook(file);

  // The first sheet with a recognisable header row (within its first 10 rows).
  for (const sheetName of workbook.SheetNames) {
    const sheet = workbook.Sheets[sheetName];
    if (!sheet?.['!ref']) continue;
    const firstRow = XLSX.utils.decode_range(sheet['!ref']).s.r;
    const grid = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, raw: true, defval: null, blankrows: true });

    const headerIndex = grid
      .slice(0, 10)
      .findIndex((cells) => cells.some((c) => headerToField.get(normalizeHeader(cellText(c))) === 'firstName'));
    if (headerIndex < 0) continue;

    const fieldAt = new Map<number, ImportField>();
    const ignoredColumns: string[] = [];
    grid[headerIndex].forEach((cell, i) => {
      const header = cellText(cell);
      const field = headerToField.get(normalizeHeader(header));
      if (field && ![...fieldAt.values()].includes(field)) fieldAt.set(i, field);
      else if (header) ignoredColumns.push(header);
    });

    const rows: ImportRowInput[] = [];
    grid.slice(headerIndex + 1).forEach((cells, offset) => {
      if (!cells.some((c) => cellText(c))) return;
      const row = firstRow + headerIndex + offset + 2; // 1-based, below the header
      const value = (field: ImportField) => {
        for (const [i, f] of fieldAt) if (f === field) return cells[i];
        return undefined;
      };
      const spouses = cellText(value('spouseKeys'))
        .split(/[;,|]/)
        .map((s) => s.trim())
        .filter(Boolean);
      rows.push({
        row,
        // Rows without an ID still import; they just can't be linked to.
        key: cellText(value('key')) || `#${row}`,
        firstName: cellText(value('firstName')),
        lastName: optional(value('lastName')),
        gender: gender(value('gender')),
        birthDate: partialDate(value('birthDate')),
        deathDate: partialDate(value('deathDate')),
        birthPlace: optional(value('birthPlace')),
        address: optional(value('address')),
        fatherKey: optional(value('fatherKey')),
        motherKey: optional(value('motherKey')),
        spouseKeys: spouses.length ? spouses : undefined,
        photoUrl: optional(value('photoUrl')),
        bio: optional(value('bio')),
      });
    });

    if (!rows.length) throw new ImportFileError('empty');
    return { rows, sheetName, ignoredColumns, hasIdColumn: [...fieldAt.values()].includes('key') };
  }
  throw new ImportFileError('noHeader');
}

// ---------- Templates ----------

/** A small sample family, so the links between rows are easy to follow. */
function exampleRows(locale: Locale): string[][] {
  const g = (gender: Gender) => translate(locale, `gender.${gender}`);
  const rows: Partial<Record<ImportField, string>>[] = [
    { key: '1', firstName: 'Văn An', lastName: 'Nguyễn', gender: g('male'), birthDate: '1930', deathDate: '2001', birthPlace: 'Hà Nội', spouseKeys: '2' },
    { key: '2', firstName: 'Thị Bình', lastName: 'Trần', gender: g('female'), birthDate: '1935-04', birthPlace: 'Nam Định' },
    { key: '3', firstName: 'Văn Cường', lastName: 'Nguyễn', gender: g('male'), birthDate: '1958-09-12', birthPlace: 'Hà Nội', address: 'Cầu Giấy, Hà Nội', fatherKey: '1', motherKey: '2', spouseKeys: '4' },
    { key: '4', firstName: 'Thị Dung', lastName: 'Lê', gender: g('female'), birthDate: '1960' },
    { key: '5', firstName: 'Minh', lastName: 'Nguyễn', gender: g('male'), birthDate: '1985-02-20', fatherKey: '3', motherKey: '4' },
  ];
  return rows.map((r) => IMPORT_COLUMNS.map((c) => r[c.field] ?? ''));
}

const headers = (locale: Locale) => IMPORT_COLUMNS.map((c) => translate(locale, columnHeaderKey(c.field)));

function download(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = Object.assign(document.createElement('a'), { href: url, download: filename });
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function downloadCsvTemplate(locale: Locale) {
  const quote = (v: string) => (/[",;\r\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
  const csv = [headers(locale), ...exampleRows(locale)].map((r) => r.map(quote).join(',')).join('\r\n');
  // The BOM makes Excel open the file as UTF-8, so Vietnamese characters survive.
  download(new Blob(['﻿', csv, '\r\n'], { type: 'text/csv;charset=utf-8' }), 'family-tree-import.csv');
}

export async function downloadExcelTemplate(locale: Locale) {
  const XLSX = await import('xlsx');
  const t = (key: MessageKey) => translate(locale, key);

  const people = XLSX.utils.aoa_to_sheet([headers(locale), ...exampleRows(locale)]);
  // Text-formatted cells so Excel keeps IDs and partial dates as typed.
  for (const address of Object.keys(people)) {
    if (!address.startsWith('!')) people[address].z = '@';
  }
  people['!cols'] = IMPORT_COLUMNS.map((c) => ({ wch: c.field === 'bio' ? 40 : c.field === 'key' ? 8 : 16 }));

  const help = XLSX.utils.aoa_to_sheet([
    [t('import.colColumn'), t('import.colRequired'), t('import.colDescription')],
    ...IMPORT_COLUMNS.map((c) => [
      translate(locale, columnHeaderKey(c.field)),
      c.required ? t('import.required') : '',
      translate(locale, columnHelpKey(c.field)),
    ]),
    [],
    [t('import.excelDateTip')],
    [t('import.note')],
  ]);
  help['!cols'] = [{ wch: 18 }, { wch: 10 }, { wch: 90 }];

  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, people, t('import.sheetPeople'));
  XLSX.utils.book_append_sheet(workbook, help, t('import.sheetHelp'));
  const bytes: ArrayBuffer = XLSX.write(workbook, { type: 'array', bookType: 'xlsx' });
  download(
    new Blob([bytes], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }),
    'family-tree-import.xlsx',
  );
}
