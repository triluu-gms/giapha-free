import type { Locale } from '../auth/cookies';
import { config } from '../config';
import { query } from '../db';
import { notFound } from '../errors';
import { TREE_SETTINGS_CYPHER, type TreeSettings } from '../trees/settings';

// A tree's data as files: a CSV in the Import page's template format, so it can be
// imported again (into this tree or a new one), and a JSON file with everything.

interface ExportPerson {
  id: string;
  firstName: string;
  lastName: string | null;
  gender: string | null;
  birthDate: string | null;
  deathDate: string | null;
  birthPlace: string | null;
  address: string | null;
  photoUrl: string | null;
  bio: string | null;
  createdAt: string | null;
  updatedAt: string | null;
}

export interface TreeExport {
  tree: { id: string; name: string; settings: TreeSettings };
  people: ExportPerson[];
  /** [parentId, childId] */
  parentOf: [string, string][];
  /** [personId, personId], each couple once */
  spouseOf: [string, string][];
}

export async function loadTreeExport(treeId: string): Promise<TreeExport> {
  const [row] = await query<TreeExport>(
    `MATCH (t:Tree {id: $treeId})
     RETURN t {.id, .name, settings: ${TREE_SETTINGS_CYPHER}} AS tree,
       COLLECT {
         MATCH (p:Person {treeId: $treeId})
         RETURN p {.id, .firstName, .lastName, .gender, .birthDate, .deathDate, .birthPlace, .address,
                   .photoUrl, .bio, .createdAt, .updatedAt}
         ORDER BY p.createdAt, p.id
       } AS people,
       COLLECT {
         MATCH (a:Person {treeId: $treeId})-[:PARENT_OF]->(b:Person {treeId: $treeId})
         RETURN [a.id, b.id]
       } AS parentOf,
       COLLECT {
         MATCH (a:Person {treeId: $treeId})-[:SPOUSE_OF]-(b:Person {treeId: $treeId})
         WHERE a.id < b.id
         RETURN DISTINCT [a.id, b.id]
       } AS spouseOf`,
    { treeId },
  );
  if (!row) throw notFound('Tree');
  return row;
}

/** Uploaded photos are app paths; links in an exported file need the full address. */
const absolutePhotoUrl = (url: string | null) => (url?.startsWith('/') ? `${config.auth.publicAppUrl}${url}` : url);

/** The JSON backup: every field and relationship, with the app's own ids. */
export function exportJson(data: TreeExport, exportedAt: string): Buffer {
  const people = data.people.map((p) => ({ ...p, photoUrl: absolutePhotoUrl(p.photoUrl) }));
  const json = { format: 'giapha-free-backup', version: 1, exportedAt, ...data, people };
  return Buffer.from(JSON.stringify(json, null, 2), 'utf8');
}

// Column headers of the import template, as in frontend/src/lib/i18n.ts (`import.col.*`)
// and the column order of IMPORT_COLUMNS in frontend/src/lib/importFile.ts.
const HEADERS: Record<Locale, string[]> = {
  en: ['ID', 'First name', 'Last name', 'Gender', 'Birth date', 'Death date', 'Birthplace', 'Address', 'Father ID', 'Mother ID', 'Spouse IDs', 'Photo URL', 'Biography'],
  vi: ['Mã', 'Tên', 'Họ', 'Giới tính', 'Ngày sinh', 'Ngày mất', 'Nơi sinh', 'Địa chỉ', 'Mã cha', 'Mã mẹ', 'Mã vợ/chồng', 'Ảnh (URL)', 'Tiểu sử'],
};

const GENDERS: Record<Locale, Record<string, string>> = {
  en: { male: 'Male', female: 'Female', other: 'Other' },
  vi: { male: 'Nam', female: 'Nữ', other: 'Khác' },
};

function csvCell(value: string | null | undefined): string {
  const text = value ?? '';
  // Formula-looking text is prefixed so spreadsheets don't run it (CSV injection).
  // "- item" (a dash and a space, as in a list) isn't a formula and stays as it is.
  const safe = /^(=|\+|@|-(?!\s)|\t|\r)/.test(text) ? `'${text}` : text;
  return /[",\r\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

/**
 * The CSV import template (UTF-8 with a BOM, so Excel shows Vietnamese correctly).
 * People get short IDs (1, 2, 3…) that the Father ID, Mother ID and Spouse IDs columns use.
 */
export function exportCsv(data: TreeExport, locale: Locale): Buffer {
  const key = new Map(data.people.map((p, i) => [p.id, String(i + 1)]));
  const gender = new Map(data.people.map((p) => [p.id, p.gender]));
  const fathers = new Map<string, string>();
  const mothers = new Map<string, string>();
  for (const [parent, child] of data.parentOf) {
    // Parents go in by gender; one of unknown gender takes whichever column is still free.
    const g = gender.get(parent);
    const first = g === 'female' ? mothers : fathers;
    const second = first === fathers ? mothers : fathers;
    if (!first.has(child) && (g === 'male' || g === 'female' || !second.has(child))) first.set(child, parent);
    else if (!second.has(child)) second.set(child, parent);
  }
  const spouses = new Map<string, string[]>();
  for (const [a, b] of data.spouseOf) {
    spouses.set(a, [...(spouses.get(a) ?? []), b]);
    spouses.set(b, [...(spouses.get(b) ?? []), a]);
  }
  const keyOf = (id: string | undefined) => (id ? key.get(id) ?? '' : '');

  const rows = data.people.map((p) => [
    key.get(p.id)!,
    p.firstName,
    p.lastName,
    p.gender ? GENDERS[locale][p.gender] ?? '' : '',
    p.birthDate,
    p.deathDate,
    p.birthPlace,
    p.address,
    keyOf(fathers.get(p.id)),
    keyOf(mothers.get(p.id)),
    (spouses.get(p.id) ?? []).map((id) => key.get(id)).join(';'),
    absolutePhotoUrl(p.photoUrl),
    p.bio,
  ]);
  const csv = [HEADERS[locale], ...rows].map((r) => r.map(csvCell).join(',')).join('\r\n');
  return Buffer.from(`﻿${csv}\r\n`, 'utf8');
}

/** File name stem: the tree's name made safe for any file system, plus the date and time (UTC). */
export function exportFileStem(treeName: string, at: Date): string {
  const slug =
    treeName
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/[đĐ]/g, 'd')
      .replace(/[^a-zA-Z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .toLowerCase()
      .slice(0, 60) || 'gia-pha';
  const stamp = at.toISOString().slice(0, 16).replace('T', '_').replace(':', '');
  return `${slug}_${stamp}`;
}
