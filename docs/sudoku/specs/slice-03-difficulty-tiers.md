# Slice 3 — Difficulty tiers, the openness floor, and the picker

Corresponds to `../design.md` §6 step 3, implementing §4.3. The tiering
mechanism R3 rests on, the floor that keeps every tier findable, and the UI that
exposes both.

**Estimated cost:** Medium (20–60k).

**Blocked on:** nothing. In particular not the solver — difficulty is clue
count, and a clue count needs no rating function.

**Hands to later slices:** a `deal` that takes a difficulty, and one solution
grid per seed whatever difficulty is asked for. That second property is what
lets two people race the same deal at two tiers (slice 10).

---

## 1. What exists at the end

Puzzles are dealt at a chosen difficulty, at every size, and the choice is
remembered. Easy at 9×9 leaves 31 cells to fill with around 22 findable at any
moment. Nothing else changed: no timer, no pencil marks, no hints, no server.

## 2. Difficulty is clue count

`carve` takes a clue target and stops there:

```js
carve(geom, solution, rng, keep) -> Uint8Array
```

`keep` of 0 removes everything removable, which is a minimal clue set and what
slices 1 and 2 dealt. Every tier asks for more than that, and gets it exactly:
clues come off one at a time and the pass ends the moment the count is reached.

One pass suffices and a second would find nothing. If removing a cell breaks
uniqueness here, it also breaks it on every board further along the pass —
those hold fewer clues, and a subset never has fewer solutions. A cell refused
once is refused forever. So the only way a pass can end above `keep` is that the
board went minimal first, which is why `every tier target is reachable at its
size` is a test: it is the assumption the exactness rests on.

### The table

`SIZES[<size>].tiers`, in `sizes.js` because that is where numbers about sizes
live and the `no-hardcoded-sizes` grep exempts it.

| Tier | 4×4 | 6×6 | 9×9 | 9×9 cells to fill |
|---|---|---|---|---|
| Easy | 9 | 20 | 50 | 31 |
| Medium | 7 | 16 | 40 | 41 |
| Hard | 5 | 12 | 32 | 49 |

Measured, not guessed. Easy at 9×9 is two children for about ten minutes with
something findable at every moment. Hard sits just above the point where singles
stop being enough — at 9×9 they suffice on 39 of 40 boards at 32 clues, 35 of 40
at 30, and 19 of 40 at 26.

## 3. The openness floor

Each tier carries one, and `ease` (from the openness work folded into this
slice) enforces it: a board that stalls under singles, or that offers fewer than
the floor in some round, gets clues added back from the solution until it does
not.

It fires on fewer than one deal in ten at these clue counts, which is the point.
Difficulty is the clue target; the floor is a guarantee under it, catching the
occasional carve that closes into a corridor. A test asserts it stays that way —
if `ease` starts firing on most deals, the dealt clue count is no longer the
tier's clue count and the labels have drifted.

## 4. `deal`

```js
deal(geom, seed, tier) -> { seed, solution, givens }
```

Deterministic in all three. The rng is seeded from `seed` alone and
`fillComplete` runs before `carve`, so the solution grid depends on the seed and
not on the tier: every difficulty of one seed shares one solution, and the tiers
are nested prefixes of one removal order. That is §4.3's guarantee, held by
construction rather than by check, and it is tested.

## 5. The picker

Two rows of buttons built by one function: sizes from `SIZE_KEYS`, difficulties
from `TIER_IDS`. Size is not difficulty — a 4×4 is small, not easy — so they are
separate rows and either changes without touching the other. Switching size
rebuilds the geometry, board and keypad; switching difficulty only deals.

Labels are Easy, Medium and Hard. Not tier numbers: a number is a thing to work
out, and the youngest player is 11.

Both rows live in a popover hung off one button in the top bar, which reads as
the board you are on — `9×9 · Easy` — rather than as the word *Options*. Two
reasons, both from the phone. Six always-visible choices between the grid and
the keypad cost about a third of a 360×740 screen, and the board and the whole
keypad have to be visible at once or the player scrolls between looking and
tapping. And a row of buttons that changes the puzzle, sitting where a thumb
rests, gets pressed by accident mid-solve. In the top layer it covers the board
instead of moving it, light-dismisses on the next tap anywhere, and closes
itself as soon as a choice is made.

The board gives way before the keypad does: below roughly 740px of viewport the
square shrinks rather than pushing the bottom keys off-screen.

Saved games are keyed by size *and* difficulty, so neither picker destroys a
board in progress. Nine keys in `localStorage`, a few hundred bytes each. The
saved record carries its `tierId`, so one written before difficulties existed
fails validation and is dropped rather than restored under a guess.

## 6. Tests

1. **Exactness.** `carve` returns exactly `keep` clues, at every size and tier,
   and the result is uniquely solvable.
2. **Reachability.** A minimal carve at each size lands below the hardest tier's
   target, so no target is unreachable.
3. **Monotonicity.** A harder tier never deals more clues than an easier one, and
   an easier tier leaves more of the board findable per round.
4. **One solution per seed.** Every tier of one seed returns the same solution
   grid.
5. **The floor holds.** Every dealt puzzle solves by singles and no round falls
   below its tier's floor.
6. **`ease` stays quiet.** It leaves most dealt boards untouched at the tier clue
   counts.
7. **The table's shape.** Every size defines every tier, clue counts fall across
   them, floors do not rise, and `tierFor` returns a playable tier for an id that
   came out of storage corrupted.

## 7. Acceptance criteria

1. `node --test` passes; the workflow is green.
2. All seven test groups above exist and pass.
3. `public/sudoku/core/` still imports nothing outside itself, and
   `no-hardcoded-sizes.test.js` passes with its one exemption (`UNIT_KINDS`).
4. The three difficulties are visibly different on a phone — a check only a
   person can make, so it is `S5` in `questions.md`, not a line here.

## 8. Explicitly not in this slice

Pencil marks, the solver, the technique library, hints, timing, stats, anything
server-side. No technique rating: nothing in this project rates a puzzle by the
hardest technique it needs, and `../design.md` §4.3 says why.
