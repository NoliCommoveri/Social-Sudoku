# Slice 5 — Reduced logical solver

Corresponds to `sudoku-design.md` §6 step 5, implementing §4.4. Core only: four
technique functions and the loop that drives them. No UI, no hints, no library
page, nothing that touches the DOM.

**Estimated cost:** Small–Medium.

**Blocked on:** nothing.

**Hands to slice 6:** four technique functions that each explain themselves —
which cells justify the deduction, in which unit — and a set of fixtures already
written in the technique-library shape. Slice 6 renders both.

---

## 1. Why this is separate from the library it serves

The solver finds a deduction; the library and the hint button present one. They
are different work against different failure modes — a wrong technique function
is a wrong answer on a seven-cell fixture, a wrong hint is a layout problem —
and cutting between them is the only boundary in the pair that costs nothing.

The solver does not tier puzzles. Difficulty is clue count (`sudoku-design.md`
§4.3), settled in slice 3 without any of this. Nothing in this project asks how
hard a clue set is, so nothing here returns a rating.

---

## 2. Files

```
public/src/core/
  solver.js        initState, applyStep, solveLogically
  techniques.js    the four technique functions
  fixtures.js      hand-built technique examples (see §6)
test/
  techniques.test.js
  solver.test.js
```

`fixtures.js` lives in `core/` rather than `test/` because slice 6 serves it to
the browser as the technique library's content. It is data, it is imported by
both the test runner and the page, and it obeys every `core/` rule including the
`no-hardcoded-sizes` grep.

## 3. Solver state

```js
State = { values: Uint16Array?, cands: Uint16Array }   // cands: bitmask per cell
```

Built from a clue set by `initState(geom, clues)`: every filled cell's value is
its only candidate, every empty cell starts at `geom.ALL`, then each clue
eliminates itself from its peers.

The solver never guesses and never branches. It is a confluent elimination
process: applying an available technique never removes a deduction that another
technique would have found. That is what lets the hint button ask "what applies
here?" and get an answer that stays true if the player finds a different move
first, so nothing may be added to this module that breaks it.

## 4. Techniques

Four, per `sudoku-design.md` §4.4. Each is a pure function with the same shape:

```js
technique(geom, state) -> Step | null

Step = {
  technique: 'naked-single' | 'hidden-single' | 'naked-pair' | 'pointing-pair',
  cells: number[],          // the cells that justify the deduction
  unit: number | null,      // the unit it was found in, for highlighting
  placements: [{ cell, value }],
  eliminations: [{ cell, value }],
}
```

Returning a `Step` rather than mutating is what lets the same four functions
serve slice 6's hint button, its technique library, and the §7.3 bridge without
a second implementation. `applyStep(state, step)` mutates; the
technique functions never do.

| Technique | Rule |
|---|---|
| Naked single | A cell with one candidate |
| Hidden single | A value with one possible cell in a unit |
| Naked pair | Two cells in a unit sharing the same two candidates; eliminate those two values from the unit's other cells |
| Pointing pair | A value confined within a box to one row or column; eliminate it from the rest of that row or column |

Deliberately absent: box-line reduction's converse (line-box), naked/hidden
triples, X-wing and beyond. §4.4 draws the line and this slice does not move it.

`solveLogically(geom, clues, allowed) -> { solved, steps, state }` loops the
allowed techniques cheapest first, applying the first that fires, until the
board is solved or nothing fires. `allowed` exists so the hint button can offer
the simplest move available rather than the cleverest.

## 5. Fixtures

Each technique gets a hand-built clue set where it is the *only* technique that
fires, and one where it must not fire. Written in the technique-library shape
from the start (`sudoku-design.md` §4.7):

```js
{ id, name, gridSize, cells, highlight, caption }
```

Slice 6 renders these through `board.js` and gets its content for free. Building
them in this shape costs nothing now — they have to be written down either way —
and retrofitting the shape later means rewriting every one of them. Prefer 4×4
and 6×6 boards where the technique is legible at a glance; a naked single needs
no 81 cells to demonstrate.

## 6. Tests

1. **Technique isolation.** For each of the four: a fixture where it is the only
   technique that fires, and a fixture where it must not fire. The negative case
   is the one that catches an over-eager implementation, which is the failure
   mode that corrupts a rating rather than crashing it.
2. **Step shape.** Every returned `Step` names cells that actually justify it:
   the eliminations follow from the cells, and the cells are all in `unit` where
   `unit` is not null.
3. **Purity.** Calling a technique function twice on the same state returns the
   same `Step` and leaves the state byte-identical. `applyStep` is the only thing
   that mutates.
4. **Solver soundness.** Over 200 generated deals, every placement
   `solveLogically` makes agrees with the known solution. A logical solver that
   places a wrong digit is worse than no solver.
5. **Stalling is reported, not guessed at.** On a clue set the allowed
   techniques cannot finish, `solveLogically` returns `solved: false` with the
   steps it did find — it never places a digit it cannot justify.

## 7. Acceptance criteria

1. `node --test` passes; the workflow is green.
2. All five test groups above exist and pass.
3. The four technique functions are called by nothing outside their own tests —
   there is no caller until slice 6, and that is correct.
4. `public/src/core/` still imports nothing outside itself, and
   `no-hardcoded-sizes.test.js` passes with its one exemption (`UNIT_KINDS`).
   `fixtures.js` obeys that grep like every other file in `core/`, which means
   its boards are written as strings rather than as arrays of digits.
5. Nothing in `public/src/ui/` changed.

Criterion 5 is the one that keeps this slice the size it is. If a UI file needed
touching, the split was drawn wrong and it is worth saying so before continuing.

## 8. Explicitly not in this slice

The hint button, the technique library page, any rating of a clue set, timing,
stats, anything server-side. Naked triples and X-wing are not in this slice and
not in this project.

The app looks exactly as it did at the end of slice 4.
