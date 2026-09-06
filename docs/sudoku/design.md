# Family Sudoku — High-Level Design

Status: design sketch. Everything below marked **Rec** is a recommendation with alternatives, not a settled decision. Revisit triggers are noted where they exist.

---

**Sudoku inside the Carson Family Gameroom.** This document covers the game:
puzzles, difficulty, modes, and the technique library. Everything shared with
the other games — the Cloudflare stack, identity, the play record, the
multiplayer room — lives in `../architecture.md`, `../identity-and-stats.md`
and `../gameroom.md`. Phase ordering for the whole site is `../../ROADMAP.md`;
§6 below is the sudoku-only slice order that feeds it.

## 1. Requirements

| # | Requirement | Notes |
|---|---|---|
| R1 | Race mode (multiplayer) | Same puzzle, independent boards, first to finish |
| R2 | 4×4, 6×6, 9×9 grids | Box shapes 2×2, 3w×2h, 3×3 |
| R3 | Per-player difficulty on the same puzzle | Via clue-superset layering (§4.3) |
| R4 | Win tracking | Per player, per mode, per grid size |
| R5 | Solo timer mode with best times | Keyed by grid size × difficulty tier |
| R6 | Technique teaching | Static curated examples, not live trace (§4.7) |

---

## 2. Architecture

Sudoku is one game module inside the hub Worker. It serves from `public/`, and
its multiplayer modes route WebSocket upgrades to the shared `GameRoom` Durable
Object. The stack as a whole is `../architecture.md`.

```
Browser (SPA at /sudoku/)
  │  HTTP (static assets, puzzle gen is client-side)
  │  POST /api/plays on completion
  │  WebSocket (race mode only)
  ▼
Worker  ──┬── D1        players, plays, play_results
          └── GameRoom DO   live race state, one per room code
```

**Solo and technique modes never touch the room.** No socket, no Durable
Object — a static page plus one write on completion. Routing them through
`GameRoom` for consistency would be slower and more fragile than the file it
replaced.

**Rec: puzzle generation runs client-side.** Keeps Worker and DO CPU near zero.
*Alternative:* generate in the Worker. *Would revisit if:* you want
server-authoritative anti-cheat — and note that for race mode the relevant
decision is not where generation runs but whether the seed is sent to the
client, since a seed determines the solution. `../architecture.md` §7.

**Results live in D1, not in the Durable Object.** The room writes on
completion; the rules module never writes. Schema in `../architecture.md` §3.1.

### 2.1 DO constraints that shape the code

- Use the **WebSocket Hibernation API** (`ctx.acceptWebSocket`, `webSocketMessage`/`webSocketClose` handlers). Not `ws.accept()`.
- Hibernation re-runs the constructor. In-memory state does not survive. Per-socket identity must go through `serializeAttachment` / `deserializeAttachment`, and the socket list is recovered via `ctx.getWebSockets()`.
- No `setTimeout` / `setInterval` — they block hibernation. Use the Alarms API if you need scheduled work.
- Free plan is SQLite-backed DOs only. That's the recommended backend anyway.

---

## 3. Module dependency order

```
grid-model ──► generator ──► difficulty-tiers ──► solver
                  │            │             │
                  │            ├──► hints    │
                  │            └──► rating   │
                  ▼                          ▼
             session-model ◄─────────────────┘
                  │
                  ├──► sync-layer (DO)
                  ├──► stats-store
                  └──► ui
                          └──► technique-library (independent, can be built anytime)
```

`technique-library` has no dependencies on anything but the board renderer — good candidate for an early standalone slice if you want a visible win.

---

## 4. Core modules

### 4.1 Grid model

Size-parameterized from the start: `{ n, boxW, boxH }` for 4/6/9. Peers (row, column, box) computed from those three numbers. Nothing else in the codebase should hardcode 9.

### 4.2 Generator

Backtracking fill for a complete valid grid, then remove clues while a **solution counter** confirms uniqueness (count solutions, stop at 2), stopping at the clue count the chosen difficulty asks for (§4.3). Fast enough at 9×9 to be imperceptible — around 1ms a deal.

Removal stops at the target, not at a *minimal* clue set. A minimal set is the hardest puzzle a solution grid can make — about 24 givens at 9×9, over half of them not solvable by singles at all — because uniqueness constrains the solution, not the path to it. Nothing here deals one.

A short add-back pass follows, and does nothing on most deals: it exists for the occasional carve that closes down below its difficulty's openness floor (§4.3).

### 4.3 Two difficulty axes

Difficulty has a size and a shape. They are independent, and a puzzle needs both set to be pleasant.

**Size — how many clues.** Tiering by clue count, held exactly:

| Tier | 4×4 | 6×6 | 9×9 | 9×9 cells to fill |
|---|---|---|---|---|
| Easy | 9 | 20 | 50 | 31 |
| Medium | 7 | 16 | 40 | 41 |
| Hard | 5 | 12 | 32 | 49 |

`carve` stops removing when it reaches the count rather than reducing to a minimal set, so a tier is the same amount of work every time it is dealt. `SIZES[<size>].tiers` holds the numbers.

The numbers are measured. Easy at 9×9 leaves 31 cells with around 22 findable at any moment — two children, ten minutes, never stuck. Hard sits a little above 30 clues, which is where singles stop being enough and a 9×9 stops being a game and starts being work.

**Shape — openness.** A *round* is one sweep of the board: every cell findable right now by a naked or hidden single. A puzzle's **openness floor** is the fewest cells any round offers. Rounds that finish the board are excluded — their count is low because the puzzle is ending, not because it is tight, and counting them would fail every puzzle ever made.

Clue count says nothing about openness. A board can hold plenty of clues and still close into a single-file corridor — one findable cell, then another, nothing else on offer — which is what makes a child stare at a grid for two minutes. At the clue counts above a carve clears its floor unaided nearly every time, so the floor is a guarantee rather than a lever: it catches the deals that close down, and clues are added back until they do not.

**Both axes move the same lever: adding clues from the solution to a uniquely-solvable set.** Any superset of a uniquely-solvable set is still uniquely solvable — so all players share one solution grid, guaranteed, whatever tier they're on. The tiers of one seed are nested for the same reason: they are prefixes of one removal order over one solution, so tier Hard ⊂ Medium ⊂ Easy.

**Rec:** clue count, not the hardest technique required. *Alternative:* tier by technique ceiling — Easy solvable by singles, Medium needing naked pairs, Hard needing pointing pairs. *Would revisit if:* the players outgrow the hard tier, which would be a good problem to have.

The alternative was measured and does not describe this family's difficulty. At 9×9 singles suffice down to about 32 clues; naked pairs and pointing pairs only start mattering below 30, which is harder than the hard tier here. A technique ceiling would have left all three buttons dealing the same kind of puzzle, and it varies deal to deal in a way a clue count does not.

### 4.4 Reduced logical solver

Four techniques: naked single, hidden single, naked pair, pointing pair. Each returns `{ technique, cells, eliminations }` or null.

Deliberately excludes X-wing and everything past it. *Would revisit if:* the players outgrow what it teaches, which would be a good problem to have.

Serves: hints and the technique library (§4.7), and the optional "what applies here?" bridge (§7.3). Not difficulty — that is clue count (§4.3), which needs no solver. The reduced solver inside `measureOpenness` is the singles half of this, and predates it.

### 4.5 Session model

```
Session {
  familyCode, mode: race|solo,
  gridSize, solutionGrid,
  players: [{ id, name, tier, board, assists, startedAt, finishedAt }]
}
```

Per-player board state is separate, which is what lets players race the same puzzle at different tiers.

### 4.6 Stats store

D1 at the hub, shared with every other game: `plays` and `play_results`
(`../architecture.md` §3.1). Sudoku writes one `plays` row per board finished
and one `play_results` row per player, with `unit` of `'seconds'`.

R4 and R5 are both reads off that. Best times are a query, not a table —
`MIN(value)` grouped by size and tier — so there is nothing to keep in sync.
Per-player identity, and why renaming a player never orphans their times, is in
`../identity-and-stats.md`.

### 4.7 Technique library

Static data, not screenshots. Each entry:

```
{ id, name, gridSize, cells[], highlight[], caption }
```

Rendered through the same board component as live play. Standard technique names (naked single, hidden single, pointing pair) so the terms are searchable later.

---

## 5. Modes

**Solo + timer (R5).** Pure client apart from the stats write, which goes to the DO like every other stat (§4.6). Play itself needs no server; recording a best time does.

**Race (R1).** Shared puzzle, per-player tier, independent boards. DO broadcasts progress (cells-filled count, not contents) and finish events.

---

## 6. Suggested slice order

1. Grid model + generator + solo play, one grid size — no timer, no server
2. All three grid sizes
3. Difficulty tiers, the openness floor, and the picker (R3)
4. Pencil marks
5. Reduced logical solver (§4.4) — core only, no UI
6. Technique library (R6) + the hint button
7. Storage foundation — the DO, the schema, migrations, the admin page
8. Erase, JSON export, and re-import — completing the admin surface
9. Timer + stats + best times (R5, R4) — first fully useful thing
10. WebSocket sync + race mode (R1, R3)
11. PWA — manifest, service worker, install to homescreen

Slices 1–6 have no server dependency, and they ship R2 and R6 in full plus the tiering mechanism R3 rests on. R1, R4, and R5 all need the DO, because every stat this project keeps lives in DO SQLite (§4.6) and none of it is mirrored client-side. If Cloudflare setup stalls, what still ships is solo play at three sizes and three difficulties with the technique library — not four of six requirements.

**Why the tiers do not wait on the solver.** Difficulty is clue count (§4.3), and a clue count needs no rating function: `carve` already knows how many clues it has removed. Step 3 is therefore a clue target, a table of them, and a picker — and it can ship before anything in §4.4 exists. The openness floor belongs to the same step because it is the other half of the same question and shares the same add-back pass.

**Why the solver comes after the tiers rather than before them.** It serves hints and the technique library, and nothing else — difficulty does not need it. Building it earlier would mean a session that produces nothing playable, for a caller that does not exist yet. Step 5 is four pure functions testable against hand-built fixtures; step 6 is the library those fixtures are written as, and the hint button that links a live board to them (§4.7). The split is between the deduction and its presentation, which is the only boundary in this pair that costs nothing to cut.

**Why pencil marks are their own step.** They are a UI feature on top of a board that already deals at three difficulties, and nothing in step 3 needs them: at the easy tier's clue counts, no cell needs a note kept on it. Bundled into step 3 they would be the half that overruns the session.

**Why the storage foundation is two slices, and why both come before the timer.** Step 7 is the first slice that writes a row, and `CLAUDE.md` specifies a surface around that write which is larger than it looks: two lists with opposite rules (`MIGRATIONS` checksummed and applied once, `SEEDS` re-run on every press), an admin page that renders before login and before any table exists, drift reporting, a quote-aware statement splitter, per-DO erase, and JSON export with re-import. That is more than one session, so it is cut — but not between erase and export, which `CLAUDE.md` binds together: erase is the schema-change path, so export must exist before the first erase and re-import alongside it, wired into the erase confirmation itself. The available cut is in front of all three. Step 7 stands up the DO, the schema, and apply/seed/status; step 8 adds erase, export, and import.

What makes that cut safe is that there is one DO per family code: before erase exists, a schema change is a file edit plus an unused code, which is a database with no tables. That escape hatch expires the moment there is data worth keeping, which is why step 8 sits before the timer rather than after it. Bundling any of this behind WebSocket hibernation work would mean debugging two hard things at once.

Slice 11 is last by choice, not by dependency — solo play is entirely client-side, so it is offline-capable from slice 1 onward and the PWA slice only has to declare that. Two rules keep it cheap: every URL stays relative, and the served file set stays enumerable. Both are recorded in `specs/slice-01-grid-generator-solo.md` §2.

Implementation specs for the spec'd slices are in `specs/`; open decisions and
things needed from outside the code are in `specs/questions.md`.

---

## 7. Open decisions

### 7.1 Identity

Family code + player name, no passwords, is probably right for a household. Tradeoff: anyone with the code is in, and name collisions overwrite stats. *Would revisit if:* the link ever leaves the family.

### 7.2 No-guess lock

Timed play rewards brute-force guess-and-undo, which cuts against the teaching goal. Options: a setting that rejects logically-undetermined entries, separate leaderboards for timed vs learning play, or accept it.

*No recommendation yet* — depends on whether the kids actually do it. Cheap to add later.

### 7.3 Live technique bridge

Optional later addition: a "what technique applies here?" button running the §4.4 solver, outputting technique name + highlighted cells, linked to the static example. No prose generation. Small, given the solver already exists.

---

## 8. Risks

- **Hibernation state loss** — the classic "works ~10 seconds then messages stop" bug. Mitigated by getting `serializeAttachment` right early. Build a two-tab reconnection test before building on top of the sync layer.
- **Best-time noise** — puzzle-to-puzzle variance within a tier is large. A fixed clue count per tier (§4.3) reduces it more than technique tiering would, and does not eliminate it.
- **Transfer gap** — static examples teach vocabulary, not recognition. Expected, not a defect. §7.3 is the mitigation if it matters.
- **Scope** — six requirements, three of them (solver, sync, teaching) independently non-trivial. The slice order in §6 is designed so you can stop after step 5 and still have something the kids use.
