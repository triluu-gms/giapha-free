'use client';

import Link from 'next/link';
import { useRef, useState, type ChangeEvent } from 'react';
import { useI18n } from '@/components/I18nProvider';
import RequireAuth from '@/components/RequireAuth';
import { useCurrentTree } from '@/components/TreeProvider';
import {
  columnHeaderKey,
  columnHelpKey,
  downloadCsvTemplate,
  downloadExcelTemplate,
  IMPORT_COLUMNS,
  IMPORT_MAX_ROWS,
  ImportFileError,
  parseImportFile,
  type ImportField,
  type ParsedImport,
} from '@/lib/importFile';
import type { Gender, ImportCheck, ImportMatches, ImportSummary } from '@/lib/types';

const PREVIEW_ROWS = 50;
const GENDERS = new Set<string>(['male', 'female', 'other', 'unknown']);

type Checked = { file: string; parsed: ParsedImport; check: ImportCheck; matches: ImportMatches };
type State =
  | { kind: 'idle' }
  | { kind: 'reading' }
  | ({ kind: 'checked' | 'rechecking' | 'importing' } & Checked)
  | { kind: 'done'; result: ImportSummary };

// Row IDs are compared case-insensitively, as the API does.
const rowKey = (key: string) => key.trim().toLowerCase();

/** A row with exactly one strong match (same name and birth year) starts out as that person. */
function defaultMatches(parsed: ParsedImport, check: ImportCheck): ImportMatches {
  const matches: ImportMatches = {};
  const used = new Set<string>();
  for (const row of parsed.rows) {
    const strong = (check.candidates[rowKey(row.key)] ?? []).filter((c) => c.strong);
    if (strong.length === 1 && !used.has(strong[0].id)) {
      matches[row.key] = strong[0].id;
      used.add(strong[0].id);
    }
  }
  return matches;
}

export default function ImportPage() {
  return (
    <RequireAuth>
      <Importer />
    </RequireAuth>
  );
}

function Importer() {
  const { tree, treeApi, canEdit, branchOnly, refreshTrees } = useCurrentTree();
  const { t, locale } = useI18n();
  const [state, setState] = useState<State>({ kind: 'idle' });
  const [error, setError] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  async function onFile(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = ''; // so choosing the same file again (after fixing it) still triggers
    if (!file) return;
    setError(null);
    setState({ kind: 'reading' });
    try {
      const parsed = await parseImportFile(file);
      if (parsed.rows.length > IMPORT_MAX_ROWS) {
        setError(t('import.tooMany', { count: parsed.rows.length, max: IMPORT_MAX_ROWS }));
        setState({ kind: 'idle' });
        return;
      }
      let check = await treeApi.checkImport(parsed.rows);
      const matches = defaultMatches(parsed, check);
      // Linking to people in the tree changes what's valid (ages, loops), so check again with them.
      if (Object.keys(matches).length) check = await treeApi.checkImport(parsed.rows, matches);
      setState({ kind: 'checked', file: file.name, parsed, check, matches });
    } catch (err) {
      setError(
        err instanceof ImportFileError
          ? t(err.code === 'empty' ? 'import.empty' : 'import.noHeader')
          : t('import.readError', { error: (err as Error).message }),
      );
      setState({ kind: 'idle' });
    }
  }

  /** A row now stands for that person already in the tree (or, with null, for a new person). */
  async function changeMatch(key: string, personId: string | null) {
    if (state.kind !== 'checked') return;
    const matches = { ...state.matches };
    if (personId) matches[key] = personId;
    else delete matches[key];
    setError(null);
    setState({ ...state, kind: 'rechecking', matches });
    try {
      const check = await treeApi.checkImport(state.parsed.rows, matches);
      setState({ ...state, kind: 'checked', matches, check });
    } catch (err) {
      setError((err as Error).message);
      setState({ ...state, kind: 'checked' });
    }
  }

  async function runImport() {
    if (state.kind !== 'checked') return;
    setError(null);
    setState({ ...state, kind: 'importing' });
    try {
      const result = await treeApi.importPeople(state.parsed.rows, state.matches);
      setState({ kind: 'done', result });
      await refreshTrees(tree.id); // person counts
    } catch (err) {
      setError((err as Error).message);
      setState({ ...state, kind: 'checked' });
    }
  }

  if (!canEdit || branchOnly) {
    return (
      <div className="center">
        <h2>{t('import.title')}</h2>
        <p className="muted">{t(branchOnly ? 'import.branchOnly' : 'import.viewOnly')}</p>
      </div>
    );
  }

  if (state.kind === 'done') {
    const { result } = state;
    return (
      <div className="page">
        <section className="card import-done">
          <h1>{t('import.doneTitle')}</h1>
          <p>
            {t('import.done', {
              people: result.people,
              parents: result.parentLinks,
              spouses: result.spouseLinks,
              tree: tree.name,
            })}
          </p>
          {result.matched > 0 && <p className="muted">{t('import.doneMatched', { count: result.matched })}</p>}
          <div className="button-row">
            <Link href="/" className="btn primary">
              {t('import.viewTree')}
            </Link>
            <button className="btn" onClick={() => setState({ kind: 'idle' })}>
              {t('import.another')}
            </button>
          </div>
        </section>
      </div>
    );
  }

  return (
    <div className="page import-page">
      <h1>{t('import.title')}</h1>
      <p className="muted">{t('import.subtitle', { tree: tree.name })}</p>

      <section className="card">
        <h2>{t('import.step1')}</h2>
        <p className="muted">{t('import.step1Hint')}</p>
        <div className="button-row">
          <button className="btn" onClick={() => void downloadExcelTemplate(locale)}>
            {t('import.templateXlsx')}
          </button>
          <button className="btn" onClick={() => downloadCsvTemplate(locale)}>
            {t('import.templateCsv')}
          </button>
        </div>
        <details>
          <summary>{t('import.columnsTitle')}</summary>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>{t('import.colColumn')}</th>
                  <th>{t('import.colRequired')}</th>
                  <th>{t('import.colDescription')}</th>
                </tr>
              </thead>
              <tbody>
                {IMPORT_COLUMNS.map((c) => (
                  <tr key={c.field}>
                    <td className="nowrap">
                      <strong>{t(columnHeaderKey(c.field))}</strong>
                    </td>
                    <td>{c.required ? t('import.required') : ''}</td>
                    <td>{t(columnHelpKey(c.field))}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="muted small">{t('import.excelDateTip')}</p>
        </details>
        <p className="muted small">{t('import.note')}</p>
      </section>

      <section className="card">
        <h2>{t('import.step2')}</h2>
        <p className="muted">{t('import.fileHint', { max: IMPORT_MAX_ROWS })}</p>
        <input
          ref={fileInput}
          type="file"
          accept=".csv,.xlsx,.xls,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel"
          onChange={onFile}
          className="sr-only"
          id="import-file"
        />
        <button
          className="btn primary"
          onClick={() => fileInput.current?.click()}
          disabled={state.kind === 'reading' || state.kind === 'importing'}
        >
          {state.kind === 'reading' ? t('import.reading') : t('import.chooseFile')}
        </button>
        {error && <p className="error">{error}</p>}
      </section>

      {(state.kind === 'checked' || state.kind === 'rechecking' || state.kind === 'importing') && (
        <CheckResult state={state} onImport={runImport} onMatch={changeMatch} />
      )}
    </div>
  );
}

/**
 * Rows that may be people already in the tree. Each can be added as a new person
 * or stand for one of them: then nobody is created for it, and the file's links to
 * that row attach to the person in the tree (a new branch under someone existing).
 */
function MatchTable({
  state,
  onMatch,
}: {
  state: Extract<State, { kind: 'checked' | 'rechecking' | 'importing' }>;
  onMatch: (key: string, personId: string | null) => void;
}) {
  const { t, formatName, formatLifespan } = useI18n();
  const { parsed, check, matches } = state;
  const rows = parsed.rows.filter((r) => check.candidates[rowKey(r.key)]?.length);
  if (!rows.length) return null;
  // A person in the tree can stand for one row only.
  const takenBy = new Map(Object.entries(matches).map(([key, id]) => [id, key]));

  return (
    <div className="import-matches">
      <h2>{t('import.matchesTitle', { count: rows.length })}</h2>
      <p className="muted small">{t('import.matchesHint')}</p>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>{t('import.colRow')}</th>
              <th>{t('import.matchesInFile')}</th>
              <th>{t('import.matchesChoice')}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.row}>
                <td>{r.row}</td>
                <td>
                  {formatName(r)} <span className="muted small">{formatLifespan(r)}</span>
                </td>
                <td>
                  <select
                    value={matches[r.key] ?? ''}
                    disabled={state.kind !== 'checked'}
                    onChange={(e) => onMatch(r.key, e.target.value || null)}
                    aria-label={t('import.matchesChoiceFor', { row: r.row })}
                  >
                    <option value="">{t('import.matchNew')}</option>
                    {check.candidates[rowKey(r.key)].map((c) => (
                      <option key={c.id} value={c.id} disabled={takenBy.has(c.id) && takenBy.get(c.id) !== r.key}>
                        {t(c.strong ? 'import.matchSameStrong' : 'import.matchSame', {
                          name: formatName(c),
                          life: formatLifespan(c) || '?',
                        })}
                      </option>
                    ))}
                  </select>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function CheckResult({
  state,
  onImport,
  onMatch,
}: {
  state: Extract<State, { kind: 'checked' | 'rechecking' | 'importing' }>;
  onImport: () => void;
  onMatch: (key: string, personId: string | null) => void;
}) {
  const { t, formatName, formatGender, errorMessage } = useI18n();
  const { parsed, check, file, matches } = state;
  const busy = state.kind !== 'checked';
  const errorRows = new Set(check.rowErrors.map((e) => e.row));
  const fieldLabel = (field?: string) => {
    const name = field?.split('.')[0] as ImportField | undefined;
    return name && IMPORT_COLUMNS.some((c) => c.field === name) ? t(columnHeaderKey(name)) : '';
  };
  const shownKey = (key: string) => (key.startsWith('#') ? '—' : key);
  const count = parsed.rows.length;

  return (
    <section className="card">
      {parsed.ignoredColumns.length > 0 && (
        <p className="muted small">{t('import.ignoredColumns', { columns: parsed.ignoredColumns.join(', ') })}</p>
      )}
      {!parsed.hasIdColumn && <p className="muted small">{t('import.noIdColumn')}</p>}

      <MatchTable state={state} onMatch={onMatch} />

      {check.valid && check.summary ? (
        <>
          <p className="success">
            {t('import.summary', {
              people: check.summary.people,
              parents: check.summary.parentLinks,
              spouses: check.summary.spouseLinks,
              file,
            })}
            {check.summary.matched > 0 && ` ${t('import.summaryMatched', { count: check.summary.matched })}`}
          </p>
          <button className="btn primary" onClick={onImport} disabled={busy}>
            {state.kind === 'importing'
              ? t('import.importing')
              : state.kind === 'rechecking'
                ? t('import.rechecking')
                : t(check.summary.people === 1 ? 'import.submit_one' : 'import.submit_other', {
                    count: check.summary.people,
                  })}
          </button>
        </>
      ) : (
        <>
          <p className="error">{t('import.errorsTitle', { count: check.rowErrors.length })}</p>
          {check.rowErrors.length >= 200 && <p className="muted small">{t('import.errorsMore', { count: 200 })}</p>}
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>{t('import.colRow')}</th>
                  <th>{t('import.colColumn')}</th>
                  <th>{t('import.colProblem')}</th>
                </tr>
              </thead>
              <tbody>
                {check.rowErrors.map((e, i) => (
                  <tr key={i}>
                    <td>{e.row}</td>
                    <td className="nowrap">{fieldLabel(e.field)}</td>
                    <td>{errorMessage(e)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      <h2>{t('import.preview')}</h2>
      {count > PREVIEW_ROWS && (
        <p className="muted small">{t('import.previewMore', { shown: PREVIEW_ROWS, count })}</p>
      )}
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>{t('import.colRow')}</th>
              <th>{t('import.col.key')}</th>
              <th>{t('import.colName')}</th>
              <th>{t('import.col.gender')}</th>
              <th>{t('import.col.birthDate')}</th>
              <th>{t('import.col.deathDate')}</th>
              <th>{t('import.colParents')}</th>
              <th>{t('import.colSpouses')}</th>
            </tr>
          </thead>
          <tbody>
            {parsed.rows.slice(0, PREVIEW_ROWS).map((r) => (
              <tr key={r.row} className={errorRows.has(r.row) ? 'row-error' : undefined}>
                <td>{r.row}</td>
                <td>{shownKey(r.key)}</td>
                <td>
                  {formatName(r) || '—'}
                  {matches[r.key] && <span className="badge neutral small"> {t('import.inTree')}</span>}
                </td>
                <td>{r.gender && GENDERS.has(r.gender) ? formatGender(r.gender as Gender) : (r.gender ?? '—')}</td>
                <td>{r.birthDate ?? '—'}</td>
                <td>{r.deathDate ?? '—'}</td>
                <td>{[r.fatherKey, r.motherKey].filter(Boolean).join(' / ') || '—'}</td>
                <td>{r.spouseKeys?.join(', ') ?? '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
