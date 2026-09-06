# HISTORY

Removed features, parked decisions, and superseded designs. **Not read at
session start.** Consult only when troubleshooting an unexplained behavior or
when reopening one of the parked decisions below.

Nothing here describes current state. `ROADMAP.md` and the docs it links do.

---

## Coop mode — removed 2026-09-03

Cut from the design as out of scope. Head-to-head and solo were judged far more
important. Removed the requirement, the mode section, the final slice, and the
unresolved shape decision; remaining requirements renumbered R1–R6.

The analysis below is what was parked. It is the reason not to reopen this
without deciding the tier question first.

### The problem

Per-player difficulty (now R3) is delivered by clue-superset layering: every
player solves the same solution grid, and easier tiers get *more* givens. That
works because each player has their own board. Coop breaks it, because a shared
board shows everyone the same cells the moment it renders — there is nowhere to
put the extra givens.

### The two shapes considered

**Option A — separate boards, synced progress.** Each player keeps their own
board and tier; a cell correctly filled by one player fills for both. Preserves
per-tier givens and reuses the race-mode session model unchanged.

**Option B — one shared board.** Differentiation moves off the grid and onto
assist level: pencil marks, auto-check, hint budget.

### Why A was the initial lean, and why that was wrong

A was preferred because it kept R3 intact across both multiplayer modes and
required no new session model.

The objection that changed the answer: A and R3 actively fight each other. A
lower-tier player has strictly more givens and needs strictly fewer deductions,
so they finish meaningfully faster — and under A every cell they fill lands on
the higher-tier player's board. The younger child ends up solving the older
child's puzzle for them. That inverts the point of a cooperative mode rather
than scaffolding it.

Option B has no such failure, and it is also the more genuinely collaborative
shape — the kids look at one board together, which was the original appeal. Its
cost is that R3 stops being one mechanism across all modes and becomes
"per-player *difficulty* in race and solo, per-player *support* in coop."

### If this is reopened

Start from B, not A. Prototype it once the race-mode sync layer exists; it needs
no board-propagation sync at all, which is the expensive part of A. Test with
the kids before committing either way.

---

## Technique-ceiling difficulty tiers — superseded 2026-09-06

Difficulty was originally tiered by the hardest technique a puzzle required:
tier 1 solvable by naked and hidden singles, tier 2 needing naked pairs, tier 3
needing pointing pairs. `carve` reduced a solution to a minimal clue set and a
binary search added clues back until a `rate` function said the set had reached
the target tier. Two slices were spec'd around it — a solver-and-rating slice
producing `rate`, proven monotone so the search was valid, and a tiering slice
running the search under a retry budget.

Replaced by clue count (`sudoku-design.md` §4.3): each tier names how many
givens it deals and `carve` stops there.

### Why

Measured, at 9×9, over 40 deals per clue count — the fraction of carved boards
solvable by naked and hidden singles alone:

| Clues | 50 | 44 | 40 | 36 | 32 | 30 | 28 | 26 |
|---|---|---|---|---|---|---|---|---|
| Solvable by singles | 40/40 | 40/40 | 40/40 | 39/40 | 39/40 | 35/40 | 26/40 | 19/40 |

Singles suffice down to about 32 clues. Naked pairs and pointing pairs only
start deciding anything below 30, which is harder than the hardest tier this
project deals — so all three technique tiers would have dealt the same kind of
puzzle, distinguished by a label. The players are 11 and 12 and the youngest was
already struggling with what the openness floor alone produced (~31 givens).

Clue count also removed machinery rather than adding it: no `rate`, no
monotonicity proof, no binary search, no retry budget, no honouring-the-label
re-carve. Deals got 5–7× faster, because a carve that stops at 50 clues runs a
fraction of the uniqueness checks a minimal carve does. And a tier became exact
— Easy is 50 clues every time, where the search-based tiers varied deal to deal.

### What was removed

- `specs/slice-03-solver-and-rating.md`'s rating half: `rate`, `MAX_TIER`, the
  monotonicity property and its test group. The solver survives as
  `specs/slice-05-solver.md`, serving hints and the technique library only.
- `specs/slice-04-difficulty-tiers.md` entirely, replaced by
  `specs/slice-03-difficulty-tiers.md`.
- `specs/slice-025-openness-floor.md`, whose openness floor folded into that
  same slice — it is no longer a defect fix against minimal carves, because
  nothing deals a minimal carve. The floor itself is unchanged and still
  enforced on every deal; it just fires on fewer than one deal in ten now.

### If this is reopened

The technique functions in slice 5 are what a `rate` would be built from, and
nothing about them was compromised to make this change — `solveLogically` still
takes an `allowed` set. What would have to come back is monotonicity: it was
never proven, because nothing came to need it. Reopen this only if the players
outgrow a 32-clue 9×9, which is the good version of this problem.

---

## Standalone sudoku — folded into a games hub 2026-09-06

The project was a single-game site: `Social-Sudoku`, one Worker, one Durable
Object per family code owning both live session state and historical stats. It
is now the Carson Family Gameroom — one site, several games, shared profiles
and a shared play record. The pre-pivot tree is the `v0-standalone-sudoku` branch, at `a4718f6`.

Current state is `ROADMAP.md` and `docs/architecture.md`. What follows is only
what was superseded and why, for anyone wondering where a decision went.

### Stats moved from DO SQLite to D1

The design put `results` and `bests` in the family Durable Object's SQLite, with
one DO per family code, on the reasoning that it kept everything in one
consistency domain and avoided a separate database.

Three things broke that. There is exactly one family, so per-family-code
tenancy was solving a problem that does not exist. Stats became cross-game, and
a DO scoped to a room cannot answer a question spanning games it never hosted.
And profiles are read to paint the hub's landing page, which would mean waking
a Durable Object to render a front page.

The cost paid: DO SQLite has `ctx.storage.transactionSync()`, so the D1
half-applied-migration trap did not apply and the design said so explicitly.
D1 re-introduces it. The mitigation is the one-migration-is-one-`batch()` rule
in `CLAUDE.md`, and the Globetrotters reference already handles it.

The Durable Object survives, narrowed: live room state only, disposable, one
instance per room code.

### Slice 7 superseded

`slice-07-storage-foundation.md` built the storage layer against DO SQLite. Its
migrations-and-seeds machinery, drift reporting, statement splitter and admin
page carry over almost whole into Phase 2; only the target changed. The file is
kept for that machinery, not for its architecture.

### The repo was not migrated

Both imported design documents said everything moves to a new repo, marked
Decided. It was rejected in favour of renaming and restructuring in place:
history is the answer to "why is this like this" and this project has already
needed it once, and the Cloudflare build connection was working and would have
had to be rebuilt. The repo was renamed `carson-gameroom` and the tree moved
under `public/sudoku/` in place; GitHub redirects the old name.

### The Vite base-path problem was never real here

Both imported documents warn that each client bundle must build with its own
base path (`/pit/`, `/sudoku/`) and call missing it the most common first-deploy
failure. That is a bundler problem — a bundler rewrites asset URLs at build time
and must be told the prefix. There is no bundler. Relative imports resolve at
whatever depth the file sits.

### Cooperative sudoku stayed cut

`docs/gameroom.md` §5 uses cooperative mode as a worked example and rests its
main argument on race and cooperative having opposite state topologies. That
document was written without knowledge of the coop removal recorded above. The
conclusion still holds on Pit-versus-sudoku-race alone. Coop remains cut, and
the condition for reopening it is unchanged.
