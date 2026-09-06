# CLAUDE.md

Project directives. Read every session.

This repo is the **Carson Family Gameroom** — one site at `games.immotus.app`
holding several games, shared player profiles, and a record of what the family
has played. Sudoku is built and playable; a Pit-style trading game is next.
Players are 4, 5, 11 and 12, plus two adults.

Start at `ROADMAP.md` for where things stand and what phase is next.
`docs/architecture.md` is the stack.

## Communication

No sycophancy. Do not open with an assessment of the request ("this is unusually
well specified," "great question," "good catch"). Do not praise the design, the
doc, or the decision before answering. Every sentence carries information or is
cut.

Disagreement is expected and stated plainly, once, with the reason. If a
direction is reaffirmed, build it and stop arguing.

## Documents reflect current state

Design docs, READMEs, and this file describe how things are *now*. They are not
changelogs.

- No "previously we did X, now we do Y" passages.
- No dated entries, no "updated 2026-09-03," no strikethrough of superseded
  decisions.
- When a decision changes, rewrite the affected section as if it had always
  read that way. Delete what it replaced.

Rationale stays only where it prevents someone re-litigating a settled choice
(the `Rec` / *Alternative* / *Would revisit if* pattern is current-state, not
history — keep it).

Revision history, removed features, and parked decisions live in `HISTORY.md`,
which is **read only when troubleshooting** — an unexplained behavior, a
regression, a "why is this like this" — or when deliberately reopening a parked
decision. Do not read it at session start. Do not consult it for routine feature
work.

## Session effort budgeting

Before starting implementation work, state an estimated token cost and get
agreement if it exceeds the session budget.

Bands:

| Band | Approx. tokens | Shape |
|---|---|---|
| Small | < 20k | One module, one file, tests for it |
| Medium | 20–60k | A vertical slice |
| Large | 60–120k | A slice with real debugging, or two coupled modules |
| Too large | > 120k | Split it. Do not start. |

Hard cap: **~120k tokens of work per session.** Context degrades before the
window fills; a fresh session with a clean read of the current code beats a
long one carrying stale intermediate state.

At natural stopping points — a slice complete and committed, tests green, a
module boundary reached — say so and recommend a new session rather than
continuing into the next unit of work. A natural stopping point is one where the
next session can start from the committed tree plus this file, with nothing held
only in conversation.

If a session is going to overrun, stop at the last clean boundary, commit, and
write down what is unfinished. Do not leave a half-migrated schema or a
half-refactored module across a session break.

## No CLI

There is no local command line. No `wrangler`, no `npm`, no `git` on the user's
side. Nothing in setup, migration, seeding, or deploy may require a CLI command.
If a solution needs `wrangler d1 execute`, it is not a solution.

Everything the user must do is a browser action: the GitHub web editor, the
GitHub web UI, or the Cloudflare dashboard. Setup tasks are listed in
`docs/architecture.md` §8 so they are not discovered halfway through a phase.

### No build step

`public/` is plain ES modules loaded directly by the browser. No bundler, no
transpile, no TypeScript, no npm dependency at runtime. This follows from the
no-CLI rule: anything requiring a build before the site works cannot be driven
from the GitHub web editor.

Consequences worth knowing before proposing otherwise:

- **There is no base path to configure.** Relative imports resolve at whatever
  depth the file sits, so `public/sudoku/` serves at `/sudoku/` with nothing
  told about it. Design documents that warn about setting a bundler `base` are
  describing a problem this project does not have.
- **JavaScript with JSDoc, everywhere, including the Worker.** A type error in a
  web editor with no typechecker becomes a failed deploy visible only in a
  Cloudflare build log. Interface definitions in design docs may use TypeScript
  notation — that is documentation, not source.

The Worker script under `worker/` is bundled by wrangler on Cloudflare's build
machine and is never served. That does not relax the rule for a single client
file.

### No runtime dependencies

Zero. Everything under `public/` is written here.

## Data: D1 persists, the Durable Object is live

**D1 holds what must survive. The `GameRoom` Durable Object holds what is
live. Nothing is in both.** A room's state is deleted when the game ends; the
result of that game is a D1 row written on the way out.

Full reasoning, schema, and the cost of using D1 rather than DO SQLite are in
`docs/architecture.md` §3. Identity and the record are in
`docs/identity-and-stats.md`.

### Migrations and seeds

Follow the Globetrotters pattern (`NoliCommoveri/Globetrotters`,
`src/lib/migrations.js` + `src/migrations/index.js`), not the Heritage-Hooves
append-only one. Heritage-Hooves carries 140+ forward-only files because its
data cannot be regenerated; most of this project's can be, with the one
exception noted below.

**Two lists, opposite rules.** One module is the only place `.sql` is imported,
and it exports both:

- `MIGRATIONS` — schema. Checksummed, applied once by **Apply pending**. An edit
  after it has run shows as *drift* on the admin page and is never silently
  reapplied.
- `SEEDS` — data. Every insert is `ON CONFLICT DO NOTHING`, and **Run seed**
  re-executes the whole list on every press. Seeds are never checksummed; that
  is what lets a puzzle bank, an avatar set, or a technique library grow by
  editing a file in the GitHub web editor.

**One migration file is one `batch()`.** D1 has no transaction spanning
batches, so a migration larger than one batch can half-apply. Keep the
quote-aware statement splitter and the chunking.

**Clear/delete is the schema-change path.** Do not write an `ALTER` chain.
Editing the schema file in place and pressing **Erase everything** → **Apply
pending** → **Run seed** is the normal way to change the schema. Erase drops
every table including the migration ledger, so the edited file is pending again
and the database rebuilds from the files as they now read. Discover drop order
by retrying until a pass drops nothing new — do not hardcode it.

**Export is a precondition for erase, not a nice-to-have.** The play record
(`docs/architecture.md` §3.1) is the one thing here that cannot be regenerated.
JSON export must exist before the first erase and re-import alongside it. Wire
the export into the erase confirmation itself rather than trusting anyone to
remember.

**Admin surface.** Three buttons plus a status table (applied / pending /
drifted), reachable in a browser, rendering before login and before any table
exists — a fresh database has neither. Show the failing statement and its error
on the page; there is no other way to see it. Model it on Globetrotters'
`/admin` and Heritage-Hooves' `src/render/migrations.ts`, which handles the
no-tables-yet case.

## Deployment

Push to `main`. Cloudflare's GitHub integration builds and runs `wrangler
deploy` on its own build machine. Nobody types a command. Build command is
empty and always will be.

## Rules the games follow

- **Pure core.** A game's `core/` never touches the DOM, `window`, or storage.
  It is importable by both the browser and the CI test runner, which is what
  lets the same tests cover both.
- **Rules modules never write.** The room writes results on completion, or a
  solo client posts once. A game that can write its own score is a game a
  12-year-old can write any score into.
- **Everything served lives under `public/`.** That is the Worker's assets
  directory; docs and tests are not published.
- **Chrome only, current.** The players are on Android phones and a Chromebook.
  ES modules, CSS grid, container queries, `:has()`, and CSS nesting are used
  without fallbacks. The 360px-wide phone in portrait is the binding layout
  constraint.
- **Sudoku only:** no module outside `sizes.js` may contain a literal `4`, `6`,
  `9`, `16`, `36`, or `81`. Enforced by a test that greps the core sources.
  `docs/sudoku/specs/slice-01-grid-generator-solo.md` §6 has the rule in full.

## Anything a phase cannot verify on its own is a setup task, not an acceptance criterion

Timing on the phone, a touch layout, a keyboard-only run, whether a 5-year-old
can find the start button — none of those can be closed by CI or by an agent,
and a criterion nobody owns is a criterion that gets assumed. They are written
down as `S`* items in `docs/sudoku/specs/questions.md` with the person and the
device named. `docs/design-language.md` §5 says how the hub's get written.
