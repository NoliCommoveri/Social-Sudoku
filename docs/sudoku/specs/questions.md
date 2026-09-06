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

The remaining Cloudflare setup — retiring the old `social-sudoko` Worker, the
D1 database, the two secrets, and the custom domain `games.immotus.app` — is hub
work and lives in `../../architecture.md` §8, not here.

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

### S6 — Check the database and the admin page on the deployment

Phase 2 Session A's behaviour lives entirely in a Worker talking to D1, and
there is no `wrangler dev` here — the loop is push, wait for the build, open the
page. None of this can be closed by CI or by me. **A2** is done — the `gameroom`
database exists and its id is in `wrangler.jsonc` — so everything below is
reachable as soon as this is on `main` and Cloudflare has built it.

Any browser, either device. In this order — each step is the setup for the next.

1. **Open `/admin` on the fresh database.** Everything pending, no error, and a
   line saying the database has no tables yet. Nothing red.
2. **Press Apply pending.** The migration goes to *applied* with a timestamp.
   Press it again: "Nothing pending."
3. **Press Run seed.** Six players go in. Press it again: it says it ran, and
   nothing changes — that is the ON CONFLICT rule doing its job, and it is what
   makes editing `seed_players.sql` a safe way to fix a name.
4. **Edit `seed_players.sql`** — change a screen name — commit, wait for the
   build, press Run seed. The name does *not* change, because the row exists.
   That is correct and is the thing to know before Session C: renaming a player
   is the picker's job, not the seed file's.
5. **Edit `001_schema.sql`** — a comment is enough — commit, wait, reload
   `/admin`. It must show **drifted** in red with both checksums, and Apply
   pending must not reapply it. Put the comment back afterwards.
6. **Break `001_schema.sql` on purpose** — delete a closing bracket — commit,
   wait, and on a *fresh* database press Apply pending. The page must print the
   failing statement and SQLite's message, and the migration must still read as
   pending. Undo it afterwards.
7. **Open `/` and `/sudoku/`.** Unchanged: same board, same behaviour, no sign
   anywhere that a database exists.

Step 6 is the one worth the trouble. It is what pays for the machinery that
names the failing statement, and there is nowhere else to see an error from a
migration.

Steps 5 and 6 both need a way back to a clean database. **Erase everything** is
it, and it is built — take the backup it asks for first, then Erase → Apply
pending → Run seed. Doing these checks now rather than after Phase 3 is still
the cheap moment: the only rows in the database are six seeded placeholders.

### S7 — Check erase, export and re-import on the deployment

Phase 2 Session B's acceptance criteria 2–8
(`../../hub/specs/phase-2-session-b-erase-export.md` §9). Same loop as **S6** —
push, wait for the build, open the page — and reachable as soon as this is on
`main` and Cloudflare has built it. Do **S6** first: this needs a database with
the schema applied and the six players seeded, which is what S6 leaves behind.

Every route was driven end to end against a real SQLite before it shipped —
apply, seed, export, all three erase refusals, erase with live foreign keys, the
round trip back, a second import, an import into a moved schema, and two broken
files. What that could not check is D1 itself: whether it answers
`PRAGMA table_info`, whether a downloaded response sets a cookie on the phone,
and whether the file input works there. Those are why this list exists.

1. **Open `/admin`.** Backup, Restore and a red Danger panel are below the
   existing table. Nothing is red that should not be.
2. **Press Erase everything, then confirm without downloading.** It must refuse
   and say the backup has to be downloaded first. This is the step the whole
   mechanism exists for — if it erases anyway, stop and report it.
3. **Download the backup.** Open the file. Six players in it, and no
   `_migrations` table among the tables.
4. **Confirm the erase.** Every table goes, including the ledger, and `/admin`
   then reads every migration as pending — a fresh database.
5. **Apply pending, Run seed, then import the file from step 3.** It should
   report the rows it put in. Import it a second time: it says it ran and
   nothing changes.
6. **Take a backup, edit `001_schema.sql`** — add a column to `players` —
   commit, wait, then Erase → Apply pending → import the old backup. It must
   warn that the schema moved, import what still fits, and name what it dropped.
   This is the case that actually happens; step 2 is the one that must never
   fail.
7. **Import a deliberately broken file** — delete a bracket in a copy — and
   check it is refused with a sentence naming the problem rather than a wall of
   SQLite errors.
8. **Open `/` and `/sudoku/`.** Unchanged, as in S6 step 7.

Step 6 leaves the schema changed. Put `001_schema.sql` back afterwards, erase,
apply and seed again — which is now a browser action rather than a trip to the
Cloudflare dashboard, and is the point of the session.

### S8 — Check the gate, the picker and the shelf on the phone

Phase 2 Session C's acceptance criteria 2–10
(`../../hub/specs/phase-2-session-c-gate-picker-shelf.md` §9). This is the
first phase whose subject is a screen rather than a database, so most of it can
only be answered by watching somebody use it.

**Blocked on setup task A3** — `FAMILY_PASSPHRASE` and `SESSION_SECRET` in the
Cloudflare dashboard. Until they are set, `/gate` says so and nobody gets in.
Do **S6** and **S7** first: this needs the schema applied and the six players
seeded.

Do it on the Android phone, in portrait, on a device that has never opened the
site. Steps 1–7 are yours; steps 8 and 9 are the ones that actually decide
whether H5 holds, and they are somebody else's.

1. **Open `/`.** It should show a moment of "Opening the gameroom…" and then the
   gate. Type the word wrong once: it says so and does not let you in. Type it
   right: you land on the picker. *(criteria 2, 3)*
2. **Tap your own face.** The shelf, with your face in the bar and the ring on
   your tile in the strip below. Everybody's face is visible without scrolling.
   *(criterion 4)*
3. **Close the tab and open `/` again.** Straight to the shelf, still you, no
   gate. *(criterion 5)*
4. **Tap the bar, then tap somebody else.** You are them. Tap the bar again and
   choose **Nobody**: the picker comes back and stays until somebody is chosen.
   *(criterion 6)*
5. **Tap the Sudoku tile, play a couple of cells, then use the back link.** The
   shelf, as you left it. *(criterion 7)*
6. **Look for anything smaller than a thumb, and for horizontal scroll.**
   Nothing on the hub should be under 64px or need a sideways drag. Do this on
   the Chromebook too — it should be the same layout with more air, not a
   different one. *(criterion 8)*
7. **Open `/admin`** on a device that never answered the gate: it works, which
   is deliberate. Then change `FAMILY_PASSPHRASE` in the dashboard and reload
   `/`: every device asks again. Put it back. *(criteria 9, 10)*
8. **Can the 5-year-old get from the front page into a game, alone, first
   try?** Watch, do not coach. Where they hesitate is the finding, and "they
   tapped the wrong face" is the most useful answer this list can produce.
9. **Does the 12-year-old open it a second time without being asked?** Takes a
   week to read and is the only honest measure of H5.

Steps 8 and 9 are `design-language.md` §5's two questions, and they are the
reason the rest of this exists. A "no" on either is not a bug report — it is the
shelf reopening.

### S9 — Check making and changing a profile, on the phone

Phase 2 Session D's acceptance criteria 2–8
(`../../hub/specs/phase-2-session-d-editing-a-profile.md` §7). Do **S8** first:
this needs somebody through the gate and a picker with faces on it.

On the Android phone, in portrait.

1. **Tap the bar, then `New player`.** Type a name, tap a face, press
   **Make me**. You are that person, on the shelf, and the new face is at the
   end of the family strip. *(criteria 2, 3)*
2. **Tap the bar, then `Change my name or face`.** Change the name, save, and
   look at the bar and the strip: both say the new one straight away.
   *(criterion 4)*
3. **Try to take a face somebody else has.** It cannot be tapped and it carries
   their name. Then type a name somebody else has and press save: a sentence
   says so, and the screen scrolls to it rather than leaving it above the fold.
   *(criterion 5)*
4. **Reload `/`.** Still you, no gate, no picker — a rename is not a new
   player. *(criterion 6)*
5. **On a second device that is somebody else**, make a profile for one of the
   little ones. That device should still be *you* afterwards, and the new
   profile should be on the first device's picker after a reload.
   *(criterion 3)*
6. **Look for anything smaller than a thumb, and for horizontal scroll**, on the
   editor with all thirty faces on it. Nothing under 64px, no type under 16px,
   no sideways drag, and the save button stays reachable without scrolling to
   the bottom. Do it on the Chromebook too. *(criterion 7)*
7. **Hand the phone to the 11-year-old and say nothing except "change your
   name".** Whether they find it, and how long it takes, is the finding.
   *(criterion 8)*

Step 7 is the one this exists for. If they cannot find it, the two ways into the
editor are in the wrong place, and that is a design change rather than a bug.

### S10 — Check the Pit table on the phone

Pit session 3's acceptance criteria that no test reaches
(`../../pit/specs/session-3-the-table.md` §10). Do it after session 3 is built
and deployed. Needs **S8** — the table asks who you are and sends you to the
gate if it does not know.

The subject is a live screen with a clock under it, so most of this is watching
rather than checking. On the Android phone, in portrait.

1. **Open `/pit/`.** Tap a bot count, then **Deal**. Look at the tile row first:
   does it read as "this many players *and* this many fruit", or only as a
   number?
2. **Play one full round.** Post an offer, take somebody's offer, and watch what
   your hand does. The finding is whether you can tell what you just received
   without being told — §4.4's line is one beat long, and one beat may be too
   short.
3. **Look for movement under your thumb.** Nothing should resize or reorder as
   counts change, and no row should be replaced while you are pressing it. A tap
   that does nothing is the symptom.
4. **Let an offer you are paying for expire.** The hand should un-grey, the line
   should say *Gone*, and nothing should look like an error, because losing a
   race is normal play.
5. **Corner one.** Whether the Harvest bar lights *and gets noticed* is the
   question — it is at the bottom of a screen with a lot happening above it.
   Then play a session with auto-harvest on and say which one the 11-year-old
   prefers. That answers `../../pit/design.md` §2.4's toggle.
6. **Measure the tap targets.** Nothing under 64px, no type under 16px, no
   horizontal scroll, at four bots and again at eight. Eight is the two-row hand
   and the scrolling board, and it is the case the layout only survives rather
   than fits.
7. **Turn on reduced motion** (Android: Settings → Accessibility) and play a
   round. The countdown must still be readable; if it vanished, the numeral
   fallback is wrong.
8. **On the Chromebook, play a round with the keyboard only** — tab, enter,
   nothing else. Every control is a real button, so this should work; if it
   does not, something is a `div`.
9. **Hand it to the 11-year-old with no explanation and watch them trade.**
   Where they hesitate is the finding, and "they did not know you had to tap
   your own cards to pay" is the most useful answer this list can produce.
10. **Ask the 12-year-old whether the bots feel like people.** Session 2's
    latency and noise are tuned blind; this is the only reading either gets.

Steps 9 and 10 are what this exists for. A "no" on 9 is §4.3's two-tap
mechanism reopening, not a bug.

Pit's word for the button — **Harvest!** — is worth asking the little ones about
while the phone is in their hands (`../../pit/design.md` §2.4). If they call it
something else every time, that is the name.

### S3 — Nothing else, for sudoku

Sudoku itself needs no secret, no environment variable and no binding. The
hub's four setup tasks are in `../../architecture.md` §8.

---

## Due outs

### D1 — Moved

The players' names are now the hub's business, not sudoku's, and there is no
family code any more — one Durable Object per family code was replaced by a
shared D1 (`../../architecture.md` §3). What is still needed from you is the
family passphrase, tracked in `../../identity-and-stats.md` §5; the screen names
are no longer a due out, because the site changes them now. It does not block
anything.

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
(`../../architecture.md` §8, A4). Sudoku sits at `/sudoku/` under it.

### Q9 — PWA icons

Slice 11 needs real icon files at 192px and 512px, plus a maskable variant.

**Rec:** I generate a plain glyph — a 3×3 box with a few filled cells — and
commit the PNGs. Replace them whenever; they are two files and one manifest
entry. Say so if one of the kids would rather draw it, which is a better answer
than mine.
