// The .sql files themselves, read from disk with node:fs. Reading is not
// importing — a text import needs a bundler and there is none in CI — and two
// naming conventions are what make it possible without importing
// worker/db/migrations.js: migrations are NNN_*.sql, seeds are seed_*.sql.
//
// Everything asserted here is a rule the runner cannot check at run time. A
// seed file that is not re-runnable, or a migration statement that is not
// idempotent, is a bug that only shows up as a broken database.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import { splitStatements } from '../worker/db/plan.js';

const DB_DIR = fileURLToPath(new URL('../worker/db/', import.meta.url));
const SQL_DIR = path.join(DB_DIR, 'sql');

const sqlFiles = readdirSync(SQL_DIR).filter((name) => name.endsWith('.sql')).sort();
const read = (name) => readFileSync(path.join(SQL_DIR, name), 'utf8');
const migrationFiles = sqlFiles.filter((name) => /^\d{3}_.+\.sql$/.test(name));
const seedFiles = sqlFiles.filter((name) => /^seed_.+\.sql$/.test(name));

// migrations.js is read as text rather than imported: importing it means
// importing SQL, which is the one thing node cannot do here.
const migrationsSrc = readFileSync(path.join(DB_DIR, 'migrations.js'), 'utf8');
const listed = (constName) => {
  const start = migrationsSrc.indexOf(`export const ${constName}`);
  assert.notEqual(start, -1, `migrations.js does not export ${constName}`);
  const rest = migrationsSrc.slice(start);
  const end = rest.indexOf('];');
  return [...rest.slice(0, end).matchAll(/name:\s*'([^']+)'/g)].map((m) => m[1]);
};

const normalise = (statement) => statement.replace(/\s+/g, ' ').trim().toUpperCase();

test('there is at least one migration and one seed to check', () => {
  assert.ok(migrationFiles.length > 0, 'no NNN_*.sql under worker/db/sql/');
  assert.ok(seedFiles.length > 0, 'no seed_*.sql under worker/db/sql/');
});

// A .sql file nobody imports looks applied and is not.
test('every .sql file on disk is named in migrations.js', () => {
  for (const name of sqlFiles) {
    assert.ok(migrationsSrc.includes(name), `${name} is not named in migrations.js`);
  }
});

test('every file named in migrations.js exists, in the right list', () => {
  assert.deepEqual(listed('MIGRATIONS'), migrationFiles);
  assert.deepEqual(listed('SEEDS'), seedFiles);
});

// MIGRATIONS order is the apply order, and planFor's out-of-order check reads
// it as history. A list that is not in filename order makes that check lie.
test('MIGRATIONS is in filename order', () => {
  const names = listed('MIGRATIONS');
  assert.deepEqual(names, [...names].sort());
});

test('every file has a name only one convention matches', () => {
  for (const name of sqlFiles) {
    const isMigration = migrationFiles.includes(name);
    const isSeed = seedFiles.includes(name);
    assert.ok(isMigration !== isSeed, `${name} is neither NNN_*.sql nor seed_*.sql, or is both`);
  }
});

// The rule that makes Run seed safe to press twice, and the one the runner
// cannot detect at run time: an UPDATE in a seed file silently overwrites a
// screen name every time anyone presses the button.
test('every seed statement is an INSERT ending ON CONFLICT DO NOTHING', () => {
  for (const name of seedFiles) {
    const statements = splitStatements(read(name));
    assert.ok(statements.length > 0, `${name} has no statements`);
    for (const statement of statements) {
      const sql = normalise(statement);
      assert.ok(sql.startsWith('INSERT INTO '), `${name}: not an INSERT — ${sql.slice(0, 60)}`);
      assert.ok(
        sql.endsWith('ON CONFLICT DO NOTHING'),
        `${name}: does not end ON CONFLICT DO NOTHING — ${sql.slice(-60)}`,
      );
    }
  }
});

// The rule that makes worker/db/apply.js's locateFailure safe. After a failed
// batch D1 has rolled everything back and the statements are re-run one at a
// time to name the one that broke; that is only survivable if re-running a
// statement that already succeeded is a no-op.
test('every migration statement is idempotent', () => {
  const allowed = [
    /^CREATE TABLE IF NOT EXISTS /,
    /^CREATE INDEX IF NOT EXISTS /,
    /^CREATE UNIQUE INDEX IF NOT EXISTS /,
    /^CREATE VIEW IF NOT EXISTS /,
    /^INSERT INTO .* ON CONFLICT DO NOTHING$/,
  ];
  for (const name of migrationFiles) {
    const statements = splitStatements(read(name));
    assert.ok(statements.length > 0, `${name} has no statements`);
    for (const statement of statements) {
      const sql = normalise(statement);
      assert.ok(
        allowed.some((pattern) => pattern.test(sql)),
        `${name}: not idempotent — ${sql.slice(0, 70)}`,
      );
    }
  }
});

// ALTER is not on the allowed list above, and that is deliberate rather than an
// omission: clear-and-rebuild is this project's schema-change path, so an ALTER
// chain would be a second one nobody maintains.
test('no migration alters or drops anything', () => {
  for (const name of migrationFiles) {
    for (const statement of splitStatements(read(name))) {
      const sql = normalise(statement);
      assert.ok(!sql.startsWith('ALTER '), `${name}: ALTER — edit the schema and rebuild instead`);
      assert.ok(!sql.startsWith('DROP '), `${name}: DROP — erase is the admin page's job`);
    }
  }
});

// The splitter does not parse BEGIN ... END bodies (worker/db/plan.js). What
// makes that safe is this rule rather than a hope.
test('no .sql file defines a trigger', () => {
  for (const name of sqlFiles) {
    assert.ok(!/\bCREATE\s+TRIGGER\b/i.test(read(name)), `${name} defines a trigger`);
  }
});

// The export orders rows by rowid so that identical data produces identical
// bytes, which is what the erase fingerprint compares
// (worker/db/backup.js). A WITHOUT ROWID table has no rowid to order by, and
// the day one appears that stops being true silently.
test('no migration declares a WITHOUT ROWID table', () => {
  for (const name of migrationFiles) {
    assert.ok(!/\bWITHOUT\s+ROWID\b/i.test(read(name)), `${name}: WITHOUT ROWID`);
  }
});

// The ledger is created by the file it records. There is no bootstrap path and
// no zeroth migration, so the first migration has to carry it.
test('the first migration creates the ledger table', () => {
  const first = read(migrationFiles[0]);
  assert.match(first, /CREATE TABLE IF NOT EXISTS _migrations\b/);
});

// The tables the rest of Phase 2 and Phase 3 read. Named here so deleting one
// while rewriting the schema is a failed test rather than a broken page.
test('the schema creates players, plays and play_results', () => {
  const schema = migrationFiles.map(read).join('\n');
  for (const table of ['players', 'plays', 'play_results']) {
    assert.match(schema, new RegExp(`CREATE TABLE IF NOT EXISTS ${table}\\b`), `no ${table} table`);
  }
});

// Seeded ids are permanent: everything keys on them and nothing shows them, so
// a duplicate in the file is a row that silently never appears.
test('seeded player ids are unique across the seed files', () => {
  const seen = new Set();
  for (const name of seedFiles) {
    for (const statement of splitStatements(read(name))) {
      const match = statement.match(/VALUES\s*\(\s*'([^']+)'/i);
      if (!match) continue;
      assert.ok(!seen.has(match[1]), `${name}: duplicate seeded id '${match[1]}'`);
      seen.add(match[1]);
    }
  }
});
