// The half of the migration machinery that has logic in it, and therefore the
// half CI can reach. Strings in, values out: nothing here knows what D1 is.
//
// The split exists because `node --test` cannot import a .sql file -- a text
// import is a bundler feature and there is no bundler in CI. So every decision
// lives here and takes its SQL as an argument, and worker/db/migrations.js is
// the one module that turns files into strings and holds nothing worth testing.

/**
 * Splits a SQL file into executable statements on semicolons, ignoring the ones
 * inside quotes and comments. Comments are dropped; empty statements are
 * dropped; a missing final semicolon is fine.
 *
 * Handles single-quoted strings with the `''` escape, double-quoted identifiers
 * with the `""` escape, `--` to end of line, and `/* *\/` across lines.
 *
 * Deliberately not supported: `BEGIN ... END` bodies, i.e. triggers. Handling
 * them means parsing SQL rather than scanning it. What makes that safe is a
 * rule rather than a hope -- no schema file here contains a trigger -- and the
 * failure mode if one ever does is a loud syntax error on the admin page, not a
 * silently truncated body.
 *
 * @param {string} sql
 * @returns {string[]}
 */
export function splitStatements(sql) {
  /** @type {string[]} */
  const statements = [];
  let buf = '';
  let i = 0;

  const flush = () => {
    const trimmed = buf.trim();
    if (trimmed) statements.push(trimmed);
    buf = '';
  };

  while (i < sql.length) {
    const c = sql[i];
    const next = sql[i + 1];

    if (c === '-' && next === '-') {
      while (i < sql.length && sql[i] !== '\n') i++;
      // The newline is left for the next pass, so line breaks survive a comment
      // and the statement text still reads the way the file does.
      continue;
    }

    if (c === '/' && next === '*') {
      i += 2;
      while (i < sql.length && !(sql[i] === '*' && sql[i + 1] === '/')) i++;
      i += 2;
      // A block comment can sit between two tokens with no other whitespace.
      buf += ' ';
      continue;
    }

    if (c === "'" || c === '"') {
      buf += c;
      i++;
      while (i < sql.length) {
        if (sql[i] === c) {
          if (sql[i + 1] === c) { buf += c + c; i += 2; continue; }
          buf += c;
          i++;
          break;
        }
        buf += sql[i];
        i++;
      }
      continue;
    }

    if (c === ';') { flush(); i++; continue; }

    buf += c;
    i++;
  }

  flush();
  return statements;
}

/**
 * SHA-256 of a migration file, hex encoded, over its exact bytes. No whitespace
 * normalisation: a reformat *is* a change, and a drift check that forgives
 * formatting is one that misses a moved semicolon.
 *
 * `crypto.subtle` is a global in both workerd and Node 22, which is the whole
 * reason this is testable.
 *
 * @param {string} text
 * @returns {Promise<string>}
 */
export async function sha256Hex(text) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * @typedef {{ name: string, checksum: string, applied_at: number }} LedgerRow
 * @typedef {{ name: string, checksum: string }} MigrationRef
 * @typedef {'applied' | 'pending' | 'drifted'} MigrationState
 * @typedef {{
 *   name: string,
 *   state: MigrationState,
 *   fileChecksum: string,
 *   ledgerChecksum: string | null,
 *   appliedAt: number | null,
 * }} PlanEntry
 */

/**
 * Classifies every migration against the ledger, in MIGRATIONS order.
 *
 * | state   | meaning                                 |
 * |---------|-----------------------------------------|
 * | applied | ledger row exists, checksum matches     |
 * | pending | no ledger row                           |
 * | drifted | ledger row exists, checksum differs     |
 *
 * Plus two conditions that are none of those and must not be silent:
 *
 * - **orphans** -- a ledger row naming a migration that is no longer in the
 *   list. A deleted migration is drift of a different kind.
 * - **outOfOrder** -- a pending migration ordered *before* one that has already
 *   run, which means the files were edited under a live database. Applying
 *   forward would produce a schema no fresh database would ever have, so Apply
 *   pending refuses rather than obliging.
 *
 * @param {LedgerRow[]} ledgerRows
 * @param {MigrationRef[]} migrations
 */
export function planFor(ledgerRows, migrations) {
  const ledger = new Map(ledgerRows.map((row) => [row.name, row]));

  /** @type {PlanEntry[]} */
  const entries = migrations.map((migration) => {
    const row = ledger.get(migration.name);
    const state = !row
      ? 'pending'
      : row.checksum === migration.checksum ? 'applied' : 'drifted';
    return {
      name: migration.name,
      state,
      fileChecksum: migration.checksum,
      ledgerChecksum: row ? row.checksum : null,
      appliedAt: row ? row.applied_at : null,
    };
  });

  const known = new Set(migrations.map((migration) => migration.name));
  const orphans = ledgerRows.filter((row) => !known.has(row.name));

  // The last position that has been through the database at all. Anything
  // pending before it is a file inserted underneath history.
  let lastRun = -1;
  entries.forEach((entry, index) => { if (entry.state !== 'pending') lastRun = index; });

  const names = (state) => entries.filter((e) => e.state === state).map((e) => e.name);
  const outOfOrder = entries
    .filter((entry, index) => entry.state === 'pending' && index < lastRun)
    .map((entry) => entry.name);

  return {
    entries,
    pending: names('pending'),
    drifted: names('drifted'),
    orphans,
    outOfOrder,
    /** Nothing surprising: no drift, no orphan ledger rows, no reordering. */
    clean: names('drifted').length === 0 && orphans.length === 0 && outOfOrder.length === 0,
  };
}
