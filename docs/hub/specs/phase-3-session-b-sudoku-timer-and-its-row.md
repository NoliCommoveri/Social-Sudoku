# Phase 3 Session B — Sudoku's timer and its row

The second game in the log. Sudoku has been playable since Phase 1 and has never
recorded anything: no clock, and `store/local.js` holds a board and nothing else.
This session gives it an elapsed time and the two calls that put a finished board
in the record.

It is the old sudoku slice 9 — *timer, stats, best times* — minus the stats,
which are Session C's, and minus the endpoints, which Pit already built.

## 1. Why this is not two lines

The ROADMAP called sudoku's write "two lines", and the `POST` is. **The time it
posts does not exist yet**, and a time is the only value a sudoku result can
carry. Everything below is about making a number that means something a year
later.

## 2. Files

```
public/sudoku/ui/clock.js   pure: accumulate, pause, resume; `now` is an argument
public/sudoku/ui/app.js     the clock in the bar, the two calls, the win line
public/sudoku/ui/board.css  the readout
public/sudoku/store/local.js  the saved game gains elapsedMs and playId
public/sudoku/index.html    the readout's element in the top bar
test/sudoku-clock.test.js   the accumulation
```

`clock.js` is under `ui/` rather than `core/`: `core/` is the sudoku rules and is
bound by the no-literal-sizes rule, and a stopwatch is neither. It stays pure
anyway — `now` is passed in — so CI runs the arithmetic without a browser.

## 3. Elapsed play time, not wall clock

**The number is time spent on the board, accumulated across every sitting.** A
saved board is resumed the next morning, and a wall clock from deal to solve
would make every resumed board a fourteen-hour best and every best time a
statement about bedtime.

```
elapsedMs   accumulated, in the saved game
running     started when the board is live, added to elapsedMs when it stops
```

The clock runs while the tab is visible and the board is unsolved. It stops on
`visibilitychange` to hidden, and on the solve. It does **not** stop for the
board chooser, the check button, or a long think — those are playing.

The readout sits in the top bar beside the board name: `M:SS`, `H:MM:SS` past an
hour, `tabular-nums` so it does not jitter, 16px like everything else in the
shell. It is updated by a one-second interval that writes `textContent` only —
not through `render()`, which redraws the board — and the interval is cleared
while the tab is hidden.

**It is not the hero.** A visible timer changes how a puzzle feels, and for the
5-year-old it should change it as little as possible: no colour, no counting up
in the win popup, nothing that reads as pressure.

## 4. The saved game gains two fields

`elapsedMs` and `playId`, both optional in `loadGame`'s validator: missing reads
as `0` and `null`. That is deliberate and matches `loadPrefs`' rule — *a missing
field is a default, never an error* — and it means the boards the family has in
progress survive the deploy instead of being dropped by a shape check. `VERSION`
does not move; it is for a changed value, not a new one.

**Each of the nine saved boards carries its own `playId`.** Switching size or
difficulty does not end anything: the board you left is still there and its row
is still open, which is exactly the state the two-call write path describes.

## 5. The two calls

Both are `shared/api.js`'s existing `startPlay` and `endPlay`, unchanged.

**On a new board, not on a resume:**

```js
startPlay({ game: 'sudoku', mode: 'solo', config: { size: sizeKey, tier: tierId, seed } })
```

The id goes into the saved game. A resumed board already has one, and opening a
second row for the same puzzle would put it in the log twice.

**On the solve:**

```js
endPlay(playId, {
  outcome: 'solved',
  value: elapsedMs / 1000,
  unit: 'seconds',
  detail: { checks },
})
```

- `outcome: 'solved'` is in `WON` (Session A §4), so a finished board counts on
  the front page's tile. There is nobody to beat in solo sudoku and `'won'`
  would be a strange word for it.
- `unit: 'seconds'` is what `BETTER` reads to know a sudoku best is a minimum.
- `checks` is how many times **Check** was pressed on that board — the one thing
  that makes two times comparable later. It is per-board state, saved with the
  rest, and it is the whole of `detail`.

**Starting a new board over an unfinished one ends the old row with
`result: null`.** That is the abandon, and it is what keeps the log honest about
how much this family finishes. A board simply left alone ends nothing: the row
stays open, which reads as *we started this and did not come back*, and is true.

### 5.1 When it does not save

Sudoku is reachable at `/sudoku/` directly, so both failures are ordinary.

- **`startPlay` fails** (offline, or the gate cookie expired): `playId` stays
  null, the end call is skipped, and the win popup carries a small `Not saved`.
  The game does not stop, does not warn mid-puzzle, and queues nothing for
  later. Pit settled this — an offline outbox is a mechanism nobody could test.
- **Nobody is picked on the device**: `endPlay` with a result is a 403, and the
  win popup says `Not saved — nobody is picked` with a link to the picker. The
  puzzle, the confetti and the popup are unaffected. A 4-year-old on a cleared
  tablet still gets to finish their 4×4.

Neither call may navigate to `/gate`; both already pass `{ gate: false }`, and
the reason is the same one Pit had — a cookie that expired mid-puzzle must not
throw away the board.

### 5.2 What is not checked

`elapsedMs` lives in `localStorage` and a 12-year-old with devtools can put any
number in it. Nothing validates it, the same way nothing validates a Pit score
(`../../identity-and-stats.md` §4.1): the deterrent is that the family can see
the log, which is the deterrent that works at a physical board game. Server-side
validation of a solo time is Phase 8's problem, in race mode, where it is worth
building.

## 6. Tests

- **`test/sudoku-clock.test.js`** — accumulation across a pause and a resume;
  that a hidden tab adds nothing; that a solve stops it once and a second solve
  event does not add; formatting past an hour.
- **`test/sizes.test.js` and the no-literal-sizes grep are unaffected** —
  nothing here is in `core/`.

The store's new fields are covered by round-tripping a saved game written
without them, which is the case that actually ships.

The write path itself needs no new test: `test/plays-write.test.js` covers both
endpoints, and sudoku sends the same shapes Pit does.

## 7. Acceptance criteria

| # | Criterion | Closed by |
|---|---|---|
| 1 | `node --test` passes, including the clock. | CI |
| 2 | Elapsed time accumulates across a resume and does not run while the tab is hidden. | CI |
| 3 | A board saved before this session loads and starts from `0` rather than being dropped. | CI |
| 4 | Finishing a board writes one `plays` row and one `play_results` row with `unit: 'seconds'`, and it appears in the front page's log. | Phone (S13) |
| 5 | Starting a new board over an unfinished one closes the old row with no result. | Phone (S13) |
| 6 | With nobody picked, the board still finishes and the popup says it was not saved. | Phone (S13) |
| 7 | The readout is legible at 360px, does not push the board or the keypad below the fold, and does not jitter. | Phone (S13) |
| 8 | The 5-year-old does not play differently because the clock is there. | Phone (S13) |

Criterion 7 is the one that can quietly undo S11 step 1 — the whole board and
every keypad key on one screen — and criterion 8 is the one that decides whether
the timer should have been optional.

## 8. Explicitly not in this session

- **Best times, and any stats screen.** Session C.
- **A pause button.** The tab going away is the pause, and a button that stops a
  clock is a button that gets pressed to stop a clock.
- **A timer for Pit.** A Pit session is one play over an hour and its value is
  points; wall-clock duration is `ended_at − started_at` and already in the row.
- **Retro-fitting times onto boards finished before this session.** There is no
  data to do it from and inventing one is worse than an empty log.
