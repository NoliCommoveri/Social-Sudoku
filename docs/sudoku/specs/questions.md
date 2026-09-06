# Open items

Three kinds.

- **Setup tasks.** Things only you can do, in a browser. Listed so they are not
  discovered halfway through a slice.
- **`D`* — Due out.** Needs a fact about your world or a decision only you can
  make. Where a due out blocks a slice, that slice does not start.
- **`Q`* — Open question.** I have a recommendation. Silence means I build the
  recommendation. Cheap to redirect before the code exists, expensive after.

Answered items are deleted from here and folded into the spec they affected.
This file is the current unknowns, not a log of resolved ones.

---

## Setup tasks

### S1 — Connect this repo to Cloudflare Workers ✅ done

The repo builds and deploys on push to `main`, serving at a `.workers.dev` URL.
Build command empty, deploy command the wrangler default, both correct.

The remaining Cloudflare setup — the D1 database, the two secrets, the custom
domain `games.immotus.app`, and the Worker rename — is hub work and lives in
`../../architecture.md` §8, not here.

### S2 — Verify slice 1 on the phone and the Chromebook

Slice 1 has four acceptance criteria that no test and no agent can reach: they
need a real Android phone, a real Chromebook, and a deployed URL. They are
listed here rather than left inside the slice file so they are not discovered at
the point of trying to call slice 1 done.

Order matters — each step needs the one above it.

1. **S1 is done** and the `.workers.dev` URL loads. *(criterion
   2)*
2. **On the Android phone, open `/dev.html` and press "time 100 deals".** Report
   the p95 it prints. Under 250ms passes; over 1s is a hard fail and sends
   generation into a Web Worker. *(criterion 3)*
3. **On the Android phone, in portrait, solve a full 9×9** with no keyboard.
   Watch for horizontal scroll, a need to pinch-zoom, and mis-taps. *(criterion
   5)*
4. **On the Chromebook, solve a full 9×9 using only the keyboard** — no mouse,
   no trackpad, including new-game, undo, and check. *(criterion 6)*

Steps 3 and 4 are the ones that decide whether the layout survives, and they
are the urgent ones: every size added since draws through the same `board.js`,
so a layout fault found now is a fault in all three at once.

A "no" on any step is not something to work around — it is slice 1 reopening.
Say what went wrong in as much detail as you can stand; "the board felt
cramped" is usable, "it did not work" is not.

### S4 — Look at 6×6 and 4×4 on the phone

Slice 2's one criterion no test closes: box borders correct *by eye*. Its
arithmetic is asserted cell by cell in `grid.test.js`, and the classes those
flags produce are what `board.js` draws — but whether the heavy rules read as
boxes at 360px wide is a thing only a phone answers.

1. **On the Android phone, open `/dev.html` and press "Deal one of each size".**
   The 6×6 should show boxes 3 wide and 2 tall: one heavy rule down the middle,
   two across. *(criterion 2)*
2. **On `/`, switch to 6×6, enter a few digits, switch to 9×9 and back.** The
   6×6 board and its entries should still be there, and so should the 9×9 one.
   Reload: it should come back at 6×6. *(criterion 3)*

Do this with S2, not instead of it — S2 is about whether the 9×9 layout works
at all, this is about whether the other two sizes are drawn right.

### S5 — Check the three difficulties on the phone

Slice 3's one criterion no test closes: whether Easy, Medium and Hard read as
three different puzzles to the people playing them. The clue counts are asserted
exactly in `generator.test.js` and the openness floors in `openness.test.js` —
what no test can tell me is whether the easy one is actually easy for an 11 year
old.

1. **On the Android phone, open `/dev.html` and press "Deal one of each size and
   difficulty".** Read across a 9×9 row: Easy should look conspicuously fuller
   than Hard.
2. **On `/`, at 9×9, play an Easy board with both kids.** It should take
   somewhere around ten minutes and there should never be a long stretch with
   nothing findable. If the youngest gets stuck for more than a minute, the easy
   clue count is too low — say so and I will raise it, which is one number in
   `sizes.js`.
3. **Press Medium, then Easy again.** Each should come back to its own board
   with its own entries still on it, and the difficulty should survive a reload.

Answer 2 with a rough time and whether anyone got stuck, not a yes or no. It is
the only measurement in this project that a test cannot take.

### S3 — Nothing else, for sudoku

Sudoku itself needs no secret, no environment variable and no binding. The
hub's four setup tasks are in `../../architecture.md` §8.

---

## Due outs

### D1 — Moved

The players' names are now the hub's business, not sudoku's, and there is no
family code any more — one Durable Object per family code was replaced by a
shared D1 (`../../architecture.md` §3). What is still needed from you is the
family passphrase and the screen names to seed, tracked in
`../../identity-and-stats.md` §5. It does not block anything.

---

## Open questions

### Q2 — How do tests run, given no CLI?

**Rec: two mechanisms, different jobs.**

- **Unit tests in CI.** `test/*.test.js` using node's built-in `node:test` and
  `node:assert`, run by a GitHub Actions workflow on every push. No npm install
  — there are no dependencies. You see a green or red check on the commit in the
  GitHub web UI, which is the only place you can see anything without a CLI.
- **A `/dev` page in the browser.** Not unit tests. Generator timing on the
  actual phone, and a visual dump of generated puzzles for spot-checking. Some
  things — is 9×9 fast enough on the Android, does the 6×6 box border read right
  — cannot be answered by an assertion.

The cost of being wrong here is low; I raise it because it decides whether core
modules may use `node:` imports (they may not — the `/dev` page loads them too).

### Q3 — Wrong-entry feedback

Interacts with §7.2's no-guess lock, so worth a deliberate answer rather than a
default.

- **Immediate.** Cell turns red the moment a wrong digit lands.
- **On demand.** A "check" button marks current mistakes.
- **On completion only.** Silence until the board is full.

**Rec: on demand, plus automatic detection at completion.** Immediate feedback
turns the puzzle into a guessing game — nine taps brute-forces any cell — which
is exactly the failure §7.2 is worried about. On-completion-only is punishing
for a beginner who went wrong forty moves back. The check button puts the cost
of guessing on the player's own decision to press it.

Slice 9 should count check presses as an assist and keep them out of best times,
but that is slice 9's problem and I will spec it there.

### Q4 — Pencil marks in slice 1?

**Rec: no, defer to slice 4.** No puzzle this project deals requires them:
difficulty is clue count (§4.3), and at every tier the board is finishable by
singles. They earn their place as a comfort on a 9×9 hard board and as the way
a naked pair becomes visible when slice 6 teaches one — neither of which is
slice 1's problem.

*Cost of the deferral:* the board component's cell rendering and input handling
both change in slice 4. Small, and better paid there than guessed at now.

### Q6 — Symmetric clue removal

Classic sudoku puzzles remove clues in rotationally symmetric pairs, purely for
looks.

**Rec: no.** Symmetry constrains which clue sets are reachable, which fights
§4.3 twice over: a removal would have to take its mirror with it, so a tier's
clue count could only be hit within two, and an added clue would have to bring
its mirror past the openness floor. Aesthetics are not worth a difficulty that
means less than it says.

### Q7 — What persists locally, and what does not

Sudoku had no server before the hub. Something still needs to survive a closed tab, and still does — an in-progress board is not worth a round trip.

**Rec:** `localStorage` holds the in-progress board and UI preferences only.
Explicitly **not** best times or win counts, even though slice 1 could trivially
write them. Those are `plays` / `play_results` rows in D1 (`../../architecture.md` §3.1), and writing
them to `localStorage` first means slice 9 opens with a data migration and a
"which copy is authoritative" question for no gain. Timing does not exist until
slice 9.

*Consequence:* R4 and R5 depend on the hub's database, so the timer phase sits
after the storage foundation rather than before it. That ordering is the price
of having exactly one authoritative copy of the only data here that cannot be
regenerated — and it paid off at the hub pivot, which arrived with no results
data anywhere and therefore no migration to perform.

### Q8 — Custom domain? ✅ settled

`games.immotus.app`, the hub's address. The zone is already on Cloudflare, so
adding it to the Worker is a dashboard action with no code impact
(`../../architecture.md` §8, A3). Sudoku sits at `/sudoku/` under it.

### Q9 — PWA icons

Slice 11 needs real icon files at 192px and 512px, plus a maskable variant.

**Rec:** I generate a plain glyph — a 3×3 box with a few filled cells — and
commit the PNGs. Replace them whenever; they are two files and one manifest
entry. Say so if one of the kids would rather draw it, which is a better answer
than mine.
