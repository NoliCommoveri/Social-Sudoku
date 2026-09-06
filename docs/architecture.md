# Architecture — the Cloudflare stack

What runs where, and why each piece is there. Current state, not a plan of
record: when something changes, this file is rewritten.

## 1. The whole thing

One Worker. One D1 database. One Durable Object class. Nothing else.

```
                    games.immotus.app
                           │
                           ▼
              ┌────────────────────────┐
              │   Worker               │
              │   carson-gameroom      │
              └────────────────────────┘
                 │        │         │
    static files │        │ /api/*  │ WebSocket upgrade
      from public/        ▼         ▼
                    ┌─────────┐  ┌──────────────┐
                    │   D1    │  │  GameRoom DO │
                    │ gameroom│  │ one per room │
                    └─────────┘  └──────────────┘
                    persists      disposable
```

**The rule that keeps these apart: D1 holds what must survive; the Durable
Object holds what is live.** Nothing is in both. A room's state is deleted when
the game ends; the result of that game is a D1 row written on the way out.

## 2. The Worker

One Worker serves everything. Not one per game — a second Worker means a second
deploy, a second set of bindings, and a routing layer between them, in exchange
for isolation that six players do not need.

- **Static assets** — `public/` is the assets directory. A request whose path
  matches a file gets the file, with no Worker invocation and no charge.
- **`/api/*`** — no file matches, so it falls through to the Worker script.
  Identity, profiles, stats reads, admin actions.
- **`/api/room/*` upgrade** — routed to a `GameRoom` stub by room code.

Deployment is unchanged from today: push to `main`, Cloudflare's GitHub
integration builds and runs `wrangler deploy` on its own build machine. Nobody
types a command.

### 2.1 No build step, still

`public/` is plain ES modules loaded directly by the browser. No bundler, no
transpile, no TypeScript, no npm dependency. This is downstream of the no-CLI
rule in `CLAUDE.md` and the pivot does not relax it.

Both imported design documents assume Vite with a per-game `base` path, and warn
that forgetting it produces a white screen of 404s. **That failure mode does not
exist here.** It is a bundler problem — a bundler rewrites asset URLs at build
time and needs telling what prefix they will be served under. Plain modules with
relative paths work at any depth without being told anything. `public/sudoku/`
serves at `/sudoku/` because that is where the file is.

The Worker script under `worker/` *is* bundled by wrangler on Cloudflare's build
machine, and is never served. That was already true and does not extend to a
single client file.

**Rec: JavaScript with JSDoc throughout, including the Worker.** No TypeScript
anywhere. *Alternative:* TypeScript in `worker/`, which wrangler compiles
happily. *Would revisit if:* the `GameRoom` generic interface turns out to be
genuinely hard to keep straight in JSDoc. The reason against is the no-CLI rule
again — a type error becomes a failed deploy visible only in a Cloudflare build
log, from an editor with no typechecker in it. The existing 1,200 lines are
JSDoc-annotated and get most of the benefit. Interface definitions in the design
docs stay written in TypeScript notation, because they are documentation.

## 3. D1, and why the stats moved out of the Durable Object

The sudoku design put results in DO SQLite, one Durable Object per family code.
That is now wrong, and the reasons are worth writing down so it is not undone.

- **There is one family.** "One DO per family code" was multi-tenancy for a
  tenancy that does not exist.
- **Stats are cross-game.** H4 asks for overall stats. A DO scoped to a room
  cannot answer a question that spans games it never hosted.
- **Profiles are read before any room exists.** The hub renders the player shelf
  on first paint. Waking a Durable Object to draw a landing page is backwards.
- **A DO must be woken to be queried. D1 is simply there.**

**The cost, stated honestly:** DO SQLite has `ctx.storage.transactionSync()` —
real atomic transactions — so the migration trap the reference repos work around
did not apply. **Moving to D1 re-introduces it.** D1 has no transaction spanning
batches; a migration larger than one `batch()` can half-apply.

The mitigation is a rule, not machinery: **one migration file is one `batch()`.**
At this schema's size that is not a constraint anyone will feel. Globetrotters —
the reference `CLAUDE.md` already points at — solves this for D1 and is the
pattern to follow.

### 3.1 Schema shape

Two tables carry the record, because H4 asks two different questions.

```sql
plays(
  id, session_id, game, mode, config_json,
  started_at, ended_at
)

play_results(
  play_id, player_id, rank, outcome, value, unit, detail_json
)
```

A *play* is a thing that happened. A *play_result* is one player's outcome in
it. That split is what makes both "what did we play on Sunday" and "who is
fastest at 9×9 hard" one query each, and head-to-head two rows of the same
`play_id`.

`unit` says what `value` means — `'seconds'`, `'points'` — so a reader needs no
per-game knowledge. `detail_json` absorbs per-game extras (assists used, which
commodity was cornered) without a schema change when the third game arrives.

`players` is in [`identity-and-stats.md`](identity-and-stats.md).

### 3.2 Migrations without a CLI

Unchanged from `CLAUDE.md`: one module is the only place `.sql` is imported and
it exports two lists with opposite rules. `MIGRATIONS` is checksummed and
applied once; an edit after it has run shows as drift. `SEEDS` is every-insert-
`ON CONFLICT DO NOTHING` and re-runs whole on every press.

Clear-and-rebuild stays the schema-change path, with one difference that now
matters more than it did: **the JSON export is a hard precondition for erase**,
because from Phase 3 the database holds the only copy of the play record and
that cannot be regenerated. Wire export into the erase confirmation itself.

The admin page renders before login and before any table exists, and shows the
failing statement and its error on the page. There is no other way to see it.

**Creating the database is a dashboard action.** D1 → Create database →
`gameroom`. Copy the id into `wrangler.jsonc` in the GitHub web editor. That is
the whole no-CLI path, and it happens once.

## 4. The Durable Object

One class, `GameRoom`, one instance per room code, SQLite-backed (the free plan
offers nothing else, and it is the right backend anyway). It owns live session
state and nothing durable.

Interface and lifecycle: [`gameroom.md`](gameroom.md). The platform constraints
that shape it — hibernation, `serializeAttachment`, alarms instead of
`setInterval` — are unchanged by the pivot and are correct as written there.

Sudoku solo never touches it. Neither does the technique library. Routing a
static page through a Durable Object for consistency's sake would be slower,
more fragile, and more expensive than the file it replaced.

## 5. What we deliberately do not use

Named so a future session does not add one reflexively.

- **KV** — D1 answers everything, and nothing needs edge-cached config.
- **R2** — avatars are a fixed built-in set rendered as inline SVG, not uploads.
  No file storage, and no image moderation problem with four children.
- **Queues, Workflows, Vectorize, Hyperdrive, Workers AI** — nothing here is
  asynchronous, vector-shaped, or talking to a Postgres.

## 6. Free tier, checked

- **Workers:** 100,000 requests/day. Six players, and static assets do not
  count against it.
- **D1:** 5 GB, 5M rows read/day, 100k written/day. A play writes single-digit
  rows.
- **Durable Objects:** 13,000 GB-s/day. A DO bills 128 MB regardless of use, so
  that is roughly 29 hours of continuously-active room time per day. A Pit room
  ticking at 500ms cannot hibernate while it ticks, and it still does not
  matter.

Nothing here is a cost problem. Do not design around one.

## 7. Two findings from reading the existing code

The `GameRoom` document's §1 checklist has been run against the real sudoku
source. Full results are in that file. Two of them shape this architecture.

**Per-player difficulty on a shared puzzle already works.** `deal(geom, seed,
tier)` is deterministic, and `carve` takes the solution as an argument, so one
seed yields one solution grid and as many clue masks as there are tiers. Checked
at 9×9: easy and hard from seed 12345 produce an identical solution, 50 and 32
clues, and the masks nest — `hard ⊆ medium ⊆ easy`. That nesting is not luck; it
is the clue-superset layering the sudoku design specifies for R3, and it means
nobody in a race holds a clue their opponent lacks. Phase 8 needs no generator
changes.

**Sending the seed sends the solution.** The same determinism means a client
given a seed can compute the answer, because `deal` returns the solution
alongside the givens. Reconnect efficiency and server authority pull opposite
ways here.

*Rec: the room stores the seed and sends `givens`.* Eighty-one bytes, and the
solution never leaves the server. *Alternative:* send the seed and accept that a
determined 12-year-old with devtools can win a race impossibly fast. *Would
revisit if:* it turns out nobody cares, which is possible but should be found
out on purpose rather than after someone's brother posts a 4-second 9×9.

## 8. Setup tasks

Dashboard actions, in order. None has a CLI step.

- **A1 — Create the D1 database.** D1 → Create → `gameroom`. Paste the id into
  `wrangler.jsonc`. *Phase 2.*
- **A2 — Set two secrets.** Worker → Settings → Variables and Secrets →
  Encrypted. `FAMILY_PASSPHRASE` and `SESSION_SECRET` (any long random string).
  *Phase 2.*
- **A3 — Add the custom domain.** Worker → Settings → Domains & Routes → Add
  custom domain → `games.immotus.app`. The zone is already on Cloudflare, so the
  DNS record and certificate are automatic. *Phase 2.*
- **A4 — Rename the Worker.** *Optional, and if done, do it first.* Currently
  `social-sudoko`, which is both a typo and no longer what this is.

  **Changing `name` in `wrangler.jsonc` does not rename anything.** The next
  deploy creates a *second* Worker under the new name and leaves the old one
  running. So the cost of this depends entirely on when it happens: today the
  Worker has no bindings, no secrets and no custom domain, so the orphan is an
  empty static-file server and deleting it costs nothing. After A1–A3 it holds
  the D1 binding, the Durable Object namespace and the domain, none of which
  follow to the new Worker.

  If you do it: change `name`, push, confirm `carson-gameroom` serves the site,
  confirm its build connection points at the repo, then delete `social-sudoko`.
  Do this **before** A1, or not at all.

  Skipping it is defensible. Once `games.immotus.app` is live the Worker name is
  visible only in the dashboard list and the unused `.workers.dev` subdomain.
