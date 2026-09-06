// Everything that touches D1. No logic worth testing lives here -- that is
// plan.js -- and none of this can run in CI, so it is kept as thin as the job
// allows and its behaviour is checked in a browser against a deployment.

import { splitStatements, sha256Hex, planFor } from './plan.js';

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
 * @param {D1Database} db
 * @param {string[]} statements
 * @returns {Promise<{ statement: string, error: string } | null>}
 */
async function locateFailure(db, statements) {
  for (const statement of statements) {
    try {
      await db.prepare(statement).run();
    } catch (err) {
      return { statement, error: String(err && err.message ? err.message : err) };
    }
  }
  return null;
}

/**
 * @typedef {{
 *   ok: boolean,
 *   ran: string[],
 *   skipped: string,
 *   message: string,
 *   failure: { name: string, statement: string | null, error: string } | null,
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
      const error = String(err && err.message ? err.message : err);
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
      const error = String(err && err.message ? err.message : err);
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
