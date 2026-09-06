# Slice 6 — Technique library and hints

Corresponds to `../design.md` §6 step 6, implementing §4.7 and the hint
button. The last slice with no server in it.

**Estimated cost:** Medium (20–60k). Most of it is content and CSS; the only
logic is the reveal state machine and one precondition check.

**Blocked on:** slice 5, which is where the four technique functions and the
fixtures this renders are built. Slice 4 too, in practice: a hint that names a
naked pair is hard to act on without pencil marks to have been reasoning in.

**Closes `../design.md` §7.3.** The "what technique applies here?" bridge is
this slice's level-1 reveal (§5). It is listed there as an optional later
addition; it is free once the hint holds a `Step`, so there is nothing left for
a later slice to add.

---

## 1. What exists at the end

A library page that teaches the four techniques, one worked example each,
rendered through the same board component as live play. A hint button that names
the technique that applies, then shows where, then does it. The difficulty
picker's technique names link into the library, so the words on the button and
the words on the page are the same words.

Still no timing, no stats, no server. This is the last slice that ships without
one, and `../design.md` §6 is arranged so that stopping here leaves
something the kids use.

## 2. Files

```
public/
  library.html            second page, not an SPA route
  src/
    core/
      fixtures.js         grows: every library entry lives here (slice 3 §6)
      solver.js           gains one export, firstStep (§5)
    ui/
      board.js            gains read-only rendering and highlight roles (§3)
      library.js          renders fixtures.js into library.html
      hint.js             the reveal state machine
      app.js              wires the hint button, counts assists
test/
  fixtures.test.js
  hint.test.js
```

**A second HTML file rather than a route.** There is no router and this slice is
not the place to introduce one. Two pages, both reached by relative links, keeps
the served file set enumerable — slice 11's service worker precaches an explicit
list and slice 1 §2 made that a standing rule. A router is worth writing when
there are five pages.

## 3. What `board.js` gains

```js
render(geom, { values, givens, highlight, readOnly })
```

`highlight` carries three roles, and they are the three parts of a `Step`
(slice 5 §4):

| Role | From a `Step` | Means |
|---|---|---|
| `subject` | `step.cells` | the cells that justify the deduction |
| `unit` | `step.unit`, expanded | where it was found |
| `target` | `step.placements` + `step.eliminations` | what it changes |

That mapping is the point of the slice: a library entry and a live hint are
highlighted by the same three roles through the same code, so the picture a
child learns on the library page is the picture the hint draws on their own
board. A fixture that highlighted by hand would drift from what the hint shows.

`readOnly` removes the focus ring and the input listeners. Library boards are
not playable, and a board that accepts a digit and then discards it on scroll is
worse than one that never invited the tap.

**Roles must differ by more than hue.** The three land on adjacent cells, often
in the same unit. Each gets a distinct treatment — a fill, an outline, a
corner mark — so the picture survives a colour-blind reader and a phone in
sunlight.

## 4. The library

Content is `fixtures.js`, written in the `{ id, name, gridSize, cells,
highlight, caption }` shape since slice 5 §5 precisely so this slice has nothing
to convert.

- Entries gain one field, `role: 'example' | 'counterexample'`. Slice 5 built
  both kinds for its isolation tests; the library renders the examples.
  Counterexamples stay test-only until someone writes a caption aimed at a
  reader rather than at an assertion — at which point it is a flag and a
  sentence, not a new file.
- **Ids are the link contract.** The primary example for a technique has `id`
  equal to the technique string exactly (`naked-single`, `hidden-single`,
  `naked-pair`, `pointing-pair`). Further examples suffix it (`naked-pair-2`).
  The hint links to `library.html#<technique>` without knowing what examples
  exist, which only works if that id is reserved.
- Order is tier order, cheapest first. The reading order is the learning order.
- Each entry renders a heading, the board, the caption, and a legend for the
  three roles.
- Prefer 4×4 and 6×6 boards. A naked single does not need 81 cells to be
  demonstrated, and the phone is 360px wide.

## 5. The hint

### What it runs on

The **current board**, not the original clue set: `initState(geom, currentValues)`.

Pencil marks are ignored. They are the player's notes, they are frequently
wrong, and a hint computed from them would hand a child their own mistake back
with the solver's authority behind it.

### The precondition, which is most of the correctness here

Before computing anything, the hint checks every filled cell against
`solution`. If one disagrees, it says so and offers Check (Q3) instead of a
technique.

This is not defensive coding. A wrong entry does not merely block deductions —
it *manufactures* them, and the manufactured ones look exactly like the real
ones. A "naked single" derived from a wrong digit places a second wrong digit,
under a heading that says the solver is certain. The board most likely to be in
that state is a beginner's, forty moves in, which is the board most likely to
have the hint pressed on it.

Comparing against `solution` is exact, costs one pass, and is available only
because generation is client-side (`../design.md` §2) — the solution is
already in memory, which is what slice 1's Check button reads. A
server-authoritative variant would have to fall back to contradiction detection,
which is weaker: it catches a cell with no candidates and misses a wrong digit
that merely makes the puzzle unsolvable.

**On a board that agrees with the solution, a hint always exists.** Correct
entries are added givens, and the solver is a non-branching eliminator, so a
deduction available before an entry is still available after it (slice 5 §3).
Every dealt puzzle is solvable by singles alone (slice 3 §3), so something fires
until the board is full. "Nothing applies" is therefore always either a finished
board or a mistake — never a shrug.

### `firstStep`

```js
firstStep(geom, state, allowed) -> Step | null
```

Exported from `solver.js`. It is the body of one `solveLogically` iteration:
try the allowed techniques in tier order, return the first that fires. No new
algorithm, no second implementation of the loop.

`allowed` is all four techniques regardless of the puzzle's tier. A pointing
pair can exist on a tier-1 board — tier is the hardest technique *required*, not
the hardest available — and a hint that refused to name one because of the
difficulty label would be teaching the label instead of the game. Tier order
still means the cheapest available step is the one offered.

### Three levels, one press each

1. **Name.** "A naked pair applies, in a column," with a link to the library
   entry. Nothing on the board changes.
2. **Where.** Highlights through §3's roles.
3. **Apply.** Performs the placements and eliminations as a single undoable
   move.

The level resets whenever the board changes. A hint is about a position, and the
position moved.

### Counting assists

Two counters, not one: `hints` increments once per hint at level 1, and
`hintsApplied` increments at level 3.

Counting per press would charge a curious child three times for reading the
library entry, which is the behaviour this whole slice is trying to produce.
Counting only on apply would make naming and locating free, which they are not.
Whether either counter disqualifies a best time is slice 9's decision — it owns
best times, Q3's check counter lands in the same place, and this slice's job is
to make sure the numbers exist and are honest when it gets there.

## 6. Reaching the library

The difficulty buttons say Easy, Medium and Hard and nothing else (slice 3 §5) —
difficulty is clue count, so there is no technique name on them to hang a link
from. The library gets its own entry point instead: one link beside the picker,
and one from each hint.

A hint's link is the teaching payoff (§4.7), so it goes to
`library.html#<technique>` — the entry for the technique that hint just used,
not the top of the page.
That means an anchor beside the label, not an `<a>` inside a `<button>`, which
is invalid HTML and behaves differently depending on where in the button you
land.

## 7. Persistence

`hints` and `hintsApplied` join the saved game under
`sudoku.v1.game.<sizeKey>`, and `version` increments (slice 1 §5, slice 3 §5).
The reveal level is not saved; it belongs to the press, not to the game.

## 8. Tests

1. **Library coverage.** Every technique string the solver can return has an
   `example` fixture whose `id` equals it. A technique added without a library
   entry fails CI, which is the only thing that keeps §4's link contract true.
2. **Fixture well-formedness.** For every fixture: `gridSize` is a key of
   `SIZES`, `cells` has `n²` entries all in `0..n`, every highlighted cell is in
   range, `caption` is non-empty, `id`s are unique.
3. **Fixture honesty.** For every `example`, the technique named by its `id` is
   what `firstStep` returns on it. Slice 5 tested that the technique fires; this
   tests that it is the one the library claims and the one the hint would say
   out loud. It is what stops a caption drifting away from its board.
4. **Cheapest first.** On a board where a naked single and a pointing pair both
   apply, `firstStep` returns the naked single.
5. **The precondition.** On a board carrying one wrong entry, the hint returns
   the mistake result and no `Step` — including on a board where a technique
   would have fired, which is the case that matters and the one a naive
   implementation passes by accident only when the wrong digit happens to jam
   the solver.

No DOM tests. There is no test runner for the DOM and no dependency budget to
acquire one (Q2). The library page, the highlight roles, and the reveal
sequence are checked by eye on `dev.html` and on the phone — see criterion 6.

## 9. Acceptance criteria

| # | Criterion | Closed by |
|---|---|---|
| 1 | `node --test` passes; the workflow is green. Test groups 1–5 exist. | CI |
| 2 | The library lists all four techniques in tier order, each with a board, a caption, and a legend. | local |
| 3 | On a tier-3 9×9, the hint names, then locates, then applies a pointing pair, and the applied step is undone by one undo. | local |
| 4 | Entering a wrong digit and pressing hint produces the mistake message, not a technique. | local |
| 5 | Every link between the game and the library is relative and works from both pages (slice 1 §2; slice 11 depends on it). | CI, spot-checked local |
| 6 | The four library boards are legible at 360px portrait with no zoom, and the three highlight roles are distinguishable. | **S-item** |
| 7 | Assist counters survive a reload and are visible on the page. | local |
| 8 | `public/sudoku/core/` still imports nothing outside itself; `no-hardcoded-sizes.test.js` passes with its one exemption. | CI |

Criterion 6 needs the phone, like slice 1's criterion 3 and slice 3's criterion
4. **Add it to `questions.md` as an S-item when this slice starts** — a
criterion nobody owns is a criterion that gets assumed.

Criterion 7's visibility half is not decoration. An assist counter nobody can
see is one nobody weighs while deciding whether to press hint again, and slice 9
will then attach consequences to a number the player never watched accumulate.

## 10. Explicitly not in this slice

Timing, stats, best times, the §7.2 no-guess lock, the service worker, and
anything server-side. No new technique: the library documents the four that
exist (§4.4), and wanting a fifth entry on the page is not a reason to implement
X-wing.
