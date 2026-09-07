# Session 4 — Round end, the session, and the record

Three things, in this order.

**The reveal** replaces `session-3-the-table.md` §5.6's plain panel: every seat's
final hand, the harvested commodity in full card art, and the counts that seat
offered during the round. `../design.md` §2.2's whole information channel is the
count, and this is the screen where a round's counts become readable backwards.

**The end of a session** replaces the score list `app.js` draws today: standings
with faces, ranks and corners, and a sentence saying whether it was written
down.

**The record** is the write path. `POST /api/plays` opens a row when the cards
are dealt and `POST /api/plays/:id/end` closes it, which is how an abandoned
game is a row with no result rather than no row at all
(`../../identity-and-stats.md` §4.1). This is the first thing on the site that
writes anything a player would miss.

Then the game's tile goes on the shelf, and the front page links to Pit for the
first time.

**Cost: Large, ~100k** — not the Medium `README.md` carried before it was
spec'd. The write path is a Worker endpoint with its own test file, and it is
work the reveal does not touch. So the split is named rather than discovered:
**§2, §3 and §4 complete, with `test/pit-present.test.js` green and committed,
is a clean stopping point.** The record starts from the committed tree and this
file. Do not start §5 with the reveal half-drawn.

## 1. Files

```
public/pit/core/rules.js       corners, and isComplete carrying them (edit)
public/pit/room/local.js       onComplete, the seventh method (edit)

public/pit/ui/present.js       the reveal, the ending — the decisions (edit)
public/pit/ui/table.js         the reveal panel and its celebration (edit)
public/pit/ui/app.js           the two record calls, and the ending (edit)
public/pit/index.html          the panel grows, the ended screen grows (edit)
public/pit/ui/pit.css          the reveal grid, the card, the standings (edit)

public/shared/api.js           startPlay and endPlay — the fifth and sixth calls (edit)
public/shared/games.js         Pit's tile (edit)
public/hub/hub.css             one rule: a tile whose art is an image (edit)

worker/api.js                  POST /api/plays and /api/plays/:id/end (edit)

test/plays-write.test.js       the endpoint, driven with real Requests
test/pit-present.test.js       the reveal and the ending (edit)
test/pit-rules.test.js         corners (edit)
test/pit-local-room.test.js    onComplete (edit)
```

No new module under `public/pit/ui/`. The reveal is the panel `present.js`
already builds and `table.js` already paints, grown; a third file would split
one screen across two places for no gain CI can see.

**The Worker gets no pure half.** `worker/db/plan.js` and `backup.js` exist
because their logic is arithmetic no request can carry. Two inserts and an
update are not that, and `test/players-write.test.js` already shows the pattern
that fits: real `Request`s through the real gate against a D1 stub that keeps
rows. The endpoint is tested the same way.

---

## 2. The reveal

`../design.md` §4: *round-end reveal of everyone's final hands — this is where
the count history retroactively becomes readable and is a large part of the
fun.* Session 3 drew who won and how much. This is the rest of it.

Everything it needs is already in the view. `view()` fills `reveal` with every
seat's hand and `harvest` with the corner whenever `phase !== 'trading'`
(session 1), and `history` carries the round's public events. **The rules module
is not touched for the reveal.** §4 is the only rules work in this session and
it is for the record, not for this panel.

### 2.1 What is on it

Top to bottom:

```
  the card          full art, the harvested commodity        ~180px
  who, and how much  "Bo filled the basket  +65"               32px
  a block per seat   face, name, score, hand, counts offered  ~96px each
  Next round         sends `ready`                             64px
```

A seat's block is:

- The face and name, then that seat's score **after** the harvest, and the
  harvester's `+value` beside it. A forfeited harvester keeps session 3's
  sentence — *no points — a bot was playing* — because a zero with no
  explanation is the bug report that follows.
- Its final hand, as the same `art/fruit/` slots the table uses, in
  `view.commodities` order, zeros greyed. Same order, same art, same grid as
  the hand at the bottom of the table: the panel is the moment a player checks
  their own reading of the board, and a second layout for the same information
  is a second thing to learn.
- The cornered group carries the ring, so the nine that ended it is visible
  rather than counted.

**Seat order, not score order.** *Rec:* the same order as the seat strip, which
is the order every other screen uses and the one a pre-reader navigates by
position in (`../../design-language.md` §2). *Alternative:* sorted by score,
which makes the panel a scoreboard. *Revisit if:* the kids read the panel and
ask who is winning — the header answers that today and the ordering could.

### 2.2 The counts, read backwards

Under each seat's hand, the counts it offered this round, in order:
*offered 3 · 3 · 2*.

That line is the reveal's point. During trading, `Bo: 3` three times is
information nobody can use; against Bo's final hand of eight kiwis it says what
Bo was doing all round, and the next round is played differently because of it.
It costs nothing to produce — `view.history` is already in the view and already
public — and it is the only place a round's counts sit still long enough to be
read.

`offer` events only, in order, capped at six with a trailing `…`. Withdrawals
and expiries are noise at this width, and a seat that offered nothing shows
nothing rather than an empty label.

*Alternative:* hands only, and let anybody who cares remember the counts
themselves. *Revisit if:* the line is never mentioned by anybody after a round —
it is six words of screen and it either pays for itself in what the 12-year-old
says out loud or it does not.

**No commodity of anybody else's appears in `history`.** It carries counts and
player ids, permanently, which is the same boundary the offer board is on. The
hands beside it are `view.reveal`, which exists only outside `trading`.

### 2.3 The celebration

`../design.md` §4 puts the full `art/cards/` illustration in exactly three
places, and this is two of them: the card at the top of the panel, and the
motion that brings it in.

The card scales from 0.86 to 1 with a gold ring flash, 300ms, once, as the panel
opens. **Nothing waits on it**: **Next round** is present and live from the
first frame, the 30-second backstop is unchanged, and under
`prefers-reduced-motion` the card is simply there (`../../design-language.md`
§2 — 200–400ms, nothing behind an animation you have to wait out).

*Rec:* it grows in place. *Alternative:* it flies from the harvester's seat chip,
reusing `table.js`'s `flick`, which says *whose* corner it was with no words.
*Revisit if:* the panel opens and nobody can say who won without reading — that
is the sentence under the card failing, and the flight is the fix.

When the corner is yours the headline reads *You filled the basket*. That is the
whole of "your win looks different from theirs", and it needs no second asset.

### 2.4 At 360px

The panel covers the board, the line, the harvest bar and the hand, and leaves
the seat strip visible — the same rule the pause scrim follows in session 3 §5.7
and for the same reason: who is at the table is what you look at while the
screen is not yours to touch.

Seat blocks stack and the panel scrolls inside itself. Each block's hand is the
hand grid — `repeat(min(var(--hand), 5), 1fr)`, five columns — so
*C* ≤ 5 is one row per seat and 6–9 is two. Nine seats is a panel you scroll,
which is the honest ordering: tuned for four to six, survives nine.

Rows are keyed by `playerId` and updated in place, not rebuilt, for the reason
the offer board is: **Next round** sits under a thumb and a node replaced under
a finger cancels the tap that was landing on it.

---

## 3. The end of a session

`phase: 'over'` arrives when a score reaches the target. The current screen is a
list of names and numbers `app.js` builds inline; this replaces it.

- **The headline.** *You won.* / *Bo won.* / *Game ended.* for an abandon.
- **Standings**, one row each: rank numeral, face, name, score, and corners —
  *2 baskets*. Ties share a rank, because `isComplete` says so and the client
  does not recompute it (§4.2).
- **The record's sentence.** *Saving…*, then *Saved to the gameroom.* or
  *Not saved — no answer from the gameroom.* An abandoned session says
  *Nothing to save.* A record that fails silently is a record nobody can trust,
  and H4 is the phase this site exists for.
- **Play again** (`/pit/`, a fresh document) and **Gameroom** (`/`), unchanged.

The decisions are `present.js`'s:

```js
endingFor(outcome, record, you) -> { headline, rows, note }
```

`record` is `'saving' | 'saved' | 'failed' | 'none'`, so the sentence is a value
in a test rather than a string in `app.js`. `rows` carry `playerId`; `app.js`
attaches faces from the map it has held since session 3, the same way `table.js`
does — `Seat` still has no avatar field.

`outcome` is what `onComplete` carried, whose seats are already ordered and
already ranked. An abandoned session never reaches `onComplete` (§4.2), so
`app.js` passes `{ abandoned: true, seats }` off the view instead: standings
with no ranks, because there were none, and none recomputed on this side. `you`
is the viewer, which is the one thing neither `isComplete` nor a `Seat` carries
and the headline cannot be written without.

`Play again` is a link and stays one. It costs a document load and a
`/api/players` round trip, and it buys a table with no chance of holding
anything from the session before it.

---

## 4. What the rules module still owes

Two edits, both small, both for things the client may not work out for itself.

### 4.1 Corners

`../../identity-and-stats.md` §4: *Pit shows points and corners.* Points are in
the view; corners are counted nowhere.

`state.corners` is a `{ [playerId]: number }` beside `scores`, incremented in
`applyHarvest`, **not reset by `deal`** — it is a session total, like the score
— and **not incremented for a forfeited harvest**. A bot playing an absent
seat took that corner, and the seat that left gets the same nothing from it that
it gets in points.

It goes in `isComplete`'s seat rows and nowhere else. The view does not gain it:
nothing on the table draws it, and a field in the view that nothing reads is a
field the next session has to decide about.

### 4.2 `onComplete`, the seventh method

The end screen needs ranks, and ranks with ties are `isComplete`'s to state. The
client may not import `core/rules.js` (`README.md`), so the driver answers, the
same way it answers `seatLimits()`:

```js
onComplete(outcome => …)   // fired once, after the view that ended the session
```

`outcome` is `isComplete`'s object plus one field: `recorded`, false from
`room/local.js`. Phase 7's socket sets it true — the room writes the row itself
there — and `app.js`'s post is then one `if` rather than a file to delete.

`local.js` fires it inside `push`, after the view and its events, when
`isComplete(state)` is non-null and it has not fired before. `leave()` fires
nothing. An abandoned session produces no outcome at all, because `isComplete`
returns null in `'abandoned'` — which is the no-writes property session 3 §2.6
built, working as designed.

`app.js` moves its `finish()` call out of `onView` for the `over` case and into
`onComplete`; the `abandoned` case stays where it is, drawn from the view.

`README.md`'s contract block gains the line, since both drivers implement it.

---

## 5. The record

`../../identity-and-stats.md` §4.1 is the law here: **the rules module never
writes**, the client posts, and in Phase 7 the room posts instead.

This is Phase 3's write half, arriving in Phase 5 because Pit is the game that
reaches an ending first. Phase 3 keeps the read side — the play log, the
per-game views — and sudoku's one `POST` on a finished board, which reuses these
two endpoints unchanged with `mode: 'solo'` and `unit: 'seconds'`.

### 5.1 Two calls, because an abandoned game is still a game

*Rec: the row opens at the deal and closes at the end.*

`../../identity-and-stats.md` §4.1: *A play with no result is still a play.
Abandoned games get an `ended_at` and no `play_results` rows. "We started six
and finished two" is true and worth being able to see.* A single post on
completion cannot say that — a game nobody finished never posts.

It also answers the case that will actually happen most: the phone is locked,
the tab is closed, and nothing is sent at all. That leaves a row with a
`started_at` and no `ended_at`, which reads as *we started this and did not come
back*, and is the truth. There is no beacon on `pagehide` and no attempt to
guess an ending nobody saw.

*Alternative:* one post on completion, no open rows, no abandoned plays in the
log. Half the endpoint and a record that quietly overstates how much this family
finishes. *Revisit if:* open rows pile up faster than finished ones and the log
becomes unreadable — that is a read-side problem Phase 3 can filter, not a
reason to stop writing them.

### 5.2 `POST /api/plays`

```
{ game, mode, config } -> { id, started_at }
```

- **The Worker generates `id`** (`crypto.randomUUID()`) and `started_at`
  (`Date.now()`). A client-supplied id is a client that can overwrite somebody
  else's row; a client-supplied timestamp is a kid's phone clock in the play
  log.
- `game` and `mode` are slugs — `/^[a-z][a-z0-9-]{0,31}$/` — and are **not
  checked against a list of games.** `public/shared/games.js` is the only place a
  game is named to the hub (H2), and a Worker holding a second list is a third
  game that touches two files instead of one.
- `config` is stored as `config_json`, capped at 4KB. Pit sends the table as
  dealt: seat names, which are bots, the bot level, the target, `autoCorner`,
  and the commodities and values drawn for the session. That last part is what
  makes a row readable a year later — *that was the game where kiwi was worth
  55* — and it is known by the time the first view lands, which is before this
  call is made.
- `session_id` stays null. **A Pit session is one play, not one play per
  round.** A round is twenty seconds; a `plays` row per round would bury the
  log in a game the family plays for an hour.

### 5.3 `POST /api/plays/:id/end`

```
{ result: { rank, outcome, value, unit, detail } | null } -> { ok: true }
```

- Sets `ended_at` from the Worker's clock, and inserts one `play_results` row
  when `result` is present. `result: null` is the abandon, and closes the row
  with no result — §5.1's whole point.
- **`player_id` comes from the `who` cookie, never from the body.** That is what
  the signature on the cookie is for (`../../identity-and-stats.md` §3.3): a
  stray script cannot write results as somebody else. A body that carries a
  `player_id` has it ignored, and a device with nobody picked is refused.
- Idempotent, because a phone on bad wifi will retry:
  `UPDATE plays SET ended_at = ? WHERE id = ? AND ended_at IS NULL` and
  `INSERT OR IGNORE INTO play_results`. Both statements are one `batch()`.
- An unknown id is a 404. A `detail` over 2KB is refused with the field named,
  the way `worker/api.js` refuses a profile field.

**Only the human's row is written.** `play_results.player_id` references
`players`, and a bot is not a player — there is no row for it and there should
not be. The bots' final scores live in `detail_json`, which is where §5.4 puts
them. Phase 7 is where several seats end one play, and that is a loop over the
same statements.

### 5.4 What a Pit row says

```
plays        game 'pit', mode 'bots', config_json { seats, target,
             autoCorner, botLevel, commodities, values }
play_results rank, outcome 'won' | 'lost', value <score>, unit 'points',
             detail_json { corners, rankOf, seats: [{ name, isBot, botLevel,
             score, corners, rank }] }
```

`outcome` is `'won'` at rank 1, ties included, and `'lost'` otherwise — losing
to a bot is a true thing to have written down. `mode` is `'bots'` now and
`'room'` in Phase 7, which is the one field that says which of those a row came
from.

`detail_json.seats` is the final table rather than a repeat of `config_json`:
the config is what was dealt and is written first, this is how it came out.

### 5.5 The record never navigates

`shared/api.js` gains `startPlay` and `endPlay`, and they are the first calls in
that file that must **not** send a 401 to the gate.

Every other call is made by a screen that has nothing to show without it, so a
navigation to `/gate` is the right answer. These two are made by a screen with a
game running on it, and a cookie that expired mid-session must not throw away
the round in progress. So `call()` grows one option — `{ gate: false }` — and
the two record calls pass it; the error comes back as an `ApiError` for `app.js`
to swallow into §3's sentence.

A failed `startPlay` leaves `playId` null, the end call is skipped, and the
ending says *Not saved*. There is no retry. The game does not stop, does not
warn mid-round, and does not queue anything for later: a trading game against
bots is not worth an offline outbox, and pretending otherwise would be a
mechanism nobody could test.

### 5.6 What is not checked, on purpose

Nothing validates that a score of 300 was earned. `../../identity-and-stats.md`
§4.1 settled that for solo writes and the reasoning holds here: the deterrent
against a 12-year-old posting a fake result is that the family can see the log,
which is the same deterrent that works at a physical board game.

What *is* enforced is authorship — the cookie, not the body — and shape: slugs,
sizes, and numbers that are numbers. Those are cheap and they are what keeps a
malformed row out of a table Phase 3 has to render.

---

## 6. The shelf tile

`public/shared/games.js` gains its second entry, and the front page links to Pit
for the first time.

```js
{ key: 'pit', title: 'Pit', href: '/pit/', accent: '#ffb02e',
  blurb: 'Trade fast, fill your basket', art: <the card back> }
```

`accent` is `#ffb02e`, which is `--pit` in `public/pit/ui/pit.css`. The number
is written in both files because the hub cannot import a game's stylesheet and
the game cannot import the shelf's list; `../../design-language.md` §4 asks for
one saturated accent per game used in both places, and this is the cost of that.

**The art is `art/cards/back.webp`**, an `<img>` rather than the inline SVG
sudoku's tile uses. `../design.md` §2.1 puts the full card art on the shelf
tile, and the back is the one image in the set that claims no fruit: deep teal,
gold frame, a three-leaf emblem, and 42KB. A tile showing the apple would say
Pit is the apple game.

That costs one rule in `public/hub/hub.css` beside the `& svg` one — 96px
square, `object-fit: cover` — and one edit to the comment at the top of
`games.js`, which currently says a tile's art is a bold mark rather than an
illustration. The back is both, but the file should say what is true of it now.

*Alternative:* an inline SVG mark drawn for the tile, which keeps the shelf on
one mechanism and `currentColor`. *Revisit if:* the back reads as *a* card game
rather than *this* card game from across the room, which is the test the shelf
sets.

---

## 7. Art, and what it costs

Live play still uses `art/fruit/` only. This session adds the two places
`../design.md` §4 allows the full illustration: the reveal card and the shelf
tile.

The reveal needs the harvested commodity's card, and which commodity that will
be is not known until somebody corners one. Nine cards at ~75KB is 675KB and
only *C* of them can ever be needed, so: **`app.js` constructs an `Image()` for
each of `view.commodities` once, after the first paint of the table** — after
the `fruit/` preload session 3 §8 already does, not instead of it. Four seats is
300KB fetched during a round that lasts at least seventeen seconds, and the
first harvest finds the card in cache.

The alternative — fetching it when the panel opens — puts a blank frame in the
middle of the one moment the panel exists for.

---

## 8. Tests

**The reveal** (`pit-present.test.js`). Blocks are exactly `view.seats`, in seat
order, each carrying that seat's `view.reveal` hand as slots in
`view.commodities` order with zeros included. The ring is on the cornered group
and on no other. The harvester's block carries `+value`; a forfeited one carries
the sentence and no plus. The counts line is the round's `offer` events for that
seat, in order, capped at six, and absent for a seat that offered nothing.

**The ending.** `endingFor` gives *You won.* when your rank is 1, the winner's
name when it is not, and *Game ended.* for an abandon. Ties share a rank and
both rows read as rank 1. Each of the four `record` states produces its own
sentence, and none of them is empty.

**Corners** (`pit-rules.test.js`). A harvest increments the harvester and nobody
else. A forfeited harvest increments nobody. `deal` does not reset the tally.
`isComplete` carries it per seat, and the card conservation invariant is
unchanged by any of it.

**`onComplete`** (`pit-local-room.test.js`). Fires once, after the final view,
with ranks and corners on it and `recorded: false`. Does not fire twice when the
tick runs again, does not fire on `leave()`, and does not fire for an abandoned
session.

**The endpoint** (`plays-write.test.js`, new). Driven with real `Request`s
through the real gate against a D1 stub that keeps rows, the way
`players-write.test.js` does:

- Ungated is 401 and writes nothing.
- `POST /api/plays` returns an id the client did not choose, and a `started_at`
  the client did not send. A body carrying either has both ignored.
- `POST /api/plays/:id/end` with a result closes the row and writes one
  `play_results` row whose `player_id` is the cookie's, **even when the body
  names a different player** — the test the signature exists for.
- `result: null` closes the row and writes no result. That row is what an
  abandoned game looks like.
- Ending twice changes nothing the second time, and a result posted twice is one
  row.
- An unknown play id is 404. A `config` over 4KB and a `detail` over 2KB are
  refused with the field named. A `game` or `mode` that is not a slug is
  refused.
- A device with no `who` cookie cannot end a play with a result.

**Purity.** `pit-core-purity.test.js` is unchanged and must stay green:
`present.js` gains the reveal and the ending and still names no `document`,
`window`, `localStorage`, `Date.now` or `Math.random`, and nothing under
`public/pit/ui/` imports `core/rules.js` — `onComplete` is why that is still
true after this session.

---

## 9. Acceptance criteria

1. `node --test 'test/*.test.js'` passes, existing suites included.
2. A harvest opens a panel showing the full card, every seat's final hand in
   `view.commodities` order, and the counts each seat offered that round;
   **Next round** is tappable from the first frame and the 30-second backstop
   still ends the round if nobody presses it.
3. A forfeited corner reads as no points with the reason attached, on both the
   panel's header and the harvester's block.
4. Reaching the target draws standings with ranks, scores and corners, and says
   in a sentence whether the session was written down.
5. Dealing writes a `plays` row with the table in `config_json`; reaching the
   target closes it and writes one `play_results` row for the human seat;
   abandoning closes it with no result row.
6. The `player_id` on that row is the one the `who` cookie carries, whatever the
   body said.
7. A record call that fails changes nothing about the game in progress and is
   reported on the ending screen rather than swallowed.
8. Ending the same play twice leaves one row with one `ended_at`.
9. `public/pit/ui/` still imports no `core/rules.js` and `present.js` still
   touches no DOM; the ranks, the corners and the reveal all arrive through the
   view or through `onComplete`.
10. Pit's tile is on the shelf, links to `/pit/`, and carries the card back at
    96px with no horizontal scroll on a 360px phone.
11. The reveal's motion is 300ms, runs once, and is gone under
    `prefers-reduced-motion` with the card still there.
12. No commodity belonging to another seat is in the DOM before `phase` leaves
    `trading` — session 1's leak test on `view()` plus criterion 9, unchanged by
    this session's additions.

Everything about how the panel feels in a hand is **S12** in
`../../sudoku/specs/questions.md`, with the device and the person named.

---

## 10. The device check

**S12**. The schema is applied, so the record has somewhere to go; the check
verifies it through `/admin`'s JSON export, because nothing reads the log until
Phase 3.

That dependency is the honest cost of building the write half first: for one
phase, the only way to see what was written is to download it.

---

## 11. Explicitly not in this session

**The read side.** The play log on the front page, per-game stats, head-to-head,
the overall tile — Phase 3, and `../../identity-and-stats.md` §5's open item I1
is still open. This session writes rows nobody can see yet on purpose.

**Sudoku's `POST`.** The endpoint is game-agnostic and sudoku's call is two
lines, but they are two lines in a game this session is not otherwise touching,
and Phase 3 is where somebody is reading sudoku's numbers anyway.

**Sound.** `../../design-language.md` §2 has it off by default with a per-device
toggle, and the harvest is the first noise worth making. It is not here: it
needs a toggle, a place to put the toggle, and a judgement about what a family
phone should do when it is unmuted, and none of those is improved by being
decided before anybody has watched the reveal on a phone. S12 is what should
decide whether it is worth building at all.

**Several seats ending one play.** Phase 7, where the room writes every seat's
result instead of the client writing one. `recorded` on the outcome (§4.2) is
the whole of what this session does about it.

**An automatic abandon.** `../design.md` §2.6 leaves a seat that never comes
back to somebody pressing the button and sets no count on it. Unchanged.

**Little-kid mode** (Phase 9). The reveal is nine fruit crops and two numerals
per seat, which is a panel that mode can inherit; the counts line in §2.2 is the
one part of it that needs reading, and it is one line to drop.
