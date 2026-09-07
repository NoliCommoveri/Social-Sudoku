# Slice 1 — Grid model, generator, solo play

Corresponds to `../design.md` §6 step 1. One grid size, no timer, no server,
no difficulty selection.

**Estimated cost:** Medium (20–60k). The generator is the only part with real
uncertainty; everything else is mechanical.

**Blocked on:** nothing.

**Assumes, per `questions.md`:** Q2 (node `--test` in CI plus a `/dev` page), Q3
(check button), Q4 (no pencil marks yet), Q7 (`localStorage` for the in-progress
board only).

**Setup tasks S1 and S2.** Four of the eight acceptance criteria below cannot be
reached from here: criterion 2 needs the repo connected to Cloudflare (**S1**),
and criteria 3, 5, and 6 need someone holding the phone and sitting at the
Chromebook (**S2**). Both are written out step by step in `questions.md`. The
order is: this slice's code merges → S1 → S2 → slice 1 is done. Criteria 1, 4,
7, and 8 are the ones the branch itself can turn green.

---

## 1. What exists at the end

A page you open, that deals a 9×9 puzzle you can solve with keyboard or touch,
that tells you when you have solved it, and that is still there when you come
back to the tab. Deployed at `carson-gameroom.<subdomain>.workers.dev` on every
push to `main`. No accounts, no timing, no server logic, no difficulty picker.

Building 9×9 first rather than 4×4 is deliberate: 4×4 is easier to eyeball but
hides every problem worth finding early — generation time, uniqueness-check
cost, and whether a 9-wide board is usable on a 360px Android phone. Slice 2
then adds 4×4 and 6×6, which is geometry and layout rather than new risk.

---

## 2. Files

```
wrangler.jsonc        worker config, read by Cloudflare's build
public/               the assets directory — everything here is served
  index.html
  dev.html            generator timing + visual spot-check
  src/
    core/
      sizes.js        the only place grid dimensions are written down
      grid.js         geometry: indices, units, peers
      rng.js          seeded PRNG
      generator.js    fill, count solutions, carve
    ui/
      board.js        render + input for one board
      board.css       board and cell rules, shared by index.html and dev.html
      app.js          wiring, new-game, completion
      celebrate.js    the win dialog: the words, the confetti, the two buttons
    store/
      local.js        localStorage read/write, versioned per-size keys
test/                 not served
  grid.test.js
  generator.test.js
  no-hardcoded-sizes.test.js
.github/workflows/test.yml
```

The board's own CSS is a file rather than a `<style>` block because both
`index.html` and `dev.html` render boards, and the box-border rules are exactly
what slice 2 has to change. Everything else stays inline in the page that uses
it.

Everything served lives under `public/`. Nothing else does — the repo's docs and
tests must not be published, and an assets directory pointed at the repo root
would publish them.

### `wrangler.jsonc`

```jsonc
{
  "name": "carson-gameroom",
  "compatibility_date": "2026-09-03",
  "assets": { "directory": "./public" }
}
```

Assets-only; there is no Worker script until slice 7, which adds `main` and the
Durable Object binding to this same file.

### Two constraints that exist now to keep slice 11 cheap

The PWA slice is last, and everything it needs is free if slices 1–9 respect
two rules and expensive to retrofit if they do not.

- **Every URL is relative.** No absolute paths, no origin-qualified URLs, no
  CDN. A service worker precaching an absolute path that later moves is the
  standard way to ship an app that will not update.
- **The served file set stays enumerable.** No dynamic `import()` of a computed
  path. Slice 11's service worker precaches an explicit list, and a list it
  cannot be checked against is a list that goes stale.

## 3. Representation

Decided here because everything downstream inherits it.

- **Cells are a single index**, `0 .. n²-1`, row-major. Not `[row][col]`. One
  index means peer sets are flat integer arrays and there is no row/col
  transposition bug to make.
- **Values are `Uint8Array(n*n)`**, `0` = empty, `1..n` = a digit.
- **Candidates are `Uint16Array(n*n)`** of bitmasks, bit `v-1` set means `v` is
  possible. `n ≤ 9` so a 16-bit lane is enough with room spare. Slice 5's solver
  is built entirely on these; slice 1 uses them inside the generator only.
- **Geometry is a value, not a global.** Every core function takes `geom` as its
  first argument.

### `sizes.js`

```js
export const SIZES = {
  4: { n: 4, boxW: 2, boxH: 2 },
  6: { n: 6, boxW: 3, boxH: 2 },
  9: { n: 9, boxW: 3, boxH: 3 },
};
```

Slice 1 ships all three entries and uses only `9`. Slice 2 is then a UI change,
not a model change.

### `grid.js`

```js
export const UNIT_KINDS = 3;   // row, column, box. Not a grid dimension.

makeGeometry({ n, boxW, boxH }) -> {
  n, boxW, boxH, cellCount,
  rowOf:  Uint8Array,       // cell -> row
  colOf:  Uint8Array,
  boxOf:  Uint8Array,
  units:  Uint8Array[],     // UNIT_KINDS * n arrays of n cell indices
  unitsOf: Uint8Array[][],  // cell -> its UNIT_KINDS units
  peersOf: Uint8Array[],    // cell -> its distinct peers
  ALL: number,              // (1<<n)-1
}
```

`UNIT_KINDS` is exported rather than written inline because a bare `3` in
`grid.js` is indistinguishable from a hardcoded box dimension, both to a reader
and to `no-hardcoded-sizes.test.js` (§6). It is a constant of sudoku, not of a
size: every cell is in exactly one row, one column, and one box at 4×4, 6×6, and
9×9 alike. Nothing else in `core/` may write `3` for that count — import this.

Built once per size and memoized on `${n}:${boxW}:${boxH}`. Building it is
cheap; the memo is so slice 5's solver can call `makeGeometry` freely without
thinking about it.

`boxW * boxH === n` is asserted. `boxW` is the box's width in columns, `boxH`
its height in rows — a 6×6 box is 3 wide and 2 tall, so there are 2 box-columns
and 3 box-rows.

### `rng.js`

`mulberry32(seed)` returning `() => float in [0,1)`, plus `shuffled(rng, arr)`.
Seeded and injected, never `Math.random()` inside core. Tests need determinism,
and a bad puzzle can be reproduced from its seed when someone reports one.

## 4. Generator

Three functions, each independently testable.

### `fillComplete(geom, rng) -> Uint8Array`

Randomized backtracking with MRV cell ordering — always fill the cell with the
fewest candidates next — and shuffled value order, maintaining candidate masks
incrementally rather than recomputing. At 9×9 with MRV this effectively never
deep-backtracks; no timeout needed.

### `countSolutions(geom, values, cap = 2) -> number`

The same search, counting rather than returning, stopping the moment the count
reaches `cap`. Every uniqueness check in this project uses `cap = 2` — nobody
needs the real count, only "is it more than one".

### `carve(geom, solution, rng) -> Uint8Array`

Walk cells in shuffled order. Remove one. If `countSolutions(..., 2) === 1`,
keep it removed; otherwise put it back. One pass.

This gives a set that is uniquely solvable and minimal *with respect to that
removal order* — not globally minimal, which nobody needs. Slice 3 turns the
removal into a difficulty by stopping it at a clue count (§4.3) rather than
running it to the end, so this pass is the one it parameterises.

**Q6: no symmetry.** See `questions.md`.

## 5. UI

Target devices are Android phones and a Chromebook, both current Chrome. ES
modules, CSS grid, container queries, `:has()`, and CSS nesting are all
available without fallbacks. No iOS, so no Safari workarounds.

### `board.js`

A CSS-grid board, one element per cell, no canvas — cells need to be
individually styled, focused, and later highlighted by the technique library
(§4.7), which is awkward on a canvas and free in the DOM.

- Box borders drawn from `boxW`/`boxH`, not hardcoded, so slice 2's 6×6 needs no
  change here.
- Givens are visually distinct from entered values and are not editable.
- One selected cell. Arrow keys and clicks/taps move it; digits `1..n` set it;
  `0`, backspace, delete clear it.
- Emits events; owns no game state. `app.js` owns state.

### Layout

The phone is the binding constraint. A 360px-wide viewport gives a 9×9 board
about 38px per cell after padding — under the 44px touch-target guideline, but
acceptable for a grid where a mis-tap is one undo away, and the alternative is
scrolling a sudoku board.

- **Narrow (phone, portrait):** board at full viewport width, keypad beneath it.
  Not beside — there is no room.
- **Wide (Chromebook, phone landscape):** keypad beside the board.

One container query switches between them, and that is all it switches: the
keypad itself is the same shape at both widths. Cell font size scales with cell
size.

The keypad is a calculator block, not a strip: `boxW` columns of digits, with
erase, undo and redo stacked in the column beside them, then check and new game
each spanning the full width beneath. At 9×9 the digits are a 3×3 square and the
action column is exactly as tall. Every key is placed from the geometry rather
than from a literal, so 6×6 and 4×4 get the same arrangement with fewer digit
columns — `app.js` computes the placement, the CSS only reads `--pad-cols`.

Both input paths are first-class rather than one being a fallback: the
Chromebook has a keyboard and typing is faster than tapping, the phone does not.

### `app.js`

- **New game** deals a fresh puzzle. Generation is synchronous and must stay
  under the §7 budget; if it does not, this becomes a Web Worker, and that is a
  slice 1 problem rather than a later one.
- **Undo/redo** over a full move stack. `Ctrl+Z` / `Ctrl+Shift+Z` plus on-screen
  buttons — the on-screen ones are not optional, the phone has no `Ctrl`.
- **Check** (Q3) marks currently-wrong cells against the solution. Marks clear
  on the next edit.
- **Completion** is detected on every edit: board full and equal to the
  solution. Records nothing — there is nothing to record until slice 9. It is
  fired from the transition rather than from the render, so reopening a board
  that was already finished does not congratulate you again. What it fires is
  `ui/celebrate.js`.

### `ui/celebrate.js`

Finishing a puzzle is the reason for doing one, so it gets the middle of the
screen: a modal dialog over a dimmed board, an exclamation in large type,
confetti across the viewport, and two buttons — deal another, or dismiss and
look at the finished grid. A line of status text saying *Solved.* is what a
spreadsheet does.

The line is drawn from a list and never repeats the previous one, and the list
mixes registers deliberately — *Great job!* and *Bruh, you slayed!* are for the
same popup, because the same popup has to land for a 5-year-old and a
12-year-old and one of them thinks the first is what you say to a toddler. The
subtitle names the board and how many squares were theirs, which is a better
thing to be told than *solved*.

Every line is short enough to hold one row at 360px — about eighteen characters
at the size it is set — because a shout that wraps is not a shout. The slang
half is the players' own and it is the half that dates; nothing depends on the
list's contents, so replacing a line is one string edited in the GitHub web
editor, by whoever is being congratulated.

It holds no game state. `app.js` decides when a puzzle is finished and hands it
the subtitle and the two things to do next. Under `prefers-reduced-motion` the
dialog and the words stay and the movement goes, because none of the movement
is carrying the message (`../../design-language.md` §2).

### `store/local.js`

Two key shapes, both under one `sudoku.v1.` prefix, and both settled here rather
than in slice 2:

- `sudoku.v1.game.<sizeKey>` — one in-progress board per size, holding
  `{ version, sizeKey, seed, givens, values, moveStack }`.
- `sudoku.v1.prefs` — UI preferences, `{ version, ... }`. Empty in slice 1.

Written debounced on change, read at startup. A version mismatch or a parse
failure discards that one key silently and deals a new game — this data is worth
nothing and must never block startup.

**The game key is per size even though slice 1 only ever writes
`sudoku.v1.game.9`.** Slice 2 adds the other two sizes and needs them keyed
separately; introducing the size suffix there instead would orphan every board
saved under the old key — silently, since a missing key is indistinguishable
from a first visit, and the orphan would sit in `localStorage` forever with
nothing left that reads it. `SIZES` already ships all three entries (§3), so
writing the suffix now costs one template literal and removes the migration
entirely. Slice 2 changes nothing in this module.

A key naming rule falls out of that, and it is the actual lesson: **the `v1` is
for a change in the shape of a value, not for a change in which values exist.**
Anything that will eventually be stored per size, per player, or per tier gets
that dimension in its key on the day the key is invented, whether or not more
than one value of it exists yet.

## 6. Tests

`node:test` + `node:assert`, no dependencies, run in CI (Q2).

**`grid.test.js`**
- For each of 4/6/9: every cell is in exactly `UNIT_KINDS` units; every unit has `n` distinct
  cells; peer count is `2(n-1) + (boxW*boxH - 1) - (boxW-1) - (boxH-1)` — 20 at
  9×9, 12 at 6×6, 7 at 4×4.
- Peering is symmetric: `b ∈ peersOf[a] ⟺ a ∈ peersOf[b]`. No cell is its own
  peer.
- `makeGeometry` returns the identical object for repeated calls (memo).

**`generator.test.js`**
- `fillComplete` output is a valid complete grid: every unit is a permutation of
  `1..n`. 200 seeds, all three sizes.
- Same seed twice gives an identical grid; different seeds differ.
- `countSolutions` on a complete grid is 1; on an empty 4×4 grid is 288 with
  `cap = Infinity` — a known constant, and a real check that the counter is not
  quietly wrong; on a grid with one cell emptied is 1.
- `carve` output is uniquely solvable over 100 seeds at 9×9.
- `carve` output is a subset of its solution: every non-zero clue matches.
- Removing any single further clue is *not* tested. That is global minimality
  and `carve` does not promise it.

**`no-hardcoded-sizes.test.js`**

Reads every file in `public/sudoku/core/` except `sizes.js` and fails on a
standalone numeric literal drawn from the banned set:

```
4  6  9  16  36  81
```

— the three side lengths and their cell counts. `2` is **not** banned. It is a
legitimate box dimension at 4×4 and 6×6, but it is also `1 << 2`, `n / 2`, and a
dozen other honest uses; a rule that fires on all of them is a rule that gets
suppressed everywhere and then defends nothing.

`3` is not banned outright either, and this is the case worth being explicit
about. It is a box dimension at 6×6 and 9×9 — exactly what the rule exists to
catch — *and* it is the number of units a cell belongs to, which is true at every
size and appears in `grid.js` for honest reasons. A blanket ban collides with
that second meaning on the first file the rule is applied to. So:

- `3` is banned everywhere in `core/` **except** on the line declaring
  `UNIT_KINDS` in `grid.js` (§3).
- That exemption is one exact string, written in the test file itself. It is not
  a comment marker anyone can sprinkle on a new line — a suppression that any
  file can opt into is not an enforcement mechanism.
- Any other structural count that turns out to be a genuine `3` gets the same
  treatment: a named export, and a second entry in the test's exemption list.
  Adding an entry is a deliberate two-file change, which is the point.

Crude, and it is the only mechanical defense of the §4.1 rule, which is
load-bearing for slice 2.

## 7. Acceptance criteria

Each is marked with who can close it: **CI** (the workflow proves it), **local**
(checkable in any browser, including mine), or **S1** / **S2** (a setup task in
`questions.md` — needs the Cloudflare dashboard, or the actual phone and
Chromebook). The marked ones are the reason S2 exists as a numbered task rather
than as an assumption that someone will get round to it.

| # | Criterion | Closed by |
|---|---|---|
| 1 | `node --test` passes; the Actions workflow is green on the branch. | CI |
| 2 | A push to `main` deploys, and the workers.dev URL serves the game. | **S1**, then S2 step 1 |
| 3 | Dealing a 9×9 puzzle completes in **under 250ms** at the 95th percentile over 100 deals. Hard fail above 1s. | **S2** step 2 |
| 4 | Every dealt puzzle has exactly one solution. | CI, spot-checked local |
| 5 | A full 9×9 solve on the Android phone in portrait — no keyboard, no horizontal scroll, no pinch-zoom. | **S2** step 3 |
| 6 | A full 9×9 solve on the Chromebook using only the keyboard. | **S2** step 4 |
| 7 | Reload mid-puzzle restores the board, the givens, and the undo stack. | local |
| 8 | `public/sudoku/core/` imports nothing — not from `ui/`, not from `node:`, not from a URL. | CI |

Criterion 3 is measured by `dev.html` on the phone and is deliberately not
asserted in CI: a CI runner's speed says nothing about an Android phone, and an
assertion that passes on the wrong hardware is worse than no assertion. Criterion
8 is a test — walk `core/`, parse every `import` statement, fail on any specifier
that is not a relative path inside `core/`.

Criteria 5 and 6 are the ones that decide whether the layout survives. They are
also the ones furthest from the branch: they need a merge and a deploy first, so
they cannot gate the pull request. They gate slice 2 instead — do not start
building on `board.js` until S2 comes back clean.

## 8. Explicitly not in this slice

Named so they do not creep in: difficulty tiers, the logical solver, hints,
pencil marks, timing, stats, 4×4 and 6×6 in the UI, player names, the service
worker and manifest, anything server-side.
