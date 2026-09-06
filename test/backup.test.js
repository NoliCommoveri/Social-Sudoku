// The export document, its fingerprint, and the import plan — everything in
// Session B that decides anything. worker/db/apply.js does the D1 half and has
// no test, because there is no D1 in CI and faking one would test the fake;
// questions.md S7 is where that half is checked.

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  EXPORT_FORMAT,
  EXPORT_VERSION,
  buildExport,
  chunkStatements,
  fingerprintOf,
  isInternalTable,
  parseBackup,
  planImport,
  quoteIdent,
  schemaDrift,
  serializeExport,
} from '../worker/db/backup.js';

const players = {
  name: 'players',
  columns: ['id', 'screen_name', 'avatar'],
  rows: [
    { id: 'p1', screen_name: 'Twelve', avatar: 'dragon' },
    { id: 'p2', screen_name: 'Eleven', avatar: 'rocket' },
  ],
};

const doc = (over = {}) => buildExport({ schema: [], tables: [players], exportedAt: 1, ...over });
const live = { players: ['id', 'screen_name', 'avatar'] };

// --- 1. the document --------------------------------------------------------

test('the document carries its format, version and timestamp', () => {
  const d = doc({ exportedAt: 1757000000000 });
  assert.equal(d.format, EXPORT_FORMAT);
  assert.equal(d.version, EXPORT_VERSION);
  assert.equal(d.exported_at, 1757000000000);
});

test('rows are rebuilt in column order, and only from the columns', () => {
  const d = buildExport({
    tables: [{ name: 't', columns: ['b', 'a'], rows: [{ a: 1, b: 2, stray: 3 }] }],
    exportedAt: 1,
  });
  assert.deepEqual(Object.keys(d.tables[0].rows[0]), ['b', 'a']);
  assert.equal('stray' in d.tables[0].rows[0], false);
});

test('a column a row does not have becomes null, and a boolean becomes 0 or 1', () => {
  const d = buildExport({
    tables: [{ name: 't', columns: ['a', 'b'], rows: [{ b: true }, { a: 1, b: false }] }],
    exportedAt: 1,
  });
  assert.deepEqual(d.tables[0].rows, [{ a: null, b: 1 }, { a: 1, b: 0 }]);
});

test('an empty database is a document with no tables, not an error', () => {
  const d = buildExport({ exportedAt: 1 });
  assert.deepEqual(d.tables, []);
  assert.deepEqual(d.schema, []);
});

// The ledger is rebuilt by Apply pending; restoring it would claim files had
// been applied that may no longer read the same way.
test('the schema block carries the ledger and tables never does', () => {
  const d = buildExport({
    schema: [{ name: '001_schema.sql', checksum: 'abc', applied_at: 5 }],
    tables: [players],
    exportedAt: 1,
  });
  assert.deepEqual(d.schema, [{ name: '001_schema.sql', checksum: 'abc', applied_at: 5 }]);
  assert.deepEqual(d.tables.map((t) => t.name), ['players']);
});

test("SQLite's tables and D1's are recognised as not ours", () => {
  for (const name of ['sqlite_sequence', 'sqlite_stat1', '_cf_KV', 'd1_migrations']) {
    assert.equal(isInternalTable(name), true, name);
  }
  for (const name of ['players', 'plays', 'play_results', '_migrations']) {
    assert.equal(isInternalTable(name), false, name);
  }
});

test('identifiers are quoted and embedded quotes doubled', () => {
  assert.equal(quoteIdent('players'), '"players"');
  assert.equal(quoteIdent('we"ird'), '"we""ird"');
});

// --- 2. determinism and the fingerprint -------------------------------------

test('identical data serialises to identical bytes', () => {
  assert.equal(serializeExport(doc()), serializeExport(doc()));
});

test('the serialised file ends in a newline', () => {
  assert.ok(serializeExport(doc()).endsWith('\n'));
});

test('the fingerprint ignores exported_at', async () => {
  const a = await fingerprintOf(doc({ exportedAt: 1 }));
  const b = await fingerprintOf(doc({ exportedAt: 999999 }));
  assert.equal(a, b);
});

test('one character of one row changes the fingerprint', async () => {
  const changed = buildExport({
    tables: [{ ...players, rows: [{ ...players.rows[0], screen_name: 'Twelvf' }, players.rows[1]] }],
    exportedAt: 1,
  });
  assert.notEqual(await fingerprintOf(doc()), await fingerprintOf(changed));
});

test('a row added, removed or reordered changes the fingerprint', async () => {
  const base = await fingerprintOf(doc());
  const added = buildExport({
    tables: [{ ...players, rows: [...players.rows, { id: 'p3', screen_name: 'Five', avatar: 'cat' }] }],
    exportedAt: 1,
  });
  const removed = buildExport({ tables: [{ ...players, rows: [players.rows[0]] }], exportedAt: 1 });
  const reordered = buildExport({ tables: [{ ...players, rows: [...players.rows].reverse() }], exportedAt: 1 });
  for (const other of [added, removed, reordered]) {
    assert.notEqual(base, await fingerprintOf(other));
  }
});

// Pressing Apply pending between the download and the confirm changes the
// database, and the erase must refuse on it like any other change.
test('the applied migrations are part of the fingerprint', async () => {
  const withLedger = doc({ schema: [{ name: '001_schema.sql', checksum: 'abc', applied_at: 5 }] });
  assert.notEqual(await fingerprintOf(doc()), await fingerprintOf(withLedger));
});

// --- 3. the import plan, happy path -----------------------------------------

test('every statement is INSERT OR IGNORE, one per row, values bound in column order', () => {
  const plan = planImport(doc(), live);
  assert.equal(plan.statements.length, 2);
  assert.equal(
    plan.statements[0].sql,
    'INSERT OR IGNORE INTO "players" ("id", "screen_name", "avatar") VALUES (?1, ?2, ?3)',
  );
  assert.deepEqual(plan.statements[0].params, ['p1', 'Twelve', 'dragon']);
  assert.deepEqual(plan.statements[1].params, ['p2', 'Eleven', 'rocket']);
  assert.deepEqual(plan.attempted, [{ name: 'players', rows: 2 }]);
});

// Creation order is a valid foreign-key insert order — a table cannot
// reference one that did not exist when it was created — and the export writes
// tables in creation order. play_results must land after what it references.
test('tables keep the order the file lists them in', () => {
  const d = buildExport({
    tables: [
      players,
      { name: 'plays', columns: ['id'], rows: [{ id: 'g1' }] },
      { name: 'play_results', columns: ['play_id', 'player_id'], rows: [{ play_id: 'g1', player_id: 'p1' }] },
    ],
    exportedAt: 1,
  });
  const plan = planImport(d, { ...live, plays: ['id'], play_results: ['play_id', 'player_id'] });
  assert.deepEqual(plan.statements.map((s) => s.table), ['players', 'players', 'plays', 'play_results']);
});

test('a table with no rows produces no statements and is still reported', () => {
  const d = buildExport({ tables: [{ name: 'players', columns: ['id'], rows: [] }], exportedAt: 1 });
  const plan = planImport(d, live);
  assert.deepEqual(plan.statements, []);
  assert.deepEqual(plan.attempted, [{ name: 'players', rows: 0 }]);
});

test('the live schema may be a Map as well as an object', () => {
  const plan = planImport(doc(), new Map(Object.entries(live)));
  assert.equal(plan.statements.length, 2);
});

// --- 4. the import plan, tolerance ------------------------------------------
//
// The case that actually happens: the reason anybody erased is that the schema
// changed, so the backup in hand describes a slightly different database.

test('a table the schema no longer has is skipped, and the rest still import', () => {
  const d = buildExport({
    tables: [{ name: 'gone', columns: ['id'], rows: [{ id: 1 }] }, players],
    exportedAt: 1,
  });
  const plan = planImport(d, live);
  assert.deepEqual(plan.unknownTables, ['gone']);
  assert.equal(plan.statements.length, 2);
  assert.deepEqual(plan.statements.map((s) => s.table), ['players', 'players']);
});

test('a column the schema no longer has is dropped from the insert and named once', () => {
  const d = buildExport({
    tables: [{ name: 'players', columns: ['id', 'nickname'], rows: [{ id: 'p1', nickname: 'x' }, { id: 'p2', nickname: 'y' }] }],
    exportedAt: 1,
  });
  const plan = planImport(d, live);
  assert.deepEqual(plan.droppedColumns, [{ table: 'players', columns: ['nickname'] }]);
  assert.equal(plan.statements[0].sql, 'INSERT OR IGNORE INTO "players" ("id") VALUES (?1)');
  assert.equal(plan.statements.length, 2);
});

test('a column new since the backup is left to its default and named once', () => {
  const d = buildExport({ tables: [{ name: 'players', columns: ['id'], rows: [{ id: 'p1' }] }], exportedAt: 1 });
  const plan = planImport(d, { players: ['id', 'screen_name', 'avatar'] });
  assert.deepEqual(plan.missingColumns, [{ table: 'players', columns: ['screen_name', 'avatar'] }]);
  assert.equal(plan.statements[0].sql, 'INSERT OR IGNORE INTO "players" ("id") VALUES (?1)');
});

test('a table with rows but not one surviving column is skipped, not half-inserted', () => {
  const d = buildExport({ tables: [{ name: 'players', columns: ['gone'], rows: [{ gone: 1 }] }], exportedAt: 1 });
  const plan = planImport(d, live);
  assert.deepEqual(plan.unusableTables, ['players']);
  assert.deepEqual(plan.statements, []);
});

test('accommodations are reported per table, not per row', () => {
  const rows = Array.from({ length: 40 }, (_, i) => ({ id: `p${i}`, nickname: 'x' }));
  const d = buildExport({ tables: [{ name: 'players', columns: ['id', 'nickname'], rows }], exportedAt: 1 });
  const plan = planImport(d, live);
  assert.equal(plan.droppedColumns.length, 1);
  assert.equal(plan.statements.length, 40);
});

// --- 5. reading a file that is wrong ----------------------------------------

test('a good file parses', () => {
  const parsed = parseBackup(serializeExport(doc()));
  assert.equal(parsed.ok, true);
  assert.deepEqual(parsed.doc.tables[0].rows[0], players.rows[0]);
});

test('every rejection names what is wrong with the file', () => {
  const cases = [
    ['{not json', /not JSON/],
    ['[]', /not an object/],
    ['"a string"', /not an object/],
    [JSON.stringify({ format: 'something-else', version: 1, tables: [] }), /not a gameroom backup/],
    [JSON.stringify({ format: EXPORT_FORMAT, version: 2, tables: [] }), /version 2/],
    [JSON.stringify({ format: EXPORT_FORMAT, version: 1 }), /no list of tables/],
    [JSON.stringify({ format: EXPORT_FORMAT, version: 1, tables: {} }), /no list of tables/],
    [JSON.stringify({ format: EXPORT_FORMAT, version: 1, tables: [{ columns: [], rows: [] }] }), /no name/],
    [JSON.stringify({ format: EXPORT_FORMAT, version: 1, tables: [{ name: 't', rows: [] }] }), /no usable list of columns/],
    [JSON.stringify({ format: EXPORT_FORMAT, version: 1, tables: [{ name: 't', columns: ['a'] }] }), /no list of rows/],
    [JSON.stringify({ format: EXPORT_FORMAT, version: 1, tables: [{ name: 't', columns: [], rows: [{}] }] }), /names no columns/],
    [JSON.stringify({ format: EXPORT_FORMAT, version: 1, tables: [{ name: 't', columns: ['a'], rows: ['nope'] }] }), /not an object/],
    [JSON.stringify({ format: EXPORT_FORMAT, version: 1, tables: [{ name: 't', columns: ['a'], rows: [{ a: { deep: 1 } }] }] }), /not something a database column holds/],
    [JSON.stringify({ format: EXPORT_FORMAT, version: 1, schema: 'no', tables: [] }), /schema that is not a list/],
  ];
  for (const [text, pattern] of cases) {
    const parsed = parseBackup(text);
    assert.equal(parsed.ok, false, `should have been refused: ${text.slice(0, 40)}`);
    assert.match(parsed.error, pattern);
  }
});

test('null values and a missing schema block are fine', () => {
  const parsed = parseBackup(JSON.stringify({
    format: EXPORT_FORMAT,
    version: EXPORT_VERSION,
    tables: [{ name: 'players', columns: ['id', 'avatar'], rows: [{ id: 'p1', avatar: null }] }],
  }));
  assert.equal(parsed.ok, true);
  assert.deepEqual(parsed.doc.schema, []);
});

// --- 6. chunking ------------------------------------------------------------

test('statements chunk at the boundary and the last chunk is never empty', () => {
  const items = Array.from({ length: 101 }, (_, i) => i);
  assert.deepEqual(chunkStatements(items, 50).map((c) => c.length), [50, 50, 1]);
  assert.deepEqual(chunkStatements(items.slice(0, 100), 50).map((c) => c.length), [50, 50]);
  assert.deepEqual(chunkStatements(items.slice(0, 49), 50).map((c) => c.length), [49]);
  assert.deepEqual(chunkStatements([], 50), []);
});

test('chunking preserves order', () => {
  const items = Array.from({ length: 7 }, (_, i) => i);
  assert.deepEqual(chunkStatements(items, 3).flat(), items);
});

// --- 7. the schema warning --------------------------------------------------

test('a backup taken against the same migrations warns about nothing', () => {
  const applied = [{ name: '001_schema.sql', checksum: 'abcdef0123456789', applied_at: 5 }];
  assert.equal(schemaDrift(doc({ schema: applied }), applied), null);
});

test('a backup taken against a different schema warns and does not refuse', () => {
  const then = [{ name: '001_schema.sql', checksum: 'aaaaaaaaaaaaaaaa', applied_at: 5 }];
  const now = [{ name: '001_schema.sql', checksum: 'bbbbbbbbbbbbbbbb', applied_at: 9 }];
  const warning = schemaDrift(doc({ schema: then }), now);
  assert.match(warning, /aaaaaaaaaaaa/);
  assert.match(warning, /bbbbbbbbbbbb/);
  assert.match(warning, /Importing anyway/);
});

test('a backup from before any migration ran warns rather than looking identical', () => {
  const now = [{ name: '001_schema.sql', checksum: 'abc', applied_at: 9 }];
  assert.match(schemaDrift(doc({ schema: [] }), now), /nothing/);
});
