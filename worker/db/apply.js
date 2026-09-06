// Everything that touches D1. No logic worth testing lives here -- that is
// plan.js -- and none of this can run in CI, so it is kept as thin as the job
// allows and its behaviour is checked in a browser against a deployment.

import { splitStatements, sha256Hex, planFor } from './plan.js';
import {
  buildExport,
  chunkStatements,
  fingerprintOf,
  isInternalTable,
  planImport,
  quoteIdent,
  serializeExport,
} from './backup.js';

/** The ledger table. Named once, because the bootstrap reads it by name. */
const LEDGER = '_migrations';

/**
 * Whether the ledger table exists, and its rows if it does.
 *
 * Asked as a question rather than caught as an error. A fresh database has no
 * tables at all and the admin page has to render on it; a try/catch here could
 * not tell "there is no ledger" from "the ledger is corrupt", and those two
 * want different pages.
 *
 * @param {D1Database} db
 * @returns {Promise<{ exists: boolean, rows: import('./plan.js').LedgerRow[] }>}
 */
export async function readLedger(db) {
  const found = await db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?1")
    .bind(LEDGER)
    .all();
  if (found.results.length === 0) return { exists: false, rows: [] };

  const rows = await db
    .prepare(`SELECT name, checksum, applied_at FROM ${LEDGER} ORDER BY name`)
    .all();
  return { exists: true, rows: /** @type {any} */ (rows.results) };
}

/**
 * Checksums every migration file and classifies it against the ledger.
 *
 * @param {D1Database} db
 * @param {{ name: string, sql: string }[]} migrations
 */
export async function currentPlan(db, migrations) {
  const refs = await Promise.all(
    migrations.map(async (m) => ({ name: m.name, checksum: await sha256Hex(m.sql) })),
  );
  const { exists, rows } = await readLedger(db);
  return { ledgerExists: exists, ...planFor(rows, refs) };
}

/**
 * Runs the first statement of `statements` that throws and reports it.
 *
 * Called only after a batch has already failed and been rolled back whole, to
 * name the statement the error came from -- D1 reports the SQLite message and
 * not which of the statements produced it, and on the admin page there is
 * nowhere else to look.
 *
 * Executing statements to find the broken one is safe here for exactly one
 * reason: every statement in a migration or seed file is idempotent, asserted
 * by test/sql-files.test.js. The ledger row is not written, so the migration
 * stays pending and Apply pending re-runs the whole file cleanly afterwards.
 *
 * Takes either raw SQL or an import statement with its parameters; an import
 * is re-runnable for the same reason a migration is, because every one of its
 * statements is INSERT OR IGNORE.
 *
 * @param {D1Database} db
 * @param {(string | import('./backup.js').ImportStatement)[]} statements
 * @returns {Promise<{ statement: string, error: string } | null>}
 */
async function locateFailure(db, statements) {
  for (const statement of statements) {
    try {
      await prepareOne(db, statement).run();
    } catch (err) {
      return { statement: statementText(statement), error: message(err) };
    }
  }
  return null;
}

/** @param {D1Database} db @param {string | import('./backup.js').ImportStatement} item */
function prepareOne(db, item) {
  return typeof item === 'string' ? db.prepare(item) : db.prepare(item.sql).bind(...item.params);
}

/** What to put on the page. A bound statement is unreadable without its values. */
function statementText(item) {
  return typeof item === 'string' ? item : `${item.sql}\n-- values: ${JSON.stringify(item.params)}`;
}

/** @param {unknown} err */
function message(err) {
  return String(err && /** @type {Error} */ (err).message ? /** @type {Error} */ (err).message : err);
}

/**
 * @typedef {{
 *   ok: boolean,
 *   ran: string[],
 *   skipped: string,
 *   message: string,
 *   failure: { name: string, statement: string | null, error: string } | null,
 *   notes?: string[],
 * }} RunOutcome
 */

/**
 * Applies every pending migration, in order, one `batch()` per file.
 *
 * One file is one batch because D1 has no transaction spanning batches: a
 * migration split across two can half-apply, and there is no CLI to repair one
 * that did. The ledger insert is the last statement of the same batch, so a
 * file is recorded exactly when it lands.
 *
 * @param {D1Database} db
 * @param {{ name: string, sql: string }[]} migrations
 * @returns {Promise<RunOutcome>}
 */
export async function applyPending(db, migrations) {
  const plan = await currentPlan(db, migrations);

  if (plan.outOfOrder.length > 0) {
    return {
      ok: false,
      ran: [],
      skipped: '',
      message:
        `Refusing to apply: ${plan.outOfOrder.join(', ')} ` +
        'is pending but ordered before a migration that has already run. The files ' +
        'were edited under a live database, and applying forward would build a schema ' +
        'no fresh database would ever have. Erase everything, then Apply pending.',
      failure: null,
    };
  }

  const pending = plan.pending;
  if (pending.length === 0) {
    return { ok: true, ran: [], skipped: '', message: 'Nothing pending.', failure: null };
  }

  /** @type {string[]} */
  const ran = [];
  for (const name of pending) {
    const migration = migrations.find((m) => m.name === name);
    const entry = plan.entries.find((e) => e.name === name);
    if (!migration || !entry) continue;

    const statements = splitStatements(migration.sql);
    const batch = statements.map((statement) => db.prepare(statement));
    batch.push(
      db
        .prepare(`INSERT INTO ${LEDGER} (name, checksum, applied_at) VALUES (?1, ?2, ?3)`)
        .bind(name, entry.fileChecksum, Date.now()),
    );

    try {
      await db.batch(batch);
      ran.push(name);
    } catch (err) {
      const error = message(err);
      const located = await locateFailure(db, statements);
      return {
        ok: false,
        ran,
        // Everything after the failure is untouched, and saying so is the
        // difference between a stopped run and a half-applied one.
        skipped: pending.slice(pending.indexOf(name) + 1).join(', '),
        message: `${name} failed. The database is as it was before it started.`,
        failure: { name, statement: located ? located.statement : null, error: located ? located.error : error },
      };
    }
  }

  return {
    ok: true,
    ran,
    skipped: '',
    message: `Applied ${ran.length === 1 ? '1 migration' : `${ran.length} migrations`}.`,
    failure: null,
  };
}

/**
 * Re-runs every seed file, whole, in order. Not checksummed and not recorded:
 * pressing the button twice is the normal case, and every statement is an
 * INSERT ... ON CONFLICT DO NOTHING so the second press changes nothing.
 *
 * @param {D1Database} db
 * @param {{ name: string, sql: string }[]} seeds
 * @returns {Promise<RunOutcome>}
 */
export async function runSeeds(db, seeds) {
  /** @type {string[]} */
  const ran = [];
  for (const seed of seeds) {
    const statements = splitStatements(seed.sql);
    if (statements.length === 0) continue;
    try {
      await db.batch(statements.map((statement) => db.prepare(statement)));
      ran.push(seed.name);
    } catch (err) {
      const error = message(err);
      const located = await locateFailure(db, statements);
      return {
        ok: false,
        ran,
        skipped: seeds.slice(seeds.indexOf(seed) + 1).map((s) => s.name).join(', '),
        message: `${seed.name} failed. Seeds insert only, so nothing was changed.`,
        failure: { name: seed.name, statement: located ? located.statement : null, error: located ? located.error : error },
      };
    }
  }
  return {
    ok: true,
    ran,
    skipped: '',
    message: `Ran ${ran.length === 1 ? '1 seed file' : `${ran.length} seed files`}.`,
    failure: null,
  };
}

/**
 * Every table or view this project owns, in creation order.
 *
 * Creation order matters twice: it is a valid foreign-key insert order for the
 * import, and it makes the export's bytes stable, which is what the erase
 * fingerprint compares. SQLite's own tables and D1's are filtered out -- they
 * are not ours to export and a DROP on one fails.
 *
 * @param {D1Database} db
 * @param {'table' | 'view'} type
 * @returns {Promise<string[]>}
 */
async function listObjects(db, type) {
  const found = await db
    .prepare('SELECT name FROM sqlite_master WHERE type = ?1 ORDER BY rowid')
    .bind(type)
    .all();
  return /** @type {{ name: string }[]} */ (found.results)
    .map((row) => row.name)
    .filter((name) => !isInternalTable(name));
}

/**
 * A table's columns, in declaration order.
 *
 * PRAGMA rather than reading a row: the columns of an empty table are still
 * columns, and an empty result set carries no names. The fallback is for the
 * one thing here that cannot be checked before a deployment -- if D1 ever
 * declines the PRAGMA, a table with rows in it still exports its columns rather
 * than exporting nothing on the way into an erase.
 *
 * @param {D1Database} db
 * @param {string} table
 * @returns {Promise<string[]>}
 */
async function columnsOf(db, table) {
  try {
    const info = await db.prepare(`PRAGMA table_info(${quoteIdent(table)})`).all();
    const columns = /** @type {{ name: string }[]} */ (info.results).map((row) => row.name);
    if (columns.length > 0) return columns;
  } catch {
    // Fall through: a row's own keys are the columns, for as long as there is a row.
  }
  const first = await db.prepare(`SELECT * FROM ${quoteIdent(table)} LIMIT 1`).all();
  return first.results.length > 0 ? Object.keys(first.results[0]) : [];
}

/**
 * Reads the whole database into an export document, its bytes, and the
 * fingerprint of its data.
 *
 * One query per table and no paging. The number where that would need
 * revisiting is in the tens of thousands of rows, three orders of magnitude
 * from six players.
 *
 * @param {D1Database} db
 * @returns {Promise<{ doc: import('./backup.js').BackupDoc, body: string, fingerprint: string }>}
 */
export async function exportAll(db) {
  const { rows: schema } = await readLedger(db);
  const names = (await listObjects(db, 'table')).filter((name) => name !== LEDGER);

  /** @type {import('./backup.js').TableSnapshot[]} */
  const tables = [];
  for (const name of names) {
    const columns = await columnsOf(db, name);
    const data = await db.prepare(`SELECT * FROM ${quoteIdent(name)} ORDER BY rowid`).all();
    tables.push({
      name,
      columns,
      rows: /** @type {Record<string, unknown>[]} */ (data.results),
    });
  }

  const doc = buildExport({ schema, tables, exportedAt: Date.now() });
  return { doc, body: serializeExport(doc), fingerprint: await fingerprintOf(doc) };
}

/**
 * Drops every table and view, the ledger included -- which is what makes every
 * migration pending again and rebuilds the database from the files as they now
 * read.
 *
 * One DROP per statement, never a batch. A batch fails whole, so a foreign-key
 * refusal on one table would roll back the drops that succeeded and no pass
 * would ever make progress. Drop order is discovered by retrying until a pass
 * drops nothing new, not hardcoded: this must keep working when the schema
 * gains a table.
 *
 * Not atomic, and does not need to be. DROP ... IF EXISTS is idempotent, so a
 * half-finished erase is finished by pressing the button again.
 *
 * @param {D1Database} db
 * @returns {Promise<RunOutcome>}
 */
export async function eraseAll(db) {
  /** @type {string[]} */
  const dropped = [];
  /** @type {Map<string, string>} */
  const errors = new Map();

  for (const view of await listObjects(db, 'view')) {
    try {
      await db.prepare(`DROP VIEW IF EXISTS ${quoteIdent(view)}`).run();
      dropped.push(view);
    } catch (err) {
      errors.set(view, message(err));
    }
  }

  let remaining = await listObjects(db, 'table');
  while (remaining.length > 0) {
    const before = remaining.length;
    /** @type {string[]} */
    const still = [];
    for (const table of remaining) {
      try {
        await db.prepare(`DROP TABLE IF EXISTS ${quoteIdent(table)}`).run();
        dropped.push(table);
      } catch (err) {
        errors.set(table, message(err));
        still.push(table);
      }
    }
    remaining = still;
    if (remaining.length === before) break;
  }

  if (remaining.length > 0) {
    const first = remaining[0];
    return {
      ok: false,
      ran: dropped,
      skipped: remaining.join(', '),
      message: 'Erase stopped: a pass dropped nothing new, so the rest will not go either.',
      failure: {
        name: first,
        statement: `DROP TABLE IF EXISTS ${quoteIdent(first)}`,
        error: errors.get(first) || 'no error was reported',
      },
    };
  }

  return {
    ok: true,
    ran: dropped,
    skipped: '',
    message: dropped.length === 0
      ? 'There was nothing to erase.'
      : `Erased ${dropped.length === 1 ? '1 table' : `${dropped.length} tables`}, the migration ledger included.`,
    failure: null,
    notes: dropped.length === 0 ? [] : ['Every migration is pending again. Apply pending, then Run seed, then import a backup if you have one to put back.'],
  };
}

/**
 * Restores a parsed backup into whatever schema the database has now.
 *
 * The tolerance is in planImport; this runs what it produced and counts what
 * landed. `meta.changes` is the count that matters: an INSERT OR IGNORE that
 * hits an existing row reports zero, which is how "restored" is told from
 * "was already there".
 *
 * @param {D1Database} db
 * @param {import('./backup.js').BackupDoc} doc
 * @returns {Promise<RunOutcome>}
 */
export async function importAll(db, doc) {
  /** @type {Map<string, string[]>} */
  const live = new Map();
  for (const name of await listObjects(db, 'table')) {
    if (name !== LEDGER) live.set(name, await columnsOf(db, name));
  }

  const plan = planImport(doc, live);

  /** @type {string[]} */
  const notes = [];
  if (live.size === 0) {
    return {
      ok: false,
      ran: [],
      skipped: doc.tables.map((table) => table.name).join(', '),
      message: 'This database has no tables, so there is nothing to import into. Press Apply pending first, then import again.',
      failure: null,
    };
  }

  /** @type {Map<string, number>} */
  const inserted = new Map();
  const chunks = chunkStatements(plan.statements);
  for (const chunk of chunks) {
    try {
      const results = await db.batch(chunk.map((item) => prepareOne(db, item)));
      results.forEach((result, index) => {
        const table = chunk[index].table;
        const changes = result && result.meta ? result.meta.changes || 0 : 0;
        inserted.set(table, (inserted.get(table) || 0) + changes);
      });
    } catch (err) {
      const error = message(err);
      const located = await locateFailure(db, chunk);
      return {
        ok: false,
        ran: [...inserted.keys()],
        skipped: '',
        message: 'The import stopped. Rows already inserted stay; every statement is INSERT OR IGNORE, so fixing the file and importing again finishes the job rather than doubling it.',
        failure: {
          name: located ? chunk.find((item) => statementText(item) === located.statement)?.table || 'import' : 'import',
          statement: located ? located.statement : null,
          error: located ? located.error : error,
        },
        notes: report(plan, inserted),
      };
    }
  }

  notes.push(...report(plan, inserted));
  const total = [...inserted.values()].reduce((sum, n) => sum + n, 0);
  return {
    ok: plan.unknownTables.length === 0 && plan.unusableTables.length === 0,
    ran: plan.attempted.map((table) => table.name),
    skipped: [...plan.unknownTables, ...plan.unusableTables].join(', '),
    message: `Imported ${total === 1 ? '1 row' : `${total} rows`}.`,
    failure: null,
    notes,
  };
}

/**
 * What the import did and what it had to accommodate, one line each. Reported
 * per table rather than per row: a backup with a dropped column has it dropped
 * on every row, and saying so 200 times is saying nothing.
 *
 * @param {import('./backup.js').ImportPlan} plan
 * @param {Map<string, number>} inserted
 * @returns {string[]}
 */
function report(plan, inserted) {
  const lines = [];
  for (const table of plan.attempted) {
    const landed = inserted.get(table.name) || 0;
    const already = table.rows - landed;
    lines.push(
      `${table.name}: ${landed} of ${table.rows} rows inserted`
      + (already > 0 ? `, ${already} already there` : ''),
    );
  }
  for (const { table, columns } of plan.droppedColumns) {
    lines.push(`${table}: dropped ${columns.join(', ')} — the schema no longer has ${columns.length === 1 ? 'that column' : 'those columns'}.`);
  }
  for (const { table, columns } of plan.missingColumns) {
    lines.push(`${table}: ${columns.join(', ')} ${columns.length === 1 ? 'is' : 'are'} new since this backup and took the default.`);
  }
  for (const name of plan.unknownTables) {
    lines.push(`${name}: skipped — this database has no such table.`);
  }
  for (const name of plan.unusableTables) {
    lines.push(`${name}: skipped — not one of its columns still exists.`);
  }
  return lines;
}
