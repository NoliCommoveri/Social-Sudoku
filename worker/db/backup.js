// The half of erase/export/import that has decisions in it, and therefore the
// half CI can reach. Values in, values out: nothing here knows what D1 is.
//
// Same split as plan.js and for the same reason -- there is no D1 in CI and no
// way to fake one honestly, so everything that decides anything takes plain
// arrays and objects as arguments and worker/db/apply.js does the talking.
//
// docs/hub/specs/phase-2-session-b-erase-export.md is the whole design.

import { sha256Hex } from './plan.js';

/** What the file says it is. A file without this is not ours. */
export const EXPORT_FORMAT = 'carson-gameroom-export';

/** Bumped only when the shape changes in a way an older reader would misread. */
export const EXPORT_VERSION = 1;

/**
 * SQLite's own tables and D1's. Not ours to export and not ours to drop -- a
 * DROP on one fails, and exporting one would restore a lie.
 */
const INTERNAL = /^(sqlite_|_cf_|d1_)/i;

/** @param {string} name */
export function isInternalTable(name) {
  return INTERNAL.test(name);
}

/**
 * Identifiers come from sqlite_master and from backup files people edit. Both
 * get quoted; the escaping rule does not get a family exemption.
 *
 * @param {string} name
 */
export function quoteIdent(name) {
  return `"${String(name).replaceAll('"', '""')}"`;
}

/**
 * @typedef {{ name: string, columns: string[], rows: Record<string, unknown>[] }} TableSnapshot
 * @typedef {{ name: string, checksum: string, applied_at: number }} SchemaRow
 * @typedef {{
 *   format: string,
 *   version: number,
 *   exported_at: number,
 *   schema: SchemaRow[],
 *   tables: TableSnapshot[],
 * }} BackupDoc
 */

/**
 * The export document. Key order here is the file's key order, and row objects
 * are rebuilt in column order rather than trusted, because §3.1 of the spec
 * needs identical data to produce identical bytes.
 *
 * `_migrations` is not among `tables` and must not be: re-importing the ledger
 * would claim files had been applied that may no longer read the same way.
 * It is in `schema`, as information, and Apply pending is the only thing that
 * may write the real one.
 *
 * @param {{ schema?: SchemaRow[], tables?: TableSnapshot[], exportedAt: number }} input
 * @returns {BackupDoc}
 */
export function buildExport({ schema = [], tables = [], exportedAt }) {
  return {
    format: EXPORT_FORMAT,
    version: EXPORT_VERSION,
    exported_at: exportedAt,
    schema: schema.map((row) => ({
      name: row.name,
      checksum: row.checksum,
      applied_at: row.applied_at,
    })),
    tables: tables.map((table) => ({
      name: table.name,
      columns: [...table.columns],
      rows: table.rows.map((row) =>
        Object.fromEntries(table.columns.map((column) => [column, value(row[column])])),
      ),
    })),
  };
}

/** Pretty-printed, because the file is opened in a browser by someone with no CLI. */
export function serializeExport(doc) {
  return `${JSON.stringify(doc, null, 2)}\n`;
}

/**
 * Identifies the *data*, not the document: `exported_at` is left out, so two
 * exports of an unchanged database agree. That is what lets the erase
 * confirmation compare the backup in your hand against the live database and
 * refuse when somebody finished a game in between.
 *
 * @param {BackupDoc} doc
 * @returns {Promise<string>}
 */
export function fingerprintOf(doc) {
  const { format, version, schema, tables } = doc;
  return sha256Hex(JSON.stringify({ format, version, schema, tables }));
}

/** SQLite holds no other types, and a bound parameter accepts no others. */
function value(raw) {
  if (raw === undefined) return null;
  if (typeof raw === 'boolean') return raw ? 1 : 0;
  return raw;
}

const isPlainObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const show = (v) => JSON.stringify(v === undefined ? null : v);

/**
 * Reads a backup file. Every failure here names what is wrong with the file,
 * because the alternative is a wall of SQLite errors from a typo.
 *
 * Structure and value types are this function's business. A *schema* that has
 * moved since the backup was taken is not a failure at all -- see planImport.
 *
 * @param {string} text
 * @returns {{ ok: true, doc: BackupDoc } | { ok: false, error: string }}
 */
export function parseBackup(text) {
  let doc;
  try {
    doc = JSON.parse(text);
  } catch (err) {
    return { ok: false, error: `That file is not JSON: ${err && err.message ? err.message : err}` };
  }

  if (!isPlainObject(doc)) {
    return { ok: false, error: 'That file is JSON but not an object. A backup is one object with a format, a version and a list of tables.' };
  }
  if (doc.format !== EXPORT_FORMAT) {
    return { ok: false, error: `That file is not a gameroom backup: its format is ${show(doc.format)} and this page reads "${EXPORT_FORMAT}".` };
  }
  if (doc.version !== EXPORT_VERSION) {
    return { ok: false, error: `That backup says version ${show(doc.version)}. This page reads version ${EXPORT_VERSION}, which is the only one there is.` };
  }
  if (doc.schema !== undefined && !Array.isArray(doc.schema)) {
    return { ok: false, error: 'That backup has a schema that is not a list.' };
  }
  if (!Array.isArray(doc.tables)) {
    return { ok: false, error: 'That backup has no list of tables in it.' };
  }

  for (const table of doc.tables) {
    if (!isPlainObject(table)) return { ok: false, error: 'One of the tables in that backup is not an object.' };
    if (typeof table.name !== 'string' || table.name === '') {
      return { ok: false, error: 'One of the tables in that backup has no name.' };
    }
    if (!Array.isArray(table.columns) || table.columns.some((c) => typeof c !== 'string' || c === '')) {
      return { ok: false, error: `Table ${table.name} has no usable list of columns.` };
    }
    if (!Array.isArray(table.rows)) {
      return { ok: false, error: `Table ${table.name} has no list of rows.` };
    }
    if (table.columns.length === 0 && table.rows.length > 0) {
      return { ok: false, error: `Table ${table.name} has rows but names no columns, so there is no way to tell what its values are.` };
    }
    for (const row of table.rows) {
      if (!isPlainObject(row)) return { ok: false, error: `Table ${table.name} has a row that is not an object.` };
      for (const column of table.columns) {
        const raw = row[column];
        if (raw === undefined || raw === null) continue;
        const type = typeof raw;
        if (type === 'string' || type === 'boolean') continue;
        if (type === 'number' && Number.isFinite(raw)) continue;
        return { ok: false, error: `Table ${table.name}, column ${column}: ${show(raw)} is not something a database column holds.` };
      }
    }
  }

  if (doc.schema === undefined) doc.schema = [];
  return { ok: true, doc };
}

/**
 * @typedef {{ table: string, sql: string, params: unknown[] }} ImportStatement
 * @typedef {{
 *   statements: ImportStatement[],
 *   attempted: { name: string, rows: number }[],
 *   unknownTables: string[],
 *   unusableTables: string[],
 *   droppedColumns: { table: string, columns: string[] }[],
 *   missingColumns: { table: string, columns: string[] }[],
 * }} ImportPlan
 */

/** D1 binds at most 100 parameters to one statement. Nothing here is close. */
const MAX_BOUND = 100;

/**
 * Turns a parsed backup into the statements that restore it, against whatever
 * schema the database has *now*.
 *
 * That last part is the whole design. An import into a schema identical to the
 * one exported is the rare case: the reason anybody erased is that the schema
 * changed, so a restore that only works into an unchanged schema is useless
 * exactly when it is needed. So this is tolerant per table and per column, and
 * reports every accommodation it made rather than making it quietly.
 *
 * `INSERT OR IGNORE`, never UPDATE: importing the same file twice changes
 * nothing the second time, which is what makes a half-applied import safe to
 * finish by pressing the button again, and what stops a restore overwriting a
 * row that is already there.
 *
 * Tables keep the file's order, which buildExport fixed as creation order,
 * which is a valid foreign-key insert order -- a table cannot reference one
 * that did not exist when it was created.
 *
 * @param {BackupDoc} doc
 * @param {Map<string, string[]> | Record<string, string[]>} liveSchema
 * @returns {ImportPlan}
 */
export function planImport(doc, liveSchema) {
  const live = liveSchema instanceof Map ? liveSchema : new Map(Object.entries(liveSchema));

  /** @type {ImportPlan} */
  const plan = {
    statements: [],
    attempted: [],
    unknownTables: [],
    unusableTables: [],
    droppedColumns: [],
    missingColumns: [],
  };

  for (const table of doc.tables) {
    const columns = live.get(table.name);
    if (!columns) {
      plan.unknownTables.push(table.name);
      continue;
    }

    const usable = table.columns.filter((column) => columns.includes(column));
    const dropped = table.columns.filter((column) => !columns.includes(column));
    const missing = columns.filter((column) => !table.columns.includes(column));

    if (dropped.length > 0) plan.droppedColumns.push({ table: table.name, columns: dropped });
    if (missing.length > 0) plan.missingColumns.push({ table: table.name, columns: missing });

    if (table.rows.length === 0) {
      plan.attempted.push({ name: table.name, rows: 0 });
      continue;
    }
    if (usable.length === 0 || usable.length > MAX_BOUND) {
      plan.unusableTables.push(table.name);
      continue;
    }

    const sql = `INSERT OR IGNORE INTO ${quoteIdent(table.name)} (${usable.map(quoteIdent).join(', ')})`
      + ` VALUES (${usable.map((_, i) => `?${i + 1}`).join(', ')})`;
    for (const row of table.rows) {
      plan.statements.push({ table: table.name, sql, params: usable.map((column) => value(row[column])) });
    }
    plan.attempted.push({ name: table.name, rows: table.rows.length });
  }

  return plan;
}

/**
 * D1 has no transaction spanning batches, so a large import can half-apply.
 * `INSERT OR IGNORE` is what makes that a stopped import rather than a corrupt
 * one: pressing Import again finishes it.
 *
 * @template T
 * @param {T[]} items
 * @param {number} [size]
 * @returns {T[][]}
 */
export function chunkStatements(items, size = 50) {
  if (size < 1) throw new RangeError('chunk size must be at least 1');
  const chunks = [];
  for (let i = 0; i < items.length; i += size) chunks.push(items.slice(i, i + size));
  return chunks;
}

/**
 * One line when the backup was taken against a different set of migrations.
 * A warning and never a refusal: a schema that moved is the reason the erase
 * happened, so refusing here would break the case this exists for.
 *
 * @param {BackupDoc} doc
 * @param {SchemaRow[]} applied
 * @returns {string | null}
 */
export function schemaDrift(doc, applied) {
  const key = (rows) => rows.map((row) => `${row.name}@${String(row.checksum).slice(0, 12)}`).join(', ') || 'nothing';
  const was = key(doc.schema || []);
  const now = key(applied);
  if (was === now) return null;
  return `This backup was taken against ${was}; the database now has ${now}. Importing anyway — columns that no longer exist are dropped and named below.`;
}
