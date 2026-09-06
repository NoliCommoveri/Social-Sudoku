# Session 2 — Bots and the local driver

Two things that between them make session 1's rules module playable: opponents
that trade, and something for a client to talk to. At the end of it Pit is a
full session — deal, trade, corner, score, redeal, finish — driven by a fake
clock in a test file, with three bots doing the trading and one seat acting for
the human. Still no pixels; session 3 renders what this session pushes.

The driver is the surface `README.md` says both drivers implement. Phase 7
replaces it with a socket to `GameRoom` and the client does not notice.

**Cost: Medium, ~50k.**

## 1. Files

```
public/pit/core/bot.js        botAction, botDelay, the three levels
public/pit/core/rules.js      tick gains bot gating (edit)
public/pit/room/local.js      the driver, and bot identity

test/pit-bots.test.js         legal moves, the target invariant, determinism
test/pit-local-room.test.js   a session end to end on a fake clock
test/pit-core-purity.test.js  two greps added (edit)
```

`bot.js` sits in `core/` because it is pure and because the same file runs in
the Durable Object in Phase 7. It imports `commodities.js` and nothing else —
in particular not `rules.js`, which is what makes "a bot cannot reach State"
mechanical rather than intended. A grep asserts it.

## 2. Who runs the bots

**`tick` does.** A bot seat's turn is gated on `botsReadyAt[playerId]`; when the
gate opens, `tick` builds that seat's view, calls `botAction`, validates the
result and applies it, then resets the gate to a freshly sampled delay. Nothing
outside the rules module knows a bot exists.

This is the one place session 2 departs from `../../gameroom.md`, whose §3 gives
bot scheduling to the room and whose §4 hangs `botAction` off the rules
interface for the room to call. It cannot work that way here: **`State` is
opaque to the room**, so the gate that session 1 put in `botsReadyAt` is not a
field the room is allowed to read. The choice was between deleting that field
and moving the gate into whichever driver is attached — where the local driver
and the Durable Object would then each carry their own copy of the same loop —
or keeping it and letting `tick` drive. Two drivers with two bot loops is the
divergence Phase 7 would spend a session finding.

*Alternative:* the room owns the loop and the rules module exposes
`botAction`, `botSeats(state)` and a gate accessor for it. That is `gameroom.md`
§4 as written, and it costs three interface members to say what one already-ticking
function says. *Revisit if:* a second game wants bots and wants them scheduled
differently, or if a room ever needs to throttle bot activity from outside the
rules.

Two consequences worth stating rather than discovering. `pitRules` gains no
`botAction` member — `bot.js` exports it for the tests and for a future room
that wants it, and `tick` is the only caller in this tree. And `gameroom.md` §3
and §4 are rewritten to match when Phase 6 is built, not before: they describe a
room that does not exist, and the shape it should take is this one.

### 2.1 One bot per tick

When several gates are open at once, `tick` acts for the seat with the oldest
open gate and leaves the rest for the next tick. Three reasons, all of them
real: a phone that has been backgrounded comes back with every gate open and
would otherwise fire four bot actions into one frame; the client gets one
change per view push, which is what animates legibly; and the Durable Object's
work per alarm stays bounded.

At `tickIntervalMs = 500` this caps the table at two bot actions a second, which
is faster than any of the latency ranges in §3 asks for.

### 2.2 Seeding the gate

`deal` clears `botsReadyAt`, so at the start of a round every bot's gate is
absent. **An absent gate is not an open gate.** The first tick of a round seeds
each one with `now + botDelay(...)`; otherwise every bot would act on the first
tick after the deal and the round would open with a flurry.

### 2.3 Randomness

`tick` is pure and takes no rng, so the stream the bots draw from comes out of
state: `mulberry32(seed ^ round-stride ^ botSeq)`, where `botSeq` is a new
top-level counter incremented once per bot evaluation. It is session-long and
never reset — resetting it per round would hand two rounds the same stream.

`botSeq` is the only addition to `State` this session makes. It is a number, it
serializes, and the state stays plain JSON.

## 3. The three levels

`Seat.botLevel` is `'easy' | 'normal' | 'hard'`, defaulting to `'normal'` when
absent or unrecognised — a typo in a seat list must not crash a game.

| Level | Public history it reads | Latency | Noise |
|---|---|---|---|
| `easy` | none — the current board only | 1600–3200ms | 25% |
| `normal` | the last 8 events | 1000–2200ms | 12% |
| `hard` | the last 24 events | 800–1600ms | 5% |

**Difficulty is a restriction on what the bot reads, not a handicap applied to
what it decides.** `../design.md` §3.2 is explicit that a bot logging the whole
count history and inferring who is cornering what is plausibly stronger than the
humans; the cap is deliberate. The window is a slice of `view.history`, which
`deal` resets, so no bot remembers across a round.

**Latency is sampled by a function that cannot see the board.**
`botDelay(level, rng)` takes the level and the rng and nothing else. That
signature is the whole guarantee: a bot that hesitated on bad offers and pounced
on good ones would be read as a tell within one session, and the only way to be
sure it does not is to make the correlation unexpressible.

**Noise** is one probability, applied once per evaluation: with probability
`noise` the bot takes a random legal alternative to the action it chose,
including doing nothing. That produces the occasional bad trade, the occasional
pass on a good offer and the occasional pointless target switch that
`../design.md` §3.2 asks for, out of one knob rather than three. The
alternatives are drawn from the legal *and target-safe* set — noise perturbs
preference and never the invariant in §4.1, because a bot that dumps its own
corner reads as broken rather than as human.

## 4. `botAction(view, level, rng) -> Action | null`

Pure, and its only input about the game is a `view` — the same one a human seat
gets, per `../../gameroom.md` §4.2. It is not a `State`, it cannot be made into
one, and `bot.js` has no import that would let it try.

Evaluated in order; the first that applies is the action.

1. **Harvest.** `view.you.canHarvest` → `{ type: 'harvest' }`. Outranks
   everything and is exempt from noise. A bot that misses its own corner reads
   as a bug, and the tension `../design.md` §2.4 is protecting is the human's.
2. **Not trading.** `view.phase !== 'trading'` → `null`. Bots never send
   `ready`; `apply` waits only on human seats.
3. **Withdraw.** Its own live offer holds what is now its target → withdraw.
   This happens when trades made the offered commodity the largest holding.
   Nothing else withdraws; expiry clears the rest.
4. **Accept.** The best matchable offer, subject to §4.1 and §4.2.
5. **Offer.** No live offer and a non-target block to dump → offer it.
6. Otherwise `null`.

### 4.1 The target, and the one invariant

The target is the commodity the bot holds most of. **Ties break on a stable
hash of `(playerId, round, commodity)`, not on the injected rng**, so the target
does not thrash between two equal holdings across evaluations. That is the whole
of the hysteresis `../design.md` §3.1 asks for: a bot is a pure function of a
view and has nowhere to remember a previous target, and the only durable place
would be `State`, which is not where bot brains belong.

Roughly one bot in ten is **contrarian** for the round — decided by the same
stable hash, so it holds for the round rather than flickering per call. A
contrarian bot targets the highest-value commodity it holds at least two of and
keeps it whatever overtakes it.

**The invariant, and it is the only one: a bot never gives away a card of its
target.** Every offer and every accept is paid for out of a non-target block.
This is `../design.md` §3.1's "the real filter" and it is what a test asserts
directly, because everything else about a bot is taste and this is not.

### 4.2 Accepting

An offer of count *K* is takeable when the bot holds *K* or more of some single
non-target commodity. It pays from its **largest** such block: a non-target pile
that big is a second corner the bot has decided not to chase, and it cannot
chase two. *K* unknown cards beat *K* cards it has already declined to want.

Hard and normal bots add one read of the count channel. Over the remembered
window, each other seat gets a **pressure** score — its events at count 1 or 2
minus its events at count 3 or more. A player trading small is fine-tuning near
a corner. The bot declines a small offer (*K* ≤ 2) from the highest-pressure
seat, because accepting hands that seat a matched block, which is exactly how it
finishes. It takes the offer anyway when its own hand is within two cards of a
corner, which is the point at which nobody is playing defence any more.

Easy bots skip this entirely; they see no history to compute it from.

### 4.3 Offering

Candidates are every non-target commodity, each offerable as a block of
`min(count, MAX_OFFER)`. The bot posts the largest block, ties broken on the
injected rng — the largest block moves the most junk per trade, and it is also
the hardest for anyone to match, which is a real cost the noise in §3 pays
occasionally by posting a smaller one.

A bot with nothing but its target holds no offer and returns `null`. That is a
bot one card from a corner sitting still, which is correct.

## 5. The driver

```js
createLocalRoom({ seats, config, seed, clock }) -> Room
```

`clock` is `{ now: () => number, every: (ms, fn) => cancel }`, defaulting to
`Date.now` and `setInterval`. It is injected for one reason: `node --test` has
to play a full session in milliseconds, and a driver that reads the wall clock
cannot be tested at all. The browser gets the default and never passes one.

The returned `Room` has exactly the six members `README.md` names and no others:

```js
join(seat)      // which seat this client occupies; pushes a view, starts the clock
act(action)     // fire and forget
onView(fn)      // full view, after every applied action and every changed tick
onEvent(fn)     // public events only
onRefusal(fn)   // ({ action, reason })
leave()         // stops the clock, drops the callbacks; idempotent
```

A test asserts the key set. The driver holds `state` in a closure and there is
no accessor for it: `view(state, viewerId)` is the only thing that crosses, so a
client cannot read another hand even by reaching past the callbacks.

**One viewer per driver.** `local.js` is the client's end of a connection, not
the room seen from above — that is the symmetry that lets a socket replace it.
A second `join` replaces the viewer and pushes a fresh view, which is the same
thing the room's reconnect will do.

**`act`** validates immediately before applying, in the same turn — §4.1 of
session 1's spec, and the reason the loser of a race gets `taken` rather than a
half-applied trade. A refusal calls `onRefusal` and pushes no view, because
nothing changed. Before `join`, `act` refuses with `not-joined`.

**The tick** runs every `tickIntervalMs` and pushes a view only when the state
actually changed, which `tick` reports by returning the state it was given. A
view every 500ms to move a countdown would be a re-render four times a second
for nothing: `expiresAt` is in the view and the client animates from it.

**Callback order is view, then events.** The view is the truth and the events
are garnish for animation and sound. A client that had to accumulate state from
events would be a client that drifts, and the first thing to drift would be a
hand.

**A backgrounded tab** comes back to one tick with a large `now` delta. Expiry
is timestamped so it self-corrects; §2.1 keeps the bots from firing all at once.
The catch-up is one tick, not one per 500ms missed.

**`leave`** cancels the timer and clears the callbacks. For the local driver
there is nothing to go back to; session 4 decides what happens to a session
abandoned mid-round.

### 5.1 Bot identity

The driver owns it, which answers `../../gameroom.md` §10's third open question
for Pit: bot names and ids come from `local.js`, not from the rules module.
`botSeats(n, level, rng)` returns *n* seats with ids `bot-1`… and names drawn
without replacement from a fixed list in the file. Names are eight characters or
fewer because the seat strip has to hold four of them at 360px, and they are
plain first names — a bot that announces itself as a bot in its name is a bot
the 5-year-old will not want to play.

`../design.md` §3 has the bot count asked at room setup every time, which is
also the deck size, so it is the client in session 3 that calls this.

## 6. Tests

**Every action a bot returns is legal.** Over many seeded games, at every level
and every seat count, `validate(state, botId, botAction(view(state, botId), …))`
is `{ ok: true }` for every non-null return. This is the test that catches an
offer built out of cards in escrow.

**The target invariant.** For every bot offer and every bot accept, the
commodity paid out is not the bot's target, computed independently by the test.
Run under noise, because that is where it would break.

**Determinism.** The same view and the same seeded rng produce the same action,
twice. The same session seed and the same tick times produce a byte-identical
final state.

**Latency.** Samples land inside the level's range, and the three means are
ordered `easy > normal > hard`. That `botDelay` cannot see the board is carried
by its signature, not by a test.

**A session end to end.** One human seat, three bots, a fake clock stepped at
`tickIntervalMs`, played until the view reports `over`. The human presses
`harvest` on its own corner and `ready` through the reveal, and takes a trade
now and then — a seat that never trades freezes nine cards where they sit, and
most four-seat deals are then unwinnable by anybody, which is `../design.md`
§2.6 and not a property of the bots. The bound on ticks is generous and the
point of it is not the number: a session that does not finish means bots that do
not trade, and this is the only test that would notice.

**Conservation through the boundary.** After every push, summing `seats[].cards`
across the view and adding every live offer's `count` gives *C* × `HAND`. That
total is computable from a public view alone, which is why it is the one the
driver's test uses rather than reaching into state.

**No event carries a commodity.** Walk every event emitted across a full
session and assert no commodity key appears in one, as a key or as a value.
Session 1 proved it of views; events are the other half of the boundary and are
the half a client will animate.

**The driver.** An illegal `act` refuses with the reason and pushes no view.
The callback order is view then events, recorded and asserted. `leave` cancels
the timer and no callback fires afterwards. The returned object's keys are
exactly the six.

**Two greps**, added to `pit-core-purity.test.js` — Pit's mechanical-defence
file, whatever its name says, because a rule that is true when it is written and
quietly false a session later should not be left to review:

- `core/bot.js` does not import `rules.js`. A bot reaches a view and nothing
  else.
- No file under `public/pit/` outside `core/` and `room/` imports
  `core/rules.js`. Session 3's client does not exist yet; the rule is written
  now so that it is enforced the moment it does.

## 7. Acceptance criteria

1. `node --test 'test/*.test.js'` passes, existing suites included.
2. A four-seat session — one human, three bots — plays from `init` to `over`
   through the driver's six methods and a fake clock, with no test reaching into
   state.
3. No bot action gives away a card of that bot's target, at any level, under
   noise.
4. Every action a bot returns validates.
5. `botAction` receives a `View` and `bot.js` imports nothing that could give it
   a `State`.
6. Nothing outside `commodities.js` contains `HAND`, `MAX_OFFER` or a point
   value — the existing grep, still passing over two new files.
7. Nothing in `public/pit/core/` reads a clock or calls `Math.random()`. The
   driver may do both, and does, in the one place §5 puts them.

## 8. Explicitly not in this session

Any pixel — the table, the setup screen and the bot-count question are session 3,
and the round-end reveal and the `plays` row are session 4. Bot names appear in
this session as data and are not rendered by it.

The client's own file: nothing under `public/pit/ui/` is written here, and the
grep in §6 exists because of that.

`GameRoom`, sockets, hibernation, reconnect and room codes (Phases 6 and 7).
`gameroom.md` §3 and §4 are rewritten to match §2 when the room is built, not
now.

Little-kid mode, whose slower tick and matching-offer helper are a second bot
level and a second latency table, and which `../design.md` §6 puts last.
