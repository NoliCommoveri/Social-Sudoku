# Session 3 — The table

The screen. At the end of it a person opens `/pit/`, says how many bots sit
down, and plays rounds of Pit against them on a phone: a hand that groups by
commodity, an offer board, blind swaps that resolve in front of them, and a
Harvest button that lights when it is legal.

Sessions 1 and 2 left a game that only a test file can play. This session gives
it its only consumer. Nothing here knows the rules — `../../../CLAUDE.md`'s
"rules modules never write" has a twin on this side: **the client never
computes**. It renders a `View` and sends an `Action`, and the grep session 2
added is what keeps that true.

**Cost: Medium–Large, ~70k.**

## 1. Files

```
public/pit/index.html          setup and table in one document
public/pit/ui/app.js           wiring: identity, setup, the room, the callbacks
public/pit/ui/present.js       the pure half — view + intent → what to paint
public/pit/ui/table.js         the DOM half — paints a Screen, reports taps
public/pit/ui/setup.js         the room-setup screen, and the seat list it builds
public/pit/ui/pit.css          the table, on the shared tokens
public/pit/store/local.js      three remembered settings, and nothing else
public/pit/room/local.js       seatLimits, for the setup screen (edit)

test/pit-present.test.js       the mode machine, the groups, the receipt
test/pit-setup.test.js         seats and config out of the setup form
test/pit-core-purity.test.js   greps extended (edit)
```

One HTML document holds both screens. A second file would duplicate the head and
the token link, and navigating between them would drop the room the first one
built — the setup screen's whole output is a live `Room` object, which does not
survive a page load.

`store/local.js` mirrors sudoku's and holds preferences only. **No game is
saved.** A trading game against bots that runs on a tick has nothing meaningful
to resume into; what happens to a session abandoned mid-round is session 4's
question, and answering it here would be answering it twice.

### 1.1 The pure half is where the work goes

`present.js` touches no DOM, and neither do the two functions `setup.js` exports
for the deal; those are what `node --test` can reach. `table.js` cannot be tested at all — there is no jsdom, because there
are no dependencies — so **the size of `table.js` is the size of what CI cannot
check**, and the split is drawn to keep it boring: create elements, set text,
set classes, attach listeners, call `onTap`. Every decision — which groups are
tappable, what a tap means, when a mode cancels itself, what the badge says — is
made in `present.js` against a plain object and asserted in a test file.

## 2. Getting in

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

## 3. Setup

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
typed on this screen. The client may not import `core/rules.js` (§8), so the
driver answers instead: `room/local.js` gains `seatLimits()`, returning the
rules module's `minPlayers` and `maxPlayers`. The room is the right place for
it — Phase 7's socket is asked the same question about the same rules — and the
tile row is built from the range, so a tenth commodity would widen it with no
edit here.

The tile row says what the answer buys: each bot tile carries its count and the
deck it makes, because "4 bots" and "five fruit in play" are the same fact and
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
session 2's `botSeats`. `faces` is the `playerId → avatar key` map §2 describes.
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

## 4. The table, at 360px

Top to bottom, and the order is a thumb argument: what is tapped most sits
lowest.

```
  seat strip        faces, card counts, scores           ~72px
  offer board       one row per live offer               up to 5 × 64px
  the line          instruction, refusal, or receipt       32px
  harvest bar       dark until legal                       64px
  your hand         C groups, count badges, tap targets   64–136px
```

**Nothing on this screen changes size when it changes state.** The harvest bar
is present and dark from the first render rather than appearing when it lights;
the line holds its height when it is empty; a group with zero cards keeps its
slot. A live board that reflows under a finger is a board that produces
mis-taps, and a mis-tap here is a trade.

### 4.1 The hand

Every commodity in play gets a slot, always, in `view.commodities` order —
which is value order, cheapest first, and public. Zeros are greyed rather than
removed. Position is how a pre-reader finds a thing (`../../design-language.md`
§2), and a row that reorders itself as counts change is a row nobody can learn.

A slot is the `art/fruit/` crop, a count badge, and the commodity tint behind
it. The tint comes from `commodities.js` in JavaScript, which is why it lives
there and not in CSS.

**Five columns, wrapping.** At 360px, minus 16px of padding, five columns give
68px slots — above the 64px floor `theme.css` sets. *C* ≤ 5 is one row and 6–9
is two. The grid is `repeat(auto-fit, minmax(64px, 1fr))` with a five-column
cap, and the hand size reaches CSS as `--hand` rather than as a number typed
into a rule (§8).

**The hand is also the target tracker.** The largest group carries a ring and
reads `7/9`; there is no separate progress widget. `../design.md` §4 asks for
counts per commodity and progress toward a corner, and with stable slots those
are one control. One less thing at 360px, and the thing removed is the one that
would have duplicated a number already on screen.

*Alternative:* a dedicated tracker bar above the hand, which is easier to make
dramatic as it fills. *Revisit if:* the kids do not notice they are one card
away — that is the moment the whole screen exists to sell.

### 4.2 The offer board

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
be switched off.

Five rows fit without scrolling; beyond that the board scrolls. Every seat may
hold one offer, so *C* = 9 could produce nine rows, but that is a table this
family will not sit. The layout is tuned for four to six seats and survives
nine, which is the honest ordering.

### 4.3 One mechanism for both actions

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

### 4.4 The receipt

The one moment of drama in the loop is finding out what you just got, and no
event carries it — events are counts only, permanently. The client learns it the
same way it learns everything else: **by diffing your own hand between two
views**.

```js
receiptFor(previousHand, nextHand) -> { got, gave } | null
```

The driver applies one action per push, so a diff is one trade and is
unambiguous. The `trade` event that arrives after the view names who it was
with; the view says what it was. The line shows *Kiwi ×3 from Mara* for a beat
and then clears.

This is also the argument for pushing whole views rather than deltas, made
concrete: a client that accumulated state from events could not produce this
sentence, because the information is not in an event and must not be.

### 4.5 Harvest

A full-width bar between the board and the hand, dark until `you.canHarvest`,
labelled **Harvest!** — `../design.md` §2.4 owns the word. It sits away from the
hand groups by the height of the line, because the tap it receives is the most
consequential one on the screen and it should not be adjacent to the most
frequent one.

With `autoCorner` set, `tick` harvests and the bar never lights. That is the
setting doing its job and needs no separate rendering.

### 4.6 Round end, as a stub

A harvest moves the state to `roundEnd`, and session 3 draws a plain panel:
who harvested what, for how many points, and a **Next round** button that sends
`ready`. No reveal grid, no full card art, no celebration — that is session 4,
and building half of it here means building it twice.

The stub is not optional. Without a `ready` button the round advances only on
the 30-second backstop, and a two-round test of the table becomes a
two-minute one.

### 4.7 Leaving

A back link to `/`, one tap, in the same place sudoku's is. It calls
`room.leave()` on the way out. A game the 5-year-old cannot get out of is a game
they stop opening.

## 5. `present.js`

The whole of the screen's logic, as pure functions over a `View` and one small
object of local intent.

```js
export const idle = { mode: 'idle' };            // 'idle' | 'compose' | 'pay'

/** A tap, resolved against the current view: the next intent, and what to send. */
onTap(ui, view, target) -> { ui, action?: Action }

/** Everything table.js paints, resolved. No decisions left in it. */
present(view, ui, now) -> Screen

/** What changed in your own hand, for §4.4's line. */
receiptFor(previousHand, nextHand) -> { got, gave } | null
```

`target` is `{ kind: 'group', commodity }`, `{ kind: 'count', n }`,
`{ kind: 'offer', id }`, `{ kind: 'withdraw' }`, `{ kind: 'harvest' }` or
`{ kind: 'ready' }` — the vocabulary of things on the screen, not DOM events.
`table.js` translates a click into one of these and knows nothing else.

`Screen` carries: the seat strip rows; the offer rows with their greyed,
tappable, mine and countdown fields resolved; the hand slots with count, tint,
art path, tappable, ringed and progress; the line's text and kind; the harvest
bar's state; and the round-end panel when the phase calls for one. No field on
it needs interpreting.

**`present` re-derives the mode.** It takes `ui` and returns a `Screen`
consistent with the view it was given — the self-cancelling in §4.3 happens
here, and `app.js` adopts the corrected `ui` that comes back with it. A mode
that could survive a view it no longer matches is the bug class this shape
removes.

## 6. Events, and what they are for

`onEvent` drives motion only, per session 2 §5: a card back flicking between two
seat chips on `trade`, a badge pulse on `offer`, a fade on `expired`. 200–400ms,
`prefers-reduced-motion` honoured, and nothing behind an animation anybody has
to wait out.

**No state is derived from an event, ever.** The view is the truth. The rule is
in session 2's spec and is repeated here because this session is the first one
with something to animate and therefore the first one that could break it.

The trade animation moves `art/cards/back.webp` and nothing else. A back that
differed by commodity would be the leak the whole game is built to prevent, and
the asset exists in one file precisely so this animation has nothing else to
reach for.

## 7. Art

Live play uses `art/fruit/` only — the circular crop, no text, legible at 40px.
The full `art/cards/` illustration does not appear in this session at all;
`../design.md` §4 puts it in the round-end reveal, the harvest celebration and
the shelf tile, and the first two are session 4.

On the first view of a session the client constructs an `Image()` for each of
`view.commodities` before the first paint. Which *C* are in play is not known
until the deal, so a `<link rel="preload">` in the head cannot name them; twelve
kilobytes apiece makes the whole set cheap enough not to need cleverness.

Every commodity is carried by its fruit **and** its tint, never by its name
alone — `../../design-language.md` §2's avatar rule, and the reason the
exclusion pairs in `../design.md` §2.1 exist.

## 8. Numbers, and where they are not

`HAND`, `MAX_OFFER` and the point values stay in `commodities.js`. The client
imports them; it does not restate them.

Markup and CSS reach them through custom properties — `--hand` and
`--max-offer`, set once in `app.js` from the imported constants — so no rule
in `pit.css` names a count and the little-kid mode that changes all three
changes them in one file.

The existing grep stays JavaScript-only and is extended to `public/pit/ui/` and
`public/pit/store/`. It is deliberately not extended to CSS: a stylesheet is
full of `4px` and `#9aa6b8`, and a grep that fires on those is a grep somebody
will disable. What defends the CSS is that no rule in it needs a count, which
§4.1 makes true by construction.

## 9. Tests

**The mode machine.** Tap a group from idle → compose, with the right count
buttons: `1..min(held, MAX_OFFER)`, never more, never one for a group of zero.
Tap a count → the action, and back to idle. Tap an offer → pay, with groups
below `count` untappable. Tap a group in pay → an accept naming that commodity.
Tap the same offer again → idle, no action.

**Self-cancelling.** Present a `pay` intent against a view whose offer is gone:
the returned intent is idle and the line says so. Same for a `compose` intent on
a commodity the hand no longer holds — which happens when a trade you accepted
emptied it.

**The greying matches the boundary.** For a random state, every offer row's
tappability equals `view.offers[].matchable`, and no row is tappable that the
rules module would refuse. This is the test that would catch a client that
recomputed the rule instead of reading it.

**The hand is complete and ordered.** Slots are exactly `view.commodities`, in
that order, zeros included, for every seat count from `minPlayers` to
`maxPlayers`. The ring is on the largest group, and its readout is
`held/HAND`.

**The receipt.** A hand before and after an accept gives the right `got` and
`gave`; an unchanged hand gives `null`; a hand that only lost cards — an offer
posted — gives `gave` and no `got`.

**Setup.** `buildSeats` returns `botCount + 1` seats, the human first with the
chosen id, bot ids unique, and no bot face equal to any real profile's avatar.
Bot counts outside 2..8 are refused. `configFrom` takes plain choices rather than a form
element — that is what keeps it testable — produces the target and the toggle,
and falls back on an unrecognised remembered value rather than letting it reach
`init`.

**Purity, as greps** (extending `pit-core-purity.test.js`):

- `public/pit/ui/present.js` names no `document`, `window`, `localStorage`,
  `Date.now` or `Math.random`. It is the file CI can reach, and it is only worth
  reaching while that is true.
- No file under `public/pit/` outside `core/` and `room/` imports
  `core/rules.js` — session 2's grep, now with files under it to catch.
- The size literals, over `ui/` and `store/` as well as `core/`.

## 10. Acceptance criteria

1. `node --test 'test/*.test.js'` passes, existing suites included.
2. `/pit/` loads, asks who you are, and refuses to deal until a bot count is
   tapped.
3. A session plays through the screen: offers post, offers are accepted, hands
   change, a corner lights the bar, pressing it scores and the next round deals.
4. `public/pit/ui/` and `public/pit/store/` do not import `core/rules.js`, and
   `present.js` touches no DOM.
5. No commodity of another seat appears anywhere in the DOM during `trading` —
   asserted by the leak test on `view()` in session 1 plus criterion 4, which
   together leave the client with nothing to leak.
6. Nothing outside `commodities.js` contains `HAND`, `MAX_OFFER` or a point
   value, over the two new directories.
7. No animation exceeds 400ms and every one of them is off under
   `prefers-reduced-motion`; the countdown degrades to a numeral rather than
   disappearing.

Everything about how this feels on a phone is **S10** in
`../../sudoku/specs/questions.md`, with the device and the person named. A
layout criterion that CI cannot reach is not written here as though it could be.

## 11. Explicitly not in this session

The round-end reveal, the harvest celebration, the full card art, the
end-of-session screen and the `plays` row — all session 4, and §4.6's stub is
the smallest thing that lets rounds follow one another before then.

Sound. `../../design-language.md` §2 has it off by default with a per-device
toggle; the first noise worth making is the harvest, which is session 4's.

The game's tile on the hub shelf. `public/shared/games.js` gains a second entry
when there is a finished game to put on it, which is session 4.

`GameRoom`, sockets, reconnect, a lobby, a room code (Phases 6 and 7). The
client talks to `room/local.js` through six methods and will not notice the
swap.

Little-kid mode (Phase 9), whose no-text rule this screen is built to be able to
satisfy — the `fruit/` crops carry no text and the two-tap mechanism needs no
reading — but which is not built here.
