# Slice 7 — Storage foundation: the Durable Object, the schema, the admin page

Corresponds to `../design.md` §6 step 7. The first slice with a server in
it, and the first that writes a row.

**Estimated cost:** Medium (20–60k). The code is small; the cost is that none of
it can be run locally (§11).

**Blocked on:** **S1**. Nothing here can be verified anywhere but a deployment,
so the repo must already be building on push before this slice starts.

**Needs, but is not blocked by, `D1`** — the family code and the players' names.
Placeholders ship and the real values arrive by editing a seed file, which is
the mechanism demonstrating itself.

---

## 1. Where this surface is cut, and why here

`CLAUDE.md` specifies one storage surface: two lists with opposite rules, three
buttons, a status table, drift, a quote-aware splitter, per-DO erase, and JSON
export and re-import. That is Large in one session, and `README.md`'s rule
is that a spec which comes out Large has not been cut yet.

- **This slice.** The DO exists. `MIGRATIONS` and `SEEDS` exist. **Apply
  pending** and **Run seed** work. The status table shows applied, pending, and
  drifted. Failures render on the page.
- **Slice 8.** **Erase everything**, JSON export, and re-import.

The cut is *not* between erase and export. `CLAUDE.md` makes export the
precondition for erase and requires re-import alongside it, wired into the erase
confirmation itself — so those three are one piece of work and the only
available cut is in front of them.

**How the schema changes while erase does not yet exist.** Editing
`001_schema.sql` after it has applied shows as drift, and drift is never
reapplied, so without erase there is no rebuild. The escape hatch is the
architecture rather than a workaround: there is one DO per family code
(`../design.md` §2), so a code that has never been used is a database with
no tables. During this slice the schema is changed by editing the file and
opening the admin page against a new code.

That is free here and only here. Slice 9 is the first slice that writes a row
anyone would miss, and slice 8 lands in between. This is why the cut is
affordable rather than merely convenient — take the same cut one slice later and
it strands real data behind a drifted schema.

## 2. What is and is not a build step

`wrangler` bundles the Worker script. That is what makes `import schema from
'./sql/001_schema.sql'` work, via the `Text` rule in §3. Neither project rule is
bent by it:

- **No CLI** is about who types the command. Cloudflare's build container runs
  `npx wrangler deploy` on a push to `main` (S1); nobody here runs anything.
- **No build step** (`README.md`) is about `public/`. Client source stays
  plain ES modules the browser loads directly, and this slice does not add a
  line to it. The Worker script is a different program that happens to share a
  repo, and it is never served.

The boundary that keeps that true: nothing under `public/` imports from
`src/worker/` or `src/db/`, and nothing in those imports from `public/sudoku/ui/`.
`public/sudoku/core/` is importable by both, and slice 10 will need it to be.

## 3. Files

```
wrangler.jsonc            gains main, the DO binding, and the Text rule
src/worker/
  index.js                fetch(): route /r/<code>/… to the DO, everything else to assets
  room.js                 class FamilyRoom — the Durable Object
  admin.js                renders the admin page, handles its two posts
src/db/
  migrations.js           the only module that imports .sql; exports MIGRATIONS and SEEDS
  plan.js                 pure: splitting, checksums, applied/pending/drifted
  sql/
    001_schema.sql
    seed_players.sql
test/
  plan.test.js
  split.test.js
  sql-files.test.js
```

None of this is under `public/`, because none of it is served (slice 1 §2).

**Why `plan.js` is separate from `migrations.js`.** `node --test` cannot import a
`.sql` file — a text import is a bundler feature and there is no bundler in CI
(Q2). So everything with logic in it takes strings as arguments and lives in
`plan.js`, and `migrations.js` is the one module that turns files into strings
and holds nothing worth testing. This is `CLAUDE.md`'s "one module is the only
place `.sql` is imported" with its testability consequence made explicit rather
than discovered.

Tests may still *read* the `.sql` files with `node:fs` — reading is not
importing, and §10 groups 4 and 5 depend on it. Two naming conventions make that
possible without importing `migrations.js`: migrations are `NNN_*.sql`, seeds
are `seed_*.sql`.

### `wrangler.jsonc`

```jsonc
{
  "name": "social-sudoko",
  "main": "src/worker/index.js",
  "compatibility_date": "2026-09-03",
  "assets": { "directory": "./public" },
  "durable_objects": {
    "bindings": [{ "name": "FAMILY", "class_name": "FamilyRoom" }]
  },
  "migrations": [
    { "tag": "v1", "new_sqlite_classes": ["FamilyRoom"] }
  ],
  "rules": [
    { "type": "Text", "globs": ["**/*.sql"], "fallthrough": true }
  ]
}
```

Two things here are easy to get wrong and expensive afterwards.

- The top-level `migrations` key is **Cloudflare's** list of Durable Object class
  changes. It has nothing to do with `MIGRATIONS` in `src/db/`. One announces
  classes to the runtime, the other applies SQL. Same word, no relationship;
  keep them apart in conversation as well as in code.
- `new_sqlite_classes`, not `new_classes`. A DO created key-value backed cannot
  be converted to SQLite afterwards, the free plan offers SQLite-backed DOs only
  (`../design.md` §2.1), and the fix for getting it wrong is a new class
  name rather than an edit.

## 4. Routing

- The DO is addressed by family code: `env.FAMILY.idFromName(code)`. One DO per
  code (§2), brought into existence by first use — no dashboard action, which is
  what S3 promises.
- The Worker handles `/r/<code>/…`. Everything else falls through to the assets
  binding, which already serves `public/` for any path matching a file there.
  The game stays at `/` and does not know rooms exist; slice 9 is where the
  client learns a family code.
- `<code>` is `[a-z0-9-]{3,32}`, lowercased before use. Anything else is a 400
  and never reaches `idFromName`. An unvalidated name is a room, and a typo in a
  URL should not quietly create a second database.
- Admin is `GET /r/<code>/admin`, posting to `/r/<code>/admin/apply` and
  `/r/<code>/admin/seed`.

**No login.** There is none in this project (`../design.md` §7.1), and this
would be the only authenticated surface in the codebase if there were. Anyone
with the admin URL can apply and seed, and from slice 8 can erase. §7.1 already
accepts that anyone with the code is in; what makes erase survivable is slice
7's export-first confirmation, not a password.

## 5. The two lists

Straight from `CLAUDE.md`, restated because this is the module that implements
it and the rules are opposite in a way that invites being averaged.

**`MIGRATIONS`** — ordered `[{ name, sql }]`. Checksummed. Applied once, in
order, by **Apply pending**. An edit after it has run is drift: reported, never
silently reapplied.

**`SEEDS`** — ordered `[{ name, sql }]`. Never checksummed, never recorded.
**Run seed** re-executes the whole list on every press. That is what lets a seed
file grow by editing it in the GitHub web editor and pressing a button.

The rule that makes re-running safe: **every statement in a seed file is an
`INSERT … ON CONFLICT DO NOTHING`.** No `UPDATE`, no `DELETE`, no DDL, nothing
conditional. A seed file that violates it is a bug the runner cannot detect at
run time, so §10 group 4 asserts it in CI instead.

## 6. The schema

One file, `001_schema.sql`, creating everything including the ledger.

```sql
CREATE TABLE IF NOT EXISTS _migrations (
  name          TEXT PRIMARY KEY,
  checksum      TEXT NOT NULL,
  applied_at    INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS players (
  name          TEXT PRIMARY KEY,
  created_at    INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS results (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  player        TEXT    NOT NULL REFERENCES players(name),
  mode          TEXT    NOT NULL,           -- 'solo' | 'race'
  size_key      INTEGER NOT NULL,           -- 4 | 6 | 9
  tier          INTEGER NOT NULL,
  won           INTEGER NOT NULL,           -- 0 | 1
  duration_ms   INTEGER,
  hints         INTEGER NOT NULL DEFAULT 0,
  hints_applied INTEGER NOT NULL DEFAULT 0,
  checks        INTEGER NOT NULL DEFAULT 0,
  completed_at  INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS results_best
  ON results (player, size_key, tier, duration_ms);
```

- **No `bests` table.** §4.6 offers it as derived or as a query against
  `results`. A best time is `MIN(duration_ms)` over the index above; a table
  would be a cache with an invalidation rule, and R5 reads it once per page.
  Slice 9 writes the query.
- **The assist columns exist now**, before anything writes them. They are the
  shape of a row, and a slice whose job is to write rows should not also be
  changing the schema. Slice 6 produces `hints` and `hints_applied`; Q3 produces
  `checks`.
- **`size_key` is data, not a dimension.** `no-hardcoded-sizes.test.js` reads
  `public/sudoku/core/` and does not read `.sql`, nor should it: the `4 | 6 | 9`
  comment documents an enum stored in a column. Written here once so nobody
  later "fixes" it.
- **The ledger is created by the file it records.** Applying `001` runs the DDL
  and then inserts its own ledger row inside the same transaction. No bootstrap
  path, no zeroth file.

`seed_players.sql` holds one `INSERT … ON CONFLICT DO NOTHING` per household
member, with placeholder names until **D1** is answered.

## 7. Applying

Everything runs inside `ctx.storage.transactionSync()`. DO SQLite is not D1
(`../design.md` §2.1): a transaction spans the whole migration, so it lands
whole or not at all, and the partial-failure ceremony the reference repos carry
is not written here.

Per migration:

1. Split the SQL into statements (§8).
2. Open a transaction; `sql.exec` each statement in order; insert the ledger
   row; commit.
3. On a throw, the transaction rolls back. Stop — do not continue to the next
   migration — and render the failing statement and the error (§9).

Statements execute one at a time rather than as one multi-statement string
purely so the failing one can be named. Long files are handed to the runner in
chunks of statements to keep any single call small; the transaction spans the
migration regardless of chunking.

**Checksums** are `crypto.subtle.digest('SHA-256', …)` over the file's exact
bytes, hex-encoded. No whitespace normalisation: a reformat *is* a change, and a
drift check that forgives formatting is one that misses a moved semicolon.

## 8. The statement splitter

```js
splitStatements(sql) -> string[]
```

Semicolon-terminated, and it must not split on a semicolon inside a
single-quoted string (including the `''` escape), a `--` line comment, or a
`/* */` block comment. Comments are dropped. Empty statements are dropped.

**Not supported, deliberately:** `BEGIN … END` bodies, i.e. triggers. Handling
them means parsing SQL rather than scanning it. What makes the omission safe is
a rule rather than a hope — no schema file in this project contains a trigger —
and the failure mode if one ever does is a loud syntax error on the admin page,
not a silently truncated body.

Pure, string in and array out, and the most heavily tested thing in the slice.
It is the one piece whose bugs produce a *wrong* schema rather than a visible
failure.

## 9. The admin page

Server-rendered HTML from the DO. No client JavaScript and no `fetch`: the
actions are `<form method="post">`. A page that needs JavaScript to tell you the
database is broken fails exactly when it is needed, and there is no log to fall
back on (no CLI).

**It must render when nothing exists.** A fresh DO has no `_migrations` table
and reading it throws. Check first:

```sql
SELECT name FROM sqlite_master WHERE type='table' AND name='_migrations'
```

Not try/catch — a caught error cannot tell "there is no ledger" from "the ledger
is corrupt", and those two want different pages.

The status table has one row per entry in `MIGRATIONS`:

| State | Meaning |
|---|---|
| applied | ledger row exists, checksum matches |
| pending | no ledger row |
| **drifted** | ledger row exists, checksum differs |

Drifted is shown in a colour that means stop, with both checksums and one line
saying what the fix is: from slice 8, Erase → Apply → Seed; until then, a new
family code (§1).

The page also shows the room code it is acting on, in the heading —
`CLAUDE.md` requires it to say which room, and slice 8 puts a destructive button
on this same page. Plus the ledger rows with their timestamps, and the last
action's outcome, including the failing statement in a `<pre>` when there was
one.

Two buttons: **Apply pending** and **Run seed**. **Erase everything** is not
rendered at all, not rendered disabled. A greyed-out button is a promise, and
slice 8 is a better place to make it than a tooltip is.

## 10. Tests

Pure modules and files on disk. There is no DO test harness without a CLI (Q2),
so the runtime behaviour is §11's business and these cover what can be covered
honestly.

1. **Splitter.** Semicolons inside single-quoted strings; `''` escapes; `--` to
   end of line; `/* */` spanning lines and containing both semicolons and
   quotes; trailing semicolon and none; empty input; comment-only input.
2. **Checksums.** Stable for identical input, different for a one-byte change,
   including a whitespace-only one.
3. **Plan.** `planFor(ledgerRows, migrations)` classifies applied, pending, and
   drifted in `MIGRATIONS` order, and reports two cases that are neither:
   - a ledger row whose name is no longer in `MIGRATIONS` — a deleted migration
     is drift of a different kind and must not be silent;
   - a pending migration ordered *before* an applied one — which means the files
     were edited under a live database, and applying forward would produce a
     schema no fresh database would ever have.
4. **Seed shape.** Every statement in every `seed_*.sql` is an `INSERT` ending
   `ON CONFLICT DO NOTHING` (§5). Read from disk, split with §8's splitter.
5. **No orphan SQL.** Every `.sql` file under `src/db/sql/` is named in
   `migrations.js`. A file nobody imports looks applied and is not.

## 11. Acceptance criteria

Most of these can only be closed in a browser against a deployment — there is no
`wrangler dev` here, so the loop is push, wait for the build, open the page.
That is the real cost of this slice and the reason it is spec'd as Medium
despite being a few hundred lines. **Add the S4-marked criteria to
`questions.md` as a setup task when this slice starts**, as slice 1's did.

| # | Criterion | Closed by |
|---|---|---|
| 1 | `node --test` passes; the workflow is green. Test groups 1–5 exist. | CI |
| 2 | `/r/<unused code>/admin` renders on a room that has never existed: everything pending, no error, no table. | **S4** |
| 3 | **Apply pending** creates the tables and the ledger rows; a second press applies nothing and says so. | **S4** |
| 4 | **Run seed** inserts the players; a second press changes nothing and does not error. | **S4** |
| 5 | Editing an applied `.sql` and redeploying shows that migration **drifted**, with both checksums, and **Apply pending** does not reapply it. | **S4** |
| 6 | A deliberate syntax error in a migration renders the failing statement and SQLite's message on the page, and leaves the database exactly as it was. | **S4** |
| 7 | The game at `/` is unchanged: same files, same behaviour, no room code anywhere in the UI. | local |
| 8 | Two codes are two databases — applying in one leaves the other pending. | **S4** |

Criterion 6 is what pays for §7's one-statement-at-a-time execution. Without it
the page can say "it failed" and nothing more, and there is nowhere else to look.

Criterion 8 is worth doing by hand exactly once. Every later slice assumes
per-code isolation and not one of them tests it.

## 12. Explicitly not in this slice

Erase, JSON export, re-import (slice 8). Writing a result, timing, best times
(slice 9). WebSockets, hibernation, `serializeAttachment`, race mode (slice 10) —
the DO built here has no `webSocketMessage` handler and no route but admin.
Player identity beyond a seeded name, any login, any secret, any dashboard
action. The client does not talk to the Durable Object at all in this slice.
