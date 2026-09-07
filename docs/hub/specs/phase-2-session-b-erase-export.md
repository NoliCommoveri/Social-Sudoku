# Phase 2 Session B — Erase, export, re-import

The third admin button, the JSON export that is its precondition, and the
re-import that makes the export worth taking. `../../../ROADMAP.md` Phase 2.

**Estimated cost:** Medium, ~45k. The roadmap called it Small–Medium at ~30k;
written out it lands above that, and the reason is §6 — importing into a
*changed* schema is the normal case, not the exceptional one, and tolerating
that is a third of the code. Nothing here is cuttable (§1), so the number moves
rather than the scope.

**Blocked on:** nothing. It adds no binding and no secret.

**Blocks:** Phase 3, the first phase that writes a row anyone would miss. It is
also the only way back to a clean database without deleting the D1 database in
the dashboard, which is what makes a schema change a browser action. **S7** is
the check.

---

## 1. Why these three are one session

`CLAUDE.md` makes the export a hard precondition for erase and requires
re-import alongside it, wired into the erase confirmation itself. That forbids
the obvious cuts:

- **Erase without export** is the button that loses the play record.
- **Export without import** is a file nobody can put back, which is not a
  backup. It is a file.

So the three ship together or not at all, and the only cut available was the one
already taken: Session A shipped **Apply pending** and **Run seed** and rendered
no erase button at all — not a disabled one, because a greyed-out button is a
promise.

The play record is empty today. That is what makes this session cheap and is
exactly why it happens now: the same work after Phase 3 is done under real data,
with a first erase that has something to lose.

## 2. Files

```
worker/
  admin.js       gains the danger panel, the confirmation page, the import form
  db/
    backup.js    NEW. Pure: the export document, its fingerprint, the import plan
    apply.js     gains exportAll(), eraseAll(), importAll() -- the D1 halves
test/
  backup.test.js NEW
  sql-files.test.js  gains the WITHOUT ROWID assertion (§4)
```

No new SQL file, no schema change, no binding, and **no line under `public/`**.
`wrangler.jsonc` is untouched.

`backup.js` exists for the same reason `plan.js` does: `node --test` cannot
import a `.sql` file and cannot reach D1, so everything with a decision in it
takes plain values as arguments and lives in a module CI can import. `apply.js`
keeps its stated role — everything that touches D1, and nothing worth testing.

## 3. The export document

```jsonc
{
  "format": "carson-gameroom-export",
  "version": 1,
  "exported_at": 1757168400000,
  "schema": [ { "name": "001_schema.sql", "checksum": "9f2c…", "applied_at": … } ],
  "tables": [
    { "name": "players", "columns": ["id", "screen_name", …], "rows": [ { "id": "p1", … } ] },
    { "name": "plays", … },
    { "name": "play_results", … }
  ]
}
```

Decisions in it, each of which is load-bearing:

- **Rows are objects, not tuples.** Twice the bytes and worth it: an object
  survives a column being added, removed or reordered between the export and the
  import, which §6 says is the normal case. At six players' worth of data the
  size is irrelevant.
- **`_migrations` is not a table in `tables`.** It is in `schema`, as
  information. Re-importing the ledger would claim files had been applied that
  may no longer read the same way; after an erase the ledger is rebuilt by
  **Apply pending**, which is the only thing that may write it.
- **D1 and SQLite internals are excluded** from both export and erase: any name
  matching `sqlite_%`, `_cf_%` or `d1_%`. They are not ours, and `DROP` on one
  fails.
- **`schema` is what makes a confusing failure a sentence.** On import, a
  backup whose applied migrations differ from the current ones gets one line
  saying so. It is a warning and never a refusal — see §6.
- **Pretty-printed, two spaces.** The file is opened in a browser by a person
  with no CLI. Readability beats bytes here by a wide margin.

### 3.1 Determinism, and the fingerprint

The **fingerprint** is `sha256Hex` over the document with `exported_at` removed
— over `{format, version, schema, tables}` alone. A timestamp in the hash would
make every export of identical data a different fingerprint, and §5 compares two
snapshots taken minutes apart.

For the hash to mean anything the document must be byte-identical for identical
data, so table and row order are fixed rather than incidental:

- **Tables in `sqlite_master` order**, which is creation order. That is also a
  valid insert order for foreign keys — a table cannot reference one that does
  not exist yet — which §6 relies on and which no other ordering guarantees.
- **Rows `ORDER BY rowid`.** Every table in this schema is a rowid table, so
  that is a total order. `test/sql-files.test.js` gains an assertion that no
  migration declares `WITHOUT ROWID`, because the day one does, this stops being
  true silently.
- **Columns in `PRAGMA table_info` order**, and each row object's keys in that
  same order.

No paging. A full read is one query per table, and the number where that would
need revisiting is in the tens of thousands of rows — three orders of magnitude
from here.

## 4. Export: the route

`GET /admin/export` returns the document as
`application/json` with
`Content-Disposition: attachment; filename="gameroom-YYYY-MM-DD-HHMM.json"`
(UTC), `cache-control: no-store`.

It works on a database with no tables at all — `tables: []` — because a page
that errors on a fresh database is the failure mode Session A spent its whole
design avoiding.

**It also sets a cookie**, and that cookie is the whole of §5's enforcement:

```
erase_ok=<fingerprint>; Path=/admin; Max-Age=600; HttpOnly; SameSite=Strict; Secure
```

A `GET` that sets a cookie is unusual and is fine: it changes nothing in the
database, and the cookie is a receipt for a download, not a credential.

## 5. Erase: two posts, and what actually stops a mistake

**Step one — `POST /admin/erase`** renders a confirmation page. It does not
touch the database beyond reading it. The page carries:

- Row counts per table — what is about to be destroyed, in numbers.
- **Download the backup**, a link to `/admin/export`, `target="_blank"` so the
  download does not navigate away from the confirmation.
- A form to `/admin/erase/confirm` with a text input that must contain the word
  `erase`.

**Step two — `POST /admin/erase/confirm`** re-reads the database, recomputes the
fingerprint, and refuses unless all three hold:

| Check | Refusal says |
|---|---|
| `erase_ok` cookie present | Download the backup first. Nothing else on this page works until you do. |
| its value equals the fresh fingerprint | The database changed since that backup — somebody finished a game. Download again. |
| the typed word is `erase` | Type `erase` to confirm. |

`SameSite=Strict` is doing a second job there: a POST from another site does not
carry the cookie, so the one route that destroys data refuses a cross-site press
by the same check that refuses a forgetful one. The routes that only write have
nothing in front of them, which is the same as it was before this session.

The cookie is what turns "wire the export into the erase confirmation itself"
from a link somebody can walk past into a step they cannot skip, with no client
JavaScript and no secret — Session C's `SESSION_SECRET` does not exist yet and
this must not wait for it. It is a guardrail, not a lock: anyone who can reach
`/admin` can erase, which was already true of **Apply pending** and stays true
until Session C decides whether the gate covers this page. It cannot cover it
entirely — `/admin` has to render before a passphrase exists — so the shape of
that decision is *which routes*, and this session hands C three destructive ones
to think about rather than none.

**The drop loop.** `CLAUDE.md`: discover drop order by retrying until a pass
drops nothing new, do not hardcode it.

1. Read every `table` and `view` from `sqlite_master`, minus the internals in
   §3. `_migrations` is in the set: erase drops the ledger, which is what makes
   every migration pending again and rebuilds the database from the files as
   they now read.
2. Drop the views.
3. Passes over the remaining tables, one `DROP TABLE` per statement — **not a
   batch**. A batch fails whole, so a foreign-key refusal on one table would
   roll back the drops that succeeded and no pass would ever make progress.
4. Stop when nothing remains, or when a pass drops nothing new. In that second
   case the page names every table still standing and the error each one gave.

Erase is not atomic and cannot be. It does not need to be: `DROP TABLE` is
idempotent under `IF EXISTS`, so a half-finished erase is finished by pressing
the button again.

After a successful erase the page renders the ordinary status table, which now
reads every migration as pending, plus the two presses that follow: **Apply
pending**, then **Run seed**.

## 6. Import: the normal case is a schema that moved

`POST /admin/import`, `enctype="multipart/form-data"`, one `<input type="file">`.
`request.formData()` gives the file, `.text()` gives the JSON. No client
JavaScript.

The thing to design for: **an import into a schema identical to the one exported
is the rare case.** The reason anybody erases is that the schema changed
(`CLAUDE.md` — clear/delete is the schema-change path), so the backup in hand
almost always describes a slightly different database. An import that refuses on
mismatch is useless exactly when it is needed.

So it is tolerant, per table and per column, and says what it did:

- **A table in the file that no longer exists** — skipped, named on the page,
  the rest still imported.
- **A column in the file that no longer exists** — dropped from that table's
  insert, named once per table.
- **A column in the schema that is not in the file** — left to its default. If
  it is `NOT NULL` without one, the insert fails, and the failing statement and
  SQLite's message land on the page the same way a migration's do.
- **A `schema` header that does not match the applied migrations** — one warning
  line, above the result. Never a refusal.

Everything else is the same discipline the seeds follow:

- **`INSERT OR IGNORE`, never `UPDATE`.** Importing the same file twice changes
  nothing the second time, which is what makes a half-finished import safe to
  finish by pressing the button again. It also means import never overwrites a
  row that is already there — a restore into a partly-rebuilt database adds what
  is missing and touches nothing else.
- **Tables in file order**, which §3.1 fixed as creation order, which is a valid
  foreign-key insert order. `play_results` lands after `plays` and `players`
  because that is how the schema file created them.
- **Chunked**, ~50 statements per `batch()`, sequential. D1 has no transaction
  spanning batches, so a large import can half-apply; `INSERT OR IGNORE` is what
  makes that a stopped import rather than a corrupt one, and the page says how
  many rows went in per table.
- **Import into a database with no schema** reports "every table is unknown —
  press Apply pending first" rather than a wall of SQLite errors.

Identifiers are quoted (`"players"`) and every value is bound, never
interpolated. The file comes from a person's phone, but the escaping rule does
not get a family exemption.

## 7. The admin page after this session

Unchanged in kind: server-rendered HTML, no client JavaScript, inline styles,
`<form method="post">`. It still has to render when `public/` is mid-deploy and
before any table exists.

Added, in this order down the page, below the existing status table and actions:

- **Backup** — one line, the export link, and the sentence that this is the only
  copy of the play record that leaves the database.
- **Restore** — the file input and its button, plus what an import does and does
  not overwrite.
- **Danger** — a `.panel.bad` holding **Erase everything**, its one-line
  description of what goes and what comes back, and nothing else. It is at the
  bottom because a destructive button next to **Run seed** is a mis-tap waiting
  for a 360px screen.

Each of the three posts renders its own outcome through `renderOutcome`, the
same as A's two, and none of them redirect: a redirect loses the failing
statement, which is the one thing this page exists to show.

## 8. Tests

`test/backup.test.js`, all against `worker/db/backup.js` with plain values:

1. **Document shape.** Header fields present; `_migrations` never appears in
   `tables`; internals excluded; empty database yields `tables: []`.
2. **Determinism and fingerprint.** Identical data yields identical bytes and an
   identical fingerprint; `exported_at` does not affect the fingerprint; a
   one-character change in one row does; a row added, removed or reordered does.
3. **Import plan — the happy path.** Statements are `INSERT OR IGNORE`, one per
   row, identifiers quoted, values bound in column order, tables in file order.
4. **Import plan — tolerance.** Unknown table skipped and reported; column in
   the file but not the schema dropped and reported; column in the schema but
   not the file omitted from the statement; every one of those reported once per
   table rather than once per row.
5. **Import plan — rejection.** Not JSON; JSON that is not an object; wrong
   `format`; a `version` from the future; `tables` that is not an array; a row
   that is not an object. Each names what is wrong with the file.
6. **Chunking.** A row count either side of the chunk boundary produces the
   expected batches, and the last chunk is not empty.
7. **Schema warning.** A `schema` header naming a different checksum produces
   the warning; an identical one produces none.

`test/sql-files.test.js` gains: **no migration declares `WITHOUT ROWID`** (§3.1).

The D1 halves in `apply.js` — the table read, the drop loop, the batch execution
— have no test and cannot have one. That is §9.

## 9. Acceptance criteria

| # | Criterion | Closed by |
|---|---|---|
| 1 | `node --test` passes; test groups 1–7 exist and the `WITHOUT ROWID` assertion is in `sql-files.test.js`. | CI |
| 2 | `/admin` renders on a fresh database with the backup, restore and danger sections present and no error. | **S7** |
| 3 | **Download the backup** on a seeded database yields a JSON file with six players in it. | **S7** |
| 4 | **Erase everything** without downloading refuses and says why; after downloading, it drops every table including `_migrations`. | **S7** |
| 5 | After erase, `/admin` shows every migration pending; **Apply pending** then **Run seed** rebuilds the database. | **S7** |
| 6 | Importing the file from criterion 3 into the rebuilt database restores it; importing it a second time changes nothing and does not error. | **S7** |
| 7 | Importing a backup taken against an older `001_schema.sql` warns, imports the columns that still exist, and names the ones it dropped. | **S7** |
| 8 | A deliberately corrupted backup file is refused with a sentence naming what is wrong, and the database is untouched. | **S7** |
| 9 | `/` and `/sudoku/` are unchanged. | local |

Criteria 4 and 7 are the two worth the trouble. 4 is the whole reason the cookie
exists, and 7 is the case that actually happens.

## 10. Explicitly not in this session

- **Any login on `/admin`.** The gate is Session C, and §5 says what it hands C.
- **Scheduled or automatic backups.** Export is a button someone presses.
- **A backup stored in D1.** A copy of the record in the database it is a backup
  of is not a backup.
- **Anything under `public/`.** No client JavaScript is added anywhere.
- **`/api/*`, the picker, the avatar set, the shelf** — Session C. **Profile
  editing** — Session D. **Writing a play** — Phase 3.
