# Session 3 — The stopped seat, and the table

Two halves, in this order.

**The stopped seat** finishes `../design.md` §2.6: `pause`, `resume`, `abandon`
and `present` as rules actions, a per-seat idle clock, and a bot that takes over
a seat sixty seconds after its player stops. Without it a four-seat round hangs
83% of the time the moment somebody puts their phone down, which is what the
5-year-old does.

**The table** is the screen. At the end of it a person opens `/pit/`, says how
many bots sit down, and plays rounds of Pit against them on a phone: a hand that
groups by commodity, an offer board, blind swaps that resolve in front of them,
and a Harvest button that lights when it is legal.

The halves are in one session because the buttons and the actions are the same
decision — a pause button over a rules module with no `pause` is a button that
lies — and `ROADMAP.md` Phase 5 settles the order.

Sessions 1 and 2 left a game that only a test file can play. This session gives
it its only consumer. Nothing on the screen side knows the rules —
`../../../CLAUDE.md`'s "rules modules never write" has a twin here: **the client
never computes**. It renders a `View` and sends an `Action`, and the grep
session 2 added is what keeps that true.

**Cost: Large, ~105k.** That is the top of the band, so the split is named
rather than discovered: **§2 complete, with `test/pit-stopped-seat.test.js`
green and committed, is a clean stopping point.** The table starts from the
committed tree and this file with nothing held in conversation. Do not start §3
with §2 half-applied.

## 1. Files

```
public/pit/core/rules.js       design.md §2.6: the actions, the clock, takeover (edit)
public/pit/room/local.js       seatLimits, for the setup screen (edit)

public/pit/index.html          setup and table in one document
public/pit/ui/app.js           wiring: identity, setup, the room, the callbacks
public/pit/ui/present.js       the pure half — view + intent → what to paint
public/pit/ui/table.js         the DOM half — paints a Screen, reports taps
public/pit/ui/setup.js         the room-setup screen, and the seat list it builds
public/pit/ui/pit.css          the table, on the shared tokens
public/pit/store/local.js      three remembered settings, and nothing else

test/pit-stopped-seat.test.js  idle, takeover, forfeit, pause arithmetic, abandon
test/pit-present.test.js       the mode machine, the groups, the receipt
test/pit-setup.test.js         seats and config out of the setup form
test/pit-core-purity.test.js   greps extended (edit)
test/pit-rules.test.js         conservation across a pause and a takeover (edit)
```

One HTML document holds both screens. A second file would duplicate the head and
the token link, and navigating between them would drop the room the first one
built — the setup screen's whole output is a live `Room` object, which does not
survive a page load.

`store/local.js` mirrors sudoku's and holds preferences only. **No game is
saved.** A trading game against bots that runs on a tick has nothing meaningful
to resume into; §2 is what a session walked away from does instead.

### 1.1 The pure half is where the work goes

`present.js` touches no DOM, and neither do the two functions `setup.js` exports
for the deal; those are what `node --test` can reach. `table.js` cannot be
tested at all — there is no jsdom, because there are no dependencies — so **the
size of `table.js` is the size of what CI cannot check**, and the split is drawn
to keep it boring: create elements, set text, set classes, attach listeners,
call `onTap`. Every decision — which groups are tappable, what a tap means, when
a mode cancels itself, what the badge says — is made in `present.js` against a
plain object and asserted in a test file.

---

## 2. The stopped seat

`../design.md` §2.6 decided all of this and gives the numbers behind it. This
section says where it goes in `core/rules.js`. Everything here is pure and takes
`now` as an argument, as the rest of the module already does.

### 2.1 State, and two new constants

Beside `OFFER_TTL_MS` and `REVEAL_BACKSTOP_MS`:

```js
export const IDLE_TAKEOVER_MS = 60000;   // design.md §2.6
export const ABANDON_TTL_MS = 30000;     // an unseconded proposal clears itself
```

Neither belongs in `commodities.js`. That file holds what little-kid mode
changes — the hand size, the offer cap and the point values — and these are
durations, not counts.

`init` and `deal` gain four fields, all of them maps or lists beside the ones
already there rather than fields on `seats[]`, because `seats` is the static
roster and everything per-round is already parallel to it (`hands`, `scores`,
`botsReadyAt`, `ready`):

| Field | Shape | Reset by `deal` |
|---|---|---|
| `idleSince` | `{ [playerId]: number }` — when the seat last acted | no |
| `takenOver` | `string[]` — seats a bot is currently playing | no |
| `forfeit` | `string[]` — seats that score nothing this round | **yes** |
| `pausedAt` | `number \| null` | no |
| `abandon` | `{ by: string, at: number } \| null` | no |

`takenOver` outliving the deal is the point: a phone that is still in a pocket
at the next deal is still in a pocket. `forfeit` not outliving it is also the
point — `../design.md` §2.6's penalty is per round.

`init` stamps `idleSince` for every seat at the deal, so a table nobody ever
touches trips the timer sixty seconds in rather than immediately.

`phase` gains `'abandoned'`. `view` gains `pausedAt`, `abandon`, and three
fields per seat: `idleSince`, `takenOver` and `forfeited`.

**`idleSince` is absolute, not a duration.** `view(state, viewer)` is given no
`now` and does not get one — that would change the `GameRules` signature in
`../design.md` §1 for every game. An absolute stamp matches `offer.expiresAt`,
which is already in the view for the same reason, and it lets the takeover
countdown use §5.2's trick: a CSS animation whose duration is
`idleSince + IDLE_TAKEOVER_MS - now`, costing nothing per frame.

### 2.2 The stamp, `present`, and the one action that does not

Any valid action from a seat stamps `idleSince[actor] = now` and, if the seat
was in `takenOver`, drops it and emits `{ kind: 'reclaim', playerId }`.

**This happens in `apply`, around the dispatch, not inside each handler.** One
place, so an action added later cannot forget.

`present` is what that buys. `validate` accepts it from any seated player in any
phase but `over` and `abandoned`, and accepts it while paused; `apply` returns
`{ state, events: [] }`. It is the only action whose entire effect is the stamp
every action already gets, and its handler is therefore empty. It exists because
`../design.md` §2.6 needs a player deliberating with a thumb on the screen to be
distinguishable from one whose phone is in a pocket, and no other action can say
that without also trading. §5.8 is the throttle that stops the client sending it
on every scroll.

The exception is `disconnect`, which must not stamp. It is the room telling the
rules module that a socket is gone (Phase 7); a stamp there would keep a player
who has left looking present for another minute, which is exactly the case
takeover exists for.

### 2.3 Takeover

Evaluated in `tick`, before the phase branches, because idleness accrues during
the reveal as well as during trading:

```
for each seat where !isBot and not already in takenOver
  and now - idleSince[playerId] >= IDLE_TAKEOVER_MS:
    takenOver += playerId
    forfeit   += playerId        (if not already there)
    emit { kind: 'takeover', playerId }
```

Bot seats are excluded by `isBot` rather than by relying on bots to stamp
themselves. A bot cannot be absent and the timer should not be a statement about
bot scheduling.

Three things then change downstream:

- **`bots()` drives the seat.** Its `state.seats.filter(seat => seat.isBot)`
  becomes `isBot || takenOver.includes(playerId)`. The gate seeding already
  handles a seat whose `botsReadyAt` entry is absent, so a seat taken over
  mid-round gets its first gate on the next tick rather than acting instantly.
- **The caretaker plays at `normal`.** A taken-over seat has no `botLevel` and
  is not given one. *Rec:* `normal` — it is the level `../design.md` §2.6's
  simulations used, and the caretaker's job is to keep the round moving rather
  than to win it. *Alternative:* the session's chosen level, which is more
  consistent. *Revisit if:* a caretaker bot beating the table becomes the
  complaint.
- **`applyReady` stops waiting on the seat.** Its `waiting` test gains
  `&& !takenOver.includes(seat.playerId)`, or an absent player holds the reveal
  open for the full `REVEAL_BACKSTOP_MS` every round while a bot plays their
  cards.

**Reclaim is §2.2's stamp and nothing more.** The seat leaves `takenOver` and
stays in `forfeit`.

**Sixty seconds is tuned on bot rounds.** `../design.md` §2.6's table tops out
at 23.5s of single-seat idleness across 1,596 rounds, so the margin is 2.5×
against a machine. The case it is least likely to fit is the 4-year-old in
Phase 9, who will idle past a minute while looking at a fruit. That is little-kid
mode's number to change, not this session's, and `IDLE_TAKEOVER_MS` being one
exported constant is what makes changing it a one-line edit.

### 2.4 Forfeit

`applyHarvest` awards `state.values[commodity]` unless the harvesting seat is in
`forfeit`, in which case it awards nothing:

```js
const forfeited = state.forfeit.includes(actor);
const value = forfeited ? 0 : state.values[commodity];
```

Everything else is unchanged — escrow still comes home, the phase still moves to
`roundEnd`, the reveal still shows every hand, the next round still deals. That
is `../design.md` §2.6's whole argument for the penalty: the round *ends*, and
the cost of the bot having ended it falls on the seat that left.

`state.harvest` carries `forfeited` so §5.6's panel can say why the number is
zero. Nothing passes to second place; an uncontested corner on a taken-over seat
awards nothing to anybody.

`tick`'s `autoCorner` path goes through the same `applyHarvest` and inherits
this with no second code path.

### 2.5 Pause, and the clocks it has to move

Any seat may pause and **any** seat may resume — `../design.md` §2.6, so that no
one child holds the game.

`validate` gains one guard above the switch: while `pausedAt !== null`, every
action refuses with `paused` except `resume`, `abandon` and `present`. `pause`
itself refuses with `paused`; `resume` outside a pause refuses with
`not-paused`. Both refuse in `over` and `abandoned`.

`tick` gains one line at the top:

```js
if (state.pausedAt !== null) return { state, events: [] };
```

Returning the state it was given is already how a driver knows not to push a
view (session 2 §5), so a paused room goes quiet with no driver change at all.

**That line alone is a bug, which is the reason for the rest of this section.**
`expiresAt`, `roundEndsAt`, `idleSince` and `botsReadyAt` are absolute
timestamps. Freeze the tick for three minutes and the first live tick afterwards
finds every offer three minutes past expiry, every bot gate three minutes open,
and every seat three minutes idle — a resume that expires the whole board and
takes over every seat in one frame. So `resume` adds the span to all four:

```js
const span = now - state.pausedAt;
// offers[].expiresAt, roundEndsAt (when non-zero),
// every idleSince[*], every botsReadyAt[*]
```

`botsReadyAt` is the one `../design.md` §2.6 does not name and is the same bug
with a different symptom: without it, resume opens with every bot acting at
once.

Events: `{ kind: 'paused', playerId }` and `{ kind: 'resumed', playerId, span }`.

### 2.6 Abandon

Ends the session with no writes.

- First `abandon` from a seat sets `state.abandon = { by, at: now }` and emits
  `{ kind: 'abandon-proposed', playerId }`.
- `abandon` from a **different** seat sets `phase: 'abandoned'` and emits
  `{ kind: 'abandoned' }`.
- A second `abandon` from the proposing seat **cancels** the proposal. *Rec:*
  this, because it gives the client an obvious way out with no fourth action.
  *Alternative:* refuse it, and add `cancel-abandon`. *Revisit if:* two presses
  meaning two different things reads badly on the screen.
- `tick` clears a proposal older than `ABANDON_TTL_MS`, so one nobody seconds
  does not sit on the table for the rest of the session.

**One human seat abandons in one press.** The second seat exists so that one
child cannot end everybody's game; at a table with exactly one non-bot seat
there is nobody to protect, and requiring a confirmation no bot will ever send
would make the session unquittable. So the rule is: confirmation is required
only when the table holds more than one non-bot seat.

In session 3 the table always holds exactly one, so the two-seat path is
exercised by tests and by nothing else until Phase 7. It is built now because
the rules module is what Phase 7 takes unchanged.

**No writes falls out of code that already exists.** `isComplete` returns null
unless `phase === 'over'`, so `'abandoned'` writes nothing without anyone having
to remember a rule. Session 4 is what would have had to remember it.

### 2.7 Tests — `test/pit-stopped-seat.test.js`

**The clock.** `init` stamps every seat. Each of `offer`, `withdraw`, `accept`,
`harvest`, `ready`, `pause`, `resume`, `abandon` and `present` stamps the actor
and no one else. `disconnect` stamps nobody.

**Takeover.** Fires at exactly `IDLE_TAKEOVER_MS`, not at one millisecond less.
Never fires on an `isBot` seat. A taken-over seat's cards move on subsequent
ticks, which is the assertion that `bots()` actually picked it up. Any valid
action clears `takenOver` and leaves `forfeit`. `applyReady` advances the round
without waiting on a taken-over seat.

**Forfeit.** A cornered hand on a forfeited seat harvests, scores zero, ends the
round and moves no other seat's score. `deal` clears `forfeit` and the same seat
scores normally the round after. `autoCorner` produces the same result.

**Pause arithmetic — the test the mechanism exists for.** Post offers, pause,
advance `now` by ten minutes, resume, tick once: nothing expires, no seat is
taken over, no bot acts on that first tick, and `roundEndsAt`, every
`expiresAt`, every `idleSince` and every `botsReadyAt` is exactly the pause span
larger than it was. Then let time run and confirm the offers expire on their
original remaining TTL.

**Pause refusals.** While paused, `offer`, `accept`, `withdraw`, `harvest`,
`ready` and `pause` refuse with `paused`; `resume`, `abandon` and `present` do
not. `tick` while paused returns the state object it was given.

**Abandon.** One non-bot seat: one press abandons. Two non-bot seats: the first
press proposes, the same seat's second press cancels, a different seat's press
abandons, and a proposal older than `ABANDON_TTL_MS` is gone. `isComplete` is
null in `'abandoned'` and no `over` event is emitted.

**Conservation survives it** (extending `pit-rules.test.js`): the card count
invariant holds across a pause, a resume, a takeover and a forfeited harvest.

---

## 3. Getting in

`/pit/` is a static file and is not gated; the Worker serves it before any of
`worker/auth.js` runs. So `app.js` does what every hub screen does: it asks for
data first and finds out.

```js
const { players, me } = await getPlayers();   // public/shared/api.js
```

A 401 navigates to `/gate` on its own — that is `api.js`'s behaviour and not
something this client re-implements. `me === null` means nobody is chosen on
this device, and the answer is `location.replace('/')`, where the picker is
already the screen that comes up for exactly that reason.

Identity is loaded in session 3 rather than session 4 because the seat strip
needs a face and a name from the first render, and because the `plays` row
session 4 writes needs a `player_id` that is the same one this screen used.

**Bots never wear a family face.** Bot avatars are drawn from
`shared/avatars.js`, without replacement, **excluding every key any real profile
holds**. Thirty faces against six profiles leaves plenty. A bot in the
11-year-old's fox is a bot the 11-year-old will mind, and this costs one filter.

The face is the client's, not the game's: `Seat` has no avatar field and does
not get one. `app.js` keeps a `playerId → avatar key` map beside the room and
the rules module never learns that faces exist.

## 4. Setup

`../design.md` §3: how many bots sit down is asked every time, and since *C* =
seats it picks the deck too. That is the one control with no default — nothing
is preselected, and **Deal** is dark until a count is tapped. A remembered bot
count is a rule about filling short seats wearing a disguise.

| Control | Values | Remembered |
|---|---|---|
| Bots | 2–8, as tiles | **No** |
| Difficulty | easy / normal / hard | Yes |
| Target | 200 / 300 / 500 | Yes |
| Auto-harvest | off / on | Yes |

Two bots is the floor because there is one human and `minPlayers` is 3; eight
is the ceiling because `maxPlayers` is the nine commodities. Neither number is
typed on this screen. The client may not import `core/rules.js` (§9), so the
driver answers instead: `room/local.js` gains `seatLimits()`, returning the
rules module's `minPlayers` and `maxPlayers`. The room is the right place for
it — Phase 7's socket is asked the same question about the same rules — and the
tile row is built from the range, so a tenth commodity would widen it with no
edit here.

The tile row says what the answer buys: each bot tile carries its count and the
deck it makes, because "4 bots" and "five kinds in play" are the same fact and
only one of them is visible otherwise.

Auto-harvest is `../design.md` §2.4's toggle. It is on the setup screen rather
than in a settings screen because it is a per-session decision about who is
playing — the 5-year-old's session wants it and the 12-year-old's does not.

`setup.js` exports the pure part and is tested:

```js
buildSeats({ me, botCount, botLevel, avatars, rng }) -> { seats, faces }
configFrom(choices) -> { target, autoCorner }
```

`seats[0]` is the human, carrying `me.id` and `me.name`; the rest come from
session 2's `botSeats`. `faces` is the `playerId → avatar key` map §3 describes.
Pressing **Deal** builds the room, joins the human seat, and swaps the document
to the table:

```js
const room = createLocalRoom({ seats, config, seed });
room.onView(paint); room.onEvent(animate); room.onRefusal(explain);
room.join(me.id);
```

The seed is `Date.now()` mixed with one `Math.random()` — read here, in the
client, because `core/` may not read either and this is the file whose job it is
to be impure.

## 5. The table, at 360px

Top to bottom, and the order is a thumb argument: what is tapped most sits
lowest.

```
  seat strip        faces, card counts, scores, idle    ~72px
  offer board       one row per live offer              up to 5 × 64px
  the line          instruction, refusal, or receipt      32px
  harvest bar       dark until legal                      64px
  your hand         C groups, count badges, tap targets  64–136px
```

**Nothing on this screen changes size when it changes state.** The harvest bar
is present and dark from the first render rather than appearing when it lights;
the line holds its height when it is empty; a group with zero cards keeps its
slot; a seat chip's idle countdown replaces text inside the chip rather than
growing it. A live board that reflows under a finger is a board that produces
mis-taps, and a mis-tap here is a trade.

### 5.1 The hand

Every commodity in play gets a slot, always, in `view.commodities` order —
which is value order, cheapest first, and public. Zeros are greyed rather than
removed. Position is how a pre-reader finds a thing (`../../design-language.md`
§2), and a row that reorders itself as counts change is a row nobody can learn.

A slot is the `art/fruit/` crop, a count badge, and the commodity tint behind
it. The tint comes from `commodities.js` in JavaScript, which is why it lives
there and not in CSS.

**Five columns, wrapping.** At 360px, minus 16px of padding, five columns give
66px slots — above the 64px floor `theme.css` sets. *C* ≤ 5 is one row and 6–9
is two. The grid is `repeat(min(var(--hand), 5), 1fr)`: the cap is the column
count itself, not a minimum width a row is free to grow past, so the hand is
the same shape on the Chromebook as on the phone and a hand learned by position
stays learned. The hand size reaches CSS as `--hand` rather than as a number
typed into a rule (§9).

**The hand is also the target tracker.** The largest group carries a ring and
reads `7/9`; there is no separate progress widget. `../design.md` §4 asks for
counts per commodity and progress toward a corner, and with stable slots those
are one control. One less thing at 360px, and the thing removed is the one that
would have duplicated a number already on screen.

*Alternative:* a dedicated tracker bar above the hand, which is easier to make
dramatic as it fills. *Revisit if:* the kids do not notice they are one card
away — that is the moment the whole screen exists to sell.

### 5.2 The offer board

One row per live offer: the seat's face, its name, a large count numeral, and a
countdown. Rows are keyed by `offer.id` and updated in place; a row is never
recreated while it is on screen, because replacing a node under a finger cancels
the tap that was landing on it.

- `matchable: false` → greyed and not tappable. The rule is computed in
  `view()`, on the far side of the confidentiality boundary, and this side only
  reads it.
- `mine: true` → the row carries **Withdraw** instead of being tappable, and
  shows what you offered, because your own offer's commodity is yours to see.

**The countdown is CSS, not JavaScript.** The driver pushes a view only when
something changed (session 2 §5), so a sweeping bar animated from a `transform`
whose duration is `expiresAt - now` costs nothing per frame and needs no timer.
Under `prefers-reduced-motion` the bar is replaced by a seconds numeral that
updates on the tick's pushes — the countdown is information, so it cannot simply
be switched off. §5.8's takeover countdown is the same mechanism against
`idleSince + IDLE_TAKEOVER_MS`, which is why §2.1 puts an absolute stamp in the
view rather than a duration.

Five rows fit without scrolling; beyond that the board scrolls. Every seat may
hold one offer, so *C* = 9 could produce nine rows, but that is a table this
family will not sit. The layout is tuned for four to six seats and survives
nine, which is the honest ordering.

### 5.3 One mechanism for both actions

Offering and accepting both end with a tap on a hand group. That is deliberate:
**the hand is the only place a commodity is ever named**, so there is one thing
to learn and one place to look, and little-kid mode (`../design.md` §6) inherits
a screen that is already tap-only.

**Offering.** Tap a group → the line becomes a row of count buttons, `1` to
`min(held, MAX_OFFER)` → tap a count → `{ type: 'offer', commodity, count }`.
Tapping the same group again, or the group of a different commodity, moves the
selection; there is no cancel button to find.

**Accepting.** Tap an offer row → it lifts, the line says *Tap what you'll
trade*, and every group holding fewer than `count` greys → tap a group →
`{ type: 'accept', offerId, commodity }`. Tapping the row again cancels.

Two taps each, no drag, no long-press, no modal. A drag is the interaction most
likely to fail on a 4-year-old's finger and on a Chromebook trackpad at once.

**A mode that loses its subject cancels itself.** If the offer being paid for is
taken or expires while the hand is greyed, the next view has no such offer, the
mode drops back to idle, and the line says *Gone* rather than an error. Losing a
race is normal play. `present.js` does this on every view, which is why it is
`present(view, ui)` and not a mutation somewhere in `table.js`.

### 5.4 The receipt

The one moment of drama in the loop is finding out what you just got, and no
event carries it — events are counts only, permanently. The client learns it the
same way it learns everything else: **by diffing your own hand between two
views**.

```js
receiptFor(previousHand, nextHand) -> { got, gave } | null
```

The driver applies one action per push, so a diff is one trade and is
unambiguous. The `trade` event that arrives after the view names who it was
with; the view says what it was. The line shows *Peace ×3 from Mara* for a beat
and then clears.

This is also the argument for pushing whole views rather than deltas, made
concrete: a client that accumulated state from events could not produce this
sentence, because the information is not in an event and must not be.

### 5.5 Harvest

A full-width bar between the board and the hand, dark until `you.canHarvest`,
labelled **Harvest!** — `../design.md` §2.4 owns the word. It sits away from the
hand groups by the height of the line, because the tap it receives is the most
consequential one on the screen and it should not be adjacent to the most
frequent one.

With `autoCorner` set, `tick` harvests and the bar never lights. That is the
setting doing its job and needs no separate rendering.

### 5.6 Round end, as a stub

A harvest moves the state to `roundEnd`, and session 3 draws a plain panel:
who harvested what, for how many points, and a **Next round** button that sends
`ready`. When `harvest.forfeited` it reads *no points — a bot was playing*,
because a zero with no explanation is the bug report that follows. No reveal
grid, no full card art, no celebration — that is session 4, and building half of
it here means building it twice.

The stub is not optional. Without a `ready` button the round advances only on
the 30-second backstop, and a two-round test of the table becomes a
two-minute one.

### 5.7 Pause, abandon, and leaving

Three controls, all rare, none of which may sit next to a hand group. *Rec:* one
**Menu** at the left of the seat strip opens a sheet holding **Pause**,
**Abandon game** and **Leave**. *Alternative:* a pause button living permanently
in the seat strip, one tap instead of two. *Revisit if:* pausing turns out to be
frequent — `../design.md` §2.6 says the deliberate absence is most of them, and
a meal is not something you want to hunt for a menu during.

**Paused** draws a scrim over the board, the line and the hand, with the word and
a **Resume** button on it. The seat strip stays visible above it, because who is
at the table is the thing you look at while waiting. Nothing under the scrim is
tappable, which needs no special casing: §2.5 refuses those actions anyway, and
`present.js` marks everything untappable from `view.pausedAt` so a tap does not
travel to the rules module to be told no.

**Abandon game** sends `abandon`. With one human at the table that ends it, so
the sheet asks first — the client's own confirmation, not the rules module's.
When `view.abandon` is set the table draws a banner naming the seat that
proposed and offering **End it** and **Keep playing**; that path does not occur
in session 3 and is drawn anyway, because it is three lines and Phase 7 is when
finding it missing would be expensive.

**Leave** is a back link to `/`, one tap, in the same place sudoku's is, calling
`room.leave()` on the way out. It is honestly redundant with Abandon at a
one-human table — nothing is written either way — and it stays because a game
the 5-year-old cannot get out of is a game they stop opening, and because
closing the tab is what they will actually do.

### 5.8 The seat that stopped, on screen

`../design.md` §2.6: sixty seconds of a frozen board is several rounds' worth of
dead air, and a seat vanishing without explanation reads as a bug.

Each seat chip shows nothing until its seat is thirty seconds idle, then the
countdown: *Bo — away 24*. *Rec:* thirty, half of `IDLE_TAKEOVER_MS` — earlier
is noise on a table where a median round is seventeen seconds, later is not a
warning. At takeover the chip swaps the face for a bot mark and reads *Bot
playing*; a `forfeited` seat's score is dimmed for the rest of the round.

When the taken-over seat is **yours**, the line says *A bot is playing your
seat — tap anything to take it back* and holds until it is reclaimed. That is
the one line on this screen that is not a receipt and does not clear itself.

**`present` is sent by `app.js`, throttled, and never on every tap.**
`../design.md` §2.6's *Rec* is a no-op action on any interaction so that a
player deliberating with a thumb on the screen is not mistaken for one whose
phone is in a pocket. Sent literally on every tap and scroll it is a full view
push per scroll event. So:

```js
onInteraction(ui, view, now) -> { ui, action? }   // present.js, pure
```

It returns a `present` action only when the seat is already more than thirty
seconds idle — below that the seat is plainly active and the stamp buys
nothing — and at most one every five seconds. `lastPresentAt` lives in `ui` so
the throttle stays pure and testable; `app.js` calls it from a `pointerdown`
and a scroll listener and does no arithmetic of its own.

## 6. `present.js`

The whole of the screen's logic, as pure functions over a `View` and one small
object of local intent.

```js
export const idle = { mode: 'idle' };            // 'idle' | 'compose' | 'pay'

/** A tap, resolved against the current view: the next intent, and what to send. */
onTap(ui, view, target) -> { ui, action?: Action }

/** A tap or scroll that is not a control: §5.8's throttled presence stamp. */
onInteraction(ui, view, now) -> { ui, action?: Action }

/** Everything table.js paints, resolved. No decisions left in it. */
present(view, ui, now) -> Screen

/** What changed in your own hand, for §5.4's line. */
receiptFor(previousHand, nextHand) -> { got, gave } | null
```

`target` is `{ kind: 'group', commodity }`, `{ kind: 'count', n }`,
`{ kind: 'offer', id }`, `{ kind: 'withdraw' }`, `{ kind: 'harvest' }`,
`{ kind: 'ready' }`, `{ kind: 'menu' }`, `{ kind: 'pause' }`,
`{ kind: 'resume' }` or `{ kind: 'abandon' }` — the vocabulary of things on the
screen, not DOM events. `table.js` translates a click into one of these and
knows nothing else.

`Screen` carries: the seat strip rows with their idle, takeover and forfeited
fields resolved; the offer rows with their greyed, tappable, mine and countdown
fields resolved; the hand slots with count, tint, art path, tappable, ringed and
progress; the line's text and kind; the harvest bar's state; the paused scrim
and the abandon banner when the view calls for them; and the round-end panel
when the phase calls for one. No field on it needs interpreting.

**`present` re-derives the mode.** It takes `ui` and returns a `Screen`
consistent with the view it was given — the self-cancelling in §5.3 happens
here, and `app.js` adopts the corrected `ui` that comes back with it. A mode
that could survive a view it no longer matches is the bug class this shape
removes. A pause is the same case: `pausedAt` set drops any mode to idle, so
resuming does not resume into a half-composed offer against a board that moved.

## 7. Events, and what they are for

`onEvent` drives motion only, per session 2 §5: a card back flicking between two
seat chips on `trade`, a badge pulse on `offer`, a fade on `expired`, a chip
dimming on `takeover` and lighting on `reclaim`. 200–400ms,
`prefers-reduced-motion` honoured, and nothing behind an animation anybody has
to wait out.

**No state is derived from an event, ever.** The view is the truth. The rule is
in session 2's spec and is repeated here because this session is the first one
with something to animate and therefore the first one that could break it. The
paused scrim is drawn from `view.pausedAt`, not from the `paused` event, for
exactly this reason: a client that joined mid-pause never saw the event.

The trade animation moves `art/cards/back.webp` and nothing else. A back that
differed by commodity would be the leak the whole game is built to prevent, and
the asset exists in one file precisely so this animation has nothing else to
reach for.

## 8. Art

Live play uses `art/fruit/` only — the circular crop, no text, legible at 40px.
The full `art/cards/` illustration does not appear in this session at all;
`../design.md` §4 puts it in the round-end reveal, the harvest celebration and
the shelf tile, and the first two are session 4.

On the first view of a session the client constructs an `Image()` for each of
`view.commodities` before the first paint. Which *C* are in play is not known
until the deal, so a `<link rel="preload">` in the head cannot name them; twelve
kilobytes apiece makes the whole set cheap enough not to need cleverness.

Every commodity is carried by its picture **and** its tint, never by its name
alone — `../../design-language.md` §2's avatar rule, and the reason the
exclusion pairs in `../design.md` §2.1 exist. Where a name is shown it is the
virtue, per `../design.md` §2.1; no label in the client reads a fruit.

## 9. Numbers, and where they are not

`HAND`, `MAX_OFFER` and the point values stay in `commodities.js`. The client
imports them; it does not restate them. `IDLE_TAKEOVER_MS` and `ABANDON_TTL_MS`
stay in `rules.js` beside the other durations (§2.1); the client reaches them
through the view's timestamps and never names either.

Markup and CSS reach the counts through custom properties — `--hand` and
`--max-offer`, set once in `app.js` from the imported constants — so no rule
in `pit.css` names a count and the little-kid mode that changes all three
changes them in one file.

The existing grep stays JavaScript-only and is extended to `public/pit/ui/` and
`public/pit/store/`. It is deliberately not extended to CSS: a stylesheet is
full of `4px` and `#9aa6b8`, and a grep that fires on those is a grep somebody
will disable. What defends the CSS is that no rule in it needs a count, which
§5.1 makes true by construction.

## 10. Tests

§2.7 covers the rules half. The rest is `present.js` and `setup.js`.

**The mode machine.** Tap a group from idle → compose, with the right count
buttons: `1..min(held, MAX_OFFER)`, never more, never one for a group of zero.
Tap a count → the action, and back to idle. Tap an offer → pay, with groups
below `count` untappable. Tap a group in pay → an accept naming that commodity.
Tap the same offer again → idle, no action.

**Self-cancelling.** Present a `pay` intent against a view whose offer is gone:
the returned intent is idle and the line says so. Same for a `compose` intent on
a commodity the hand no longer holds — which happens when a trade you accepted
emptied it. Same for any intent against a view with `pausedAt` set.

**The greying matches the boundary.** For a random state, every offer row's
tappability equals `view.offers[].matchable`, and no row is tappable that the
rules module would refuse. This is the test that would catch a client that
recomputed the rule instead of reading it.

**Paused is untappable.** Against a view with `pausedAt` set, no hand slot,
offer row or harvest bar in the `Screen` is tappable, and `onTap` on any of them
returns no action. Resume and Abandon still do.

**The hand is complete and ordered.** Slots are exactly `view.commodities`, in
that order, zeros included, for every seat count from `minPlayers` to
`maxPlayers`. The ring is on the largest group, and its readout is
`held/HAND`.

**The receipt.** A hand before and after an accept gives the right `got` and
`gave`; an unchanged hand gives `null`; a hand that only lost cards — an offer
posted — gives `gave` and no `got`.

**The idle chips.** A seat 29s idle shows nothing and a seat 31s idle shows a
countdown; a seat in `takenOver` reads as a bot and its score is dimmed while
it is in `forfeit`; your own taken-over seat produces the reclaim line.

**The presence throttle.** `onInteraction` returns nothing for a seat 10s idle,
returns a `present` for one 40s idle, and returns nothing on a second call two
seconds later. It reads no clock — `now` is an argument and `lastPresentAt`
comes back in `ui`.

**Setup.** `buildSeats` returns `botCount + 1` seats, the human first with the
chosen id, bot ids unique, and no bot face equal to any real profile's avatar.
Bot counts outside 2..8 are refused. `configFrom` takes plain choices rather
than a form element — that is what keeps it testable — produces the target and
the toggle, and falls back on an unrecognised remembered value rather than
letting it reach `init`.

**Purity, as greps** (extending `pit-core-purity.test.js`):

- `public/pit/ui/present.js` names no `document`, `window`, `localStorage`,
  `Date.now` or `Math.random`. It is the file CI can reach, and it is only worth
  reaching while that is true.
- No file under `public/pit/` outside `core/` and `room/` imports
  `core/rules.js` — session 2's grep, now with files under it to catch.
- The size literals, over `ui/` and `store/` as well as `core/`.

## 11. Acceptance criteria

1. `node --test 'test/*.test.js'` passes, existing suites included.
2. A seat that stops acting is played by a bot sixty seconds later, scores
   nothing for that round, and is reclaimed by any action it sends.
3. A pause of arbitrary length resumes with every offer, the reveal backstop,
   every bot gate and every idle clock carrying the same time remaining they
   had when it was set — asserted by §2.7's arithmetic test, and the reason
   there is no separate "pause does not break the board" criterion.
4. `abandon` reaches `phase: 'abandoned'` and `isComplete` stays null, so
   nothing is writable out of an abandoned session.
5. `/pit/` loads, asks who you are, and refuses to deal until a bot count is
   tapped.
6. A session plays through the screen: offers post, offers are accepted, hands
   change, a corner lights the bar, pressing it scores and the next round deals.
7. Pause, resume and abandon are reachable from the table, and a seat going idle
   shows a countdown before its bot takes over rather than after.
8. `public/pit/ui/` and `public/pit/store/` do not import `core/rules.js`, and
   `present.js` touches no DOM.
9. No commodity of another seat appears anywhere in the DOM during `trading` —
   asserted by the leak test on `view()` in session 1 plus criterion 8, which
   together leave the client with nothing to leak.
10. Nothing outside `commodities.js` contains `HAND`, `MAX_OFFER` or a point
    value, over the two new directories.
11. No animation exceeds 400ms and every one of them is off under
    `prefers-reduced-motion`; both countdowns degrade to a numeral rather than
    disappearing.

Everything about how this feels on a phone is **S10** in
`../../sudoku/specs/questions.md`, with the device and the person named. A
layout criterion that CI cannot reach is not written here as though it could be.
Whether sixty seconds is the right number for a 5-year-old is one of them; it is
not a test.

## 12. Explicitly not in this session

The round-end reveal, the harvest celebration, the full card art, the
end-of-session screen and the `plays` row — all session 4, and §5.6's stub is
the smallest thing that lets rounds follow one another before then.

Abandoning after several rounds a seat never comes back for.
`../design.md` §2.6 leaves that to a person pressing the button, and sets no
count on it. Building an automatic one before anybody has watched it happen
would be building against a guess.

Sound. `../../design-language.md` §2 has it off by default with a per-device
toggle; the first noise worth making is the harvest, which is session 4's.

The game's tile on the hub shelf. `public/shared/games.js` gains a second entry
when there is a finished game to put on it, which is session 4.

`GameRoom`, sockets, reconnect, a lobby, a room code (Phases 6 and 7). The
client talks to `room/local.js` through six methods and will not notice the
swap; the room's disconnect grace timer sits in front of §2.3's sixty seconds
rather than replacing it.

Little-kid mode (Phase 9), whose no-text rule this screen is built to be able to
satisfy — the `fruit/` crops carry no text and the two-tap mechanism needs no
reading — but which is not built here. `IDLE_TAKEOVER_MS` is the number it is
most likely to want changed.
