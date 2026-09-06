// The migration machinery's decisions, all of which live in plan.js so that
// this file can reach them. Nothing here touches D1; there is no way to, and
// worker/db/apply.js is deliberately thin because of it.

import test from 'node:test';
import assert from 'node:assert/strict';

import { splitStatements, sha256Hex, planFor } from '../worker/db/plan.js';

// --- the splitter -----------------------------------------------------------
//
// The one piece here whose bugs produce a *wrong* schema rather than a visible
// failure, so it gets the most tests.

test('splits on semicolons and trims', () => {
  assert.deepEqual(splitStatements('SELECT 1; SELECT 2;'), ['SELECT 1', 'SELECT 2']);
});

test('a missing final semicolon still yields the last statement', () => {
  assert.deepEqual(splitStatements('SELECT 1; SELECT 2'), ['SELECT 1', 'SELECT 2']);
});

test('empty statements are dropped', () => {
  assert.deepEqual(splitStatements(';;\n;  ;SELECT 1;;'), ['SELECT 1']);
  assert.deepEqual(splitStatements(''), []);
  assert.deepEqual(splitStatements('   \n\t '), []);
});

test('a semicolon inside a single-quoted string does not split', () => {
  assert.deepEqual(
    splitStatements("INSERT INTO t VALUES ('a;b'); SELECT 1;"),
    ["INSERT INTO t VALUES ('a;b')", 'SELECT 1'],
  );
});

test("the '' escape does not end the string", () => {
  assert.deepEqual(
    splitStatements("INSERT INTO t VALUES ('it''s; fine'); SELECT 1;"),
    ["INSERT INTO t VALUES ('it''s; fine')", 'SELECT 1'],
  );
});

test('a semicolon inside a double-quoted identifier does not split', () => {
  assert.deepEqual(
    splitStatements('CREATE TABLE "odd;name" (a); SELECT 1;'),
    ['CREATE TABLE "odd;name" (a)', 'SELECT 1'],
  );
});

test('a line comment runs to the end of the line and is dropped', () => {
  assert.deepEqual(
    splitStatements('SELECT 1; -- a; comment\nSELECT 2;'),
    ['SELECT 1', 'SELECT 2'],
  );
});

test('a line comment with no trailing newline is dropped', () => {
  assert.deepEqual(splitStatements('SELECT 1; -- trailing'), ['SELECT 1']);
});

test('a block comment spanning lines, with semicolons and quotes in it, is dropped', () => {
  assert.deepEqual(
    splitStatements("SELECT 1; /* a;\n   'quoted;' thing */ SELECT 2;"),
    ['SELECT 1', 'SELECT 2'],
  );
});

test('a block comment between two tokens leaves them separated', () => {
  assert.deepEqual(splitStatements('SELECT/**/1;'), ['SELECT 1']);
});

test('comment markers inside a string are text, not comments', () => {
  assert.deepEqual(
    splitStatements("INSERT INTO t VALUES ('-- not a comment; /* nor this */');"),
    ["INSERT INTO t VALUES ('-- not a comment; /* nor this */')"],
  );
});

test('input that is only comments yields nothing', () => {
  assert.deepEqual(splitStatements('-- one\n/* two\n   three */\n'), []);
});

test('newlines inside a statement survive, so the text reads as the file does', () => {
  assert.deepEqual(
    splitStatements('CREATE TABLE t (\n  a INTEGER\n);'),
    ['CREATE TABLE t (\n  a INTEGER\n)'],
  );
});

// --- checksums --------------------------------------------------------------

test('a checksum is stable for identical input', async () => {
  assert.equal(await sha256Hex('CREATE TABLE t (a);'), await sha256Hex('CREATE TABLE t (a);'));
});

test('a checksum is 64 hex characters', async () => {
  assert.match(await sha256Hex('anything'), /^[0-9a-f]{64}$/);
});

test('a one-byte change changes the checksum', async () => {
  assert.notEqual(await sha256Hex('CREATE TABLE t (a);'), await sha256Hex('CREATE TABLE t (b);'));
});

// No whitespace normalisation: a reformat *is* a change, and a drift check that
// forgives formatting is one that misses a moved semicolon.
test('a whitespace-only change changes the checksum', async () => {
  assert.notEqual(await sha256Hex('CREATE TABLE t (a);'), await sha256Hex('CREATE TABLE  t (a);'));
  assert.notEqual(await sha256Hex('SELECT 1;'), await sha256Hex('SELECT 1;\n'));
});

// --- the plan ---------------------------------------------------------------

const ref = (name, checksum) => ({ name, checksum });
const row = (name, checksum, applied_at = 1000) => ({ name, checksum, applied_at });

test('classifies applied, pending and drifted, in MIGRATIONS order', () => {
  const plan = planFor(
    [row('001.sql', 'aaa'), row('002.sql', 'stale')],
    [ref('001.sql', 'aaa'), ref('002.sql', 'bbb'), ref('003.sql', 'ccc')],
  );

  assert.deepEqual(plan.entries.map((e) => e.name), ['001.sql', '002.sql', '003.sql']);
  assert.deepEqual(plan.entries.map((e) => e.state), ['applied', 'drifted', 'pending']);
  assert.deepEqual(plan.pending, ['003.sql']);
  assert.deepEqual(plan.drifted, ['002.sql']);
  assert.equal(plan.clean, false);
});

test('a drifted entry carries both checksums, which is what the page prints', () => {
  const plan = planFor([row('001.sql', 'ledgerside')], [ref('001.sql', 'fileside')]);
  const entry = plan.entries[0];
  assert.equal(entry.state, 'drifted');
  assert.equal(entry.fileChecksum, 'fileside');
  assert.equal(entry.ledgerChecksum, 'ledgerside');
});

test('a pending entry has no ledger checksum and no applied time', () => {
  const [entry] = planFor([], [ref('001.sql', 'aaa')]).entries;
  assert.equal(entry.state, 'pending');
  assert.equal(entry.ledgerChecksum, null);
  assert.equal(entry.appliedAt, null);
});

test('an empty ledger against every migration is clean and all pending', () => {
  const plan = planFor([], [ref('001.sql', 'aaa'), ref('002.sql', 'bbb')]);
  assert.deepEqual(plan.pending, ['001.sql', '002.sql']);
  assert.equal(plan.clean, true);
});

// A deleted migration is drift of a different kind: the database carries a
// schema change nothing in the repo describes. It must not be silent.
test('a ledger row no longer in MIGRATIONS is reported as an orphan', () => {
  const plan = planFor([row('001.sql', 'aaa'), row('002.sql', 'bbb')], [ref('001.sql', 'aaa')]);
  assert.deepEqual(plan.orphans.map((o) => o.name), ['002.sql']);
  assert.equal(plan.clean, false);
});

// A file inserted underneath history. Applying forward would build a schema no
// fresh database would ever have, so Apply pending refuses.
test('a pending migration ordered before an applied one is reported', () => {
  const plan = planFor([row('002.sql', 'bbb')], [ref('001.sql', 'aaa'), ref('002.sql', 'bbb')]);
  assert.deepEqual(plan.outOfOrder, ['001.sql']);
  assert.equal(plan.clean, false);
});

test('a pending migration before a drifted one counts as out of order too', () => {
  const plan = planFor([row('002.sql', 'stale')], [ref('001.sql', 'aaa'), ref('002.sql', 'bbb')]);
  assert.deepEqual(plan.outOfOrder, ['001.sql']);
});

test('pending migrations after every applied one are not out of order', () => {
  const plan = planFor(
    [row('001.sql', 'aaa')],
    [ref('001.sql', 'aaa'), ref('002.sql', 'bbb'), ref('003.sql', 'ccc')],
  );
  assert.deepEqual(plan.outOfOrder, []);
  assert.equal(plan.clean, true);
});

test('an all-applied ledger is clean with nothing pending', () => {
  const plan = planFor([row('001.sql', 'aaa')], [ref('001.sql', 'aaa')]);
  assert.deepEqual(plan.pending, []);
  assert.equal(plan.clean, true);
});
