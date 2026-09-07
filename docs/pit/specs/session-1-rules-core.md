# Session 1 — Rules core

The whole of Pit as pure functions: what a deal is, which trades are legal, what
a trade does, what each player is allowed to see, and when a session is over.
No bots, no driver, no pixels. At the end of it the game is fully playable by a
test file and by nothing else.

This is the module `../gameroom.md` §4 calls a `GameRules`. It is written to
that interface now so that the local driver in session 2 and the Durable Object
in Phase 6 can both drive it without either one being special.

**Cost: Medium, ~50k.**

## 1. Files

```
public/pit/core/rng.js           mulberry32 and shuffled, Pit's own copy
public/pit/core/commodities.js   the nine, their tints, the exclusion pairs,
                                 the draw, and the point values
public/pit/core/rules.js         init, validate, apply, view, tick, isComplete

test/pit-commodities.test.js     the draw and the values
test/pit-rules.test.js           deals, trades, corners, scoring
test/pit-view.test.js            the confidentiality boundary
test/pit-core-purity.test.js     §9's criteria 5 and 6, as greps
```

`rng.js` is eight lines copied from `public/sudoku/core/rng.js` rather than a
shared module promoted out of it. Promoting means editing sudoku for the benefit
of a game that does not exist yet, and H2 in `../../../ROADMAP.md` is that adding
a game must not require touching the ones already there. Revisit at game three,
when there are two copies and a reason.

## 2. Commodities

`commodities.js` is the only module in Pit that contains the number 9, the
number 4, or a point value. `../design.md` §6's little-kid mode changes all
three, and it changes them here.

```js
export const HAND = 9;          // cards per commodity, and cards per player
export const MAX_OFFER = 4;     // largest block that may be offered
export const BASE_VALUE = 55;   // the cheapest commodity in play
export const VALUE_STEP = 5;
```

The nine, each with its key, its display name (the virtue), the fruit its
picture shows, and its tint from
`../design.md` §2.1. The tint lives here rather than in CSS because the client
needs it in JavaScript to colour a count badge, and one source beats two that
drift.

### 2.1 The draw

```js
drawCommodities(rng, seats) -> string[]   // length `seats`, in value order
```

*C* = seats, and the table runs from three seats to nine: below three a blind
swap is an exchange with the only other person holding cards, and above nine
there is no commodity left to deal. The set is drawn at random per session, so
every card gets used and no fruit is permanently the valuable one.

**Exclusions.** The three lookalike pairs in `../design.md` §2.1 —
goodness/gentleness, goodness/joy, love/kindness — never deal together. Draw by
shuffling the nine and taking greedily, skipping any key that conflicts with one
already taken; if a pass cannot reach *C*, reshuffle and try again, bounded at
some small number of attempts.

Above the largest conflict-free set the constraint is unsatisfiable and is
dropped. That size is found by inspecting the pairs at module load rather than
written down, so editing the exclusions cannot leave a stale number behind; with
the three pairs above it is seven, because goodness excludes both other berries
and love excludes kindness. Eight and nine seats take the shuffle as it comes,
and so does a draw that exhausts its attempts — dealing a lookalike pair beats
failing to deal a game. The bound on attempts is a belt-and-braces guard, not
the mechanism: a greedy pass from a uniform shuffle reaches seven often enough
that the loop is not a performance question at any table this family sits.

**Values.** Once the set is drawn, shuffle it again and assign `BASE_VALUE`,
`+VALUE_STEP` and so on. The returned array is in that order, cheapest first, so
"the commodity at index 0 is the cheap one" is true by construction and no
module has to sort. Values differ by construction, which is what makes *which*
commodity you chase a decision rather than a readout of what you were dealt.

## 3. State

Opaque to any room that carries it. Serializable — it goes into DO storage in
Phase 6 — so no `Set`, no `Map`, no class instance.

```ts
type Commodity = string;                 // a key from commodities.js
type Hand = { [c: Commodity]: number };  // absent key means zero

interface State {
  seed: number;
  target: number;            // points that end the session
  autoCorner: boolean;       // §6
  seats: Seat[];             // playerId, name, isBot, botLevel
  commodities: Commodity[];  // the drawn C, cheapest first
  values: { [c: Commodity]: number };

  round: number;
  phase: 'trading' | 'roundEnd' | 'over';
  hands: { [playerId: string]: Hand };
  offers: Offer[];
  offerSeq: number;          // this round's offer counter, for Offer.id
  scores: { [playerId: string]: number };
  history: PublicEvent[];    // counts only, never a commodity
  botsReadyAt: { [playerId: string]: number };
  harvest?: { playerId: string, commodity: Commodity, value: number };
  ready: string[];           // who has pressed through the round-end reveal
  roundEndsAt: number;       // when tick ends the reveal regardless
}

interface Offer {
  id: string;                // deterministic: `${round}-${n}`
  playerId: string;
  count: number;             // 1..MAX_OFFER, public
  commodity: Commodity;      // private, never in another player's view
  postedAt: number;
  expiresAt: number;
}
```

**Cards are counts, not objects.** Two cards of the same commodity are
interchangeable, so a hand is a tally. This is not only smaller — it removes a
whole class of leak, because there is no card identity to accidentally carry an
owner or a history into a view.

**Offered cards leave the hand.** Posting an offer moves the count out of the
hand and into the offer; withdrawing, expiring, and the seat's own disconnect
put it back. Escrow rather than a lock, for two reasons: conservation becomes a
one-line invariant a test can assert after every action, and you cannot corner
with cards you have offered away — which is the honest reading of the physical
game, where those cards are on the table.

## 4. Actions

```ts
type Action =
  | { type: 'offer', commodity: Commodity, count: number }
  | { type: 'withdraw' }
  | { type: 'accept', offerId: string, commodity: Commodity }
  | { type: 'harvest' }
  | { type: 'ready' }
  | { type: 'disconnect' };
```

`validate(state, actor, action)` returns `{ ok: true }` or `{ ok: false, reason }`
and never mutates. `apply(state, actor, action, now)` returns
`{ state, events }` and assumes the action already validated. Both are pure:
same inputs, same outputs, no clock read, no `Math.random()`.

**`offer`** — during `trading` only. `count` is 1..`MAX_OFFER`; the actor must
hold at least `count` of `commodity`; the actor must have no live offer, because
one live offer per player is what keeps the board readable at 360px. Sets
`expiresAt = now + OFFER_TTL_MS` (20s).

**`withdraw`** — the actor's own offer, returning the cards.

**`accept`** — a different player's live offer, with a commodity the actor holds
at least `count` of. The two blocks swap: the offer's escrow goes to the
accepter, the accepter's nominated cards go to the offerer, and the offer is
removed. Neither side knew what they were getting, which is the entire game.

**`harvest`** — legal when the actor holds `HAND` of one commodity. Scores that
commodity's value, moves to `roundEnd`, and reveals every hand.

**`ready`** — during `roundEnd`. When every human seat is ready the round is
scored out and the next one deals; `tick` is the backstop for the seat that
walked off with the phone.

**`disconnect`** — an action rather than a callback, per `../gameroom.md` §9.
Withdraws the seat's live offer and nothing else; the hand stays, because the
seat is held for 90 seconds before anything replaces it. In session 1 nothing
sends it; the room will.

### 4.1 The race for an offer

Two accepts of the same offer arrive together. Both validate against the state
before either applied, so the second one has to fail at `apply` time — but
`apply` assumes validation. The rule that resolves it: **the room validates
immediately before applying, in the same turn.** The Durable Object is
single-threaded and the local driver runs on one thread, so "validate then
apply" is atomic in both, and the loser's `validate` returns
`{ ok: false, reason: 'taken' }`.

The loser's cards are never consumed. That is not a claim about care taken; it
follows from `accept` reading the accepter's hand only inside `apply`, which
never ran.

## 5. Views

`view(state, viewer)` is the confidentiality boundary and the one function in
Pit that a bug in is fatal to the game. It is also what bots see, so a bot
cannot cheat by construction rather than by intent.

**It is built, not filtered.** A view is assembled out of public counts plus one
player's own hand; there is no copy of state with the private fields deleted. A
field added to `State` in a later session therefore cannot leak by being
forgotten about here, which is the failure mode a filter has and a constructor
does not.

```ts
interface View {
  round, phase, target, values, commodities,
  you: {
    playerId, hand: Hand,
    offer?: { id, count, commodity },   // your own, so the commodity is yours to see
    canHarvest: boolean,
    ready: boolean,
  },
  seats: [{ playerId, name, isBot, cards: number, score: number, ready: boolean }],
  offers: [{ id, playerId, count, expiresAt, mine: boolean, matchable: boolean }],
  history: PublicEvent[],
  harvest?: { playerId, commodity, value },
  reveal?: { [playerId]: Hand },        // roundEnd and over only
}
```

`cards` is another seat's total card count — public, because the cards are
visible in a hand at a table and because a player who has offered three cards
away is visibly holding six. `matchable` is whether the viewer holds `count` of
some single commodity, which is the greying rule in `../design.md` §4 computed
once on the server side of the boundary rather than three times in the client.

`ready` is public on both sides of the boundary: who has pressed through the
reveal is a fact about a person, not about a hand, and the round-end screen has
to draw it.

`reveal` is absent during `trading` and complete afterwards. The round-end
reveal is where the count history retroactively becomes readable, and it is a
large part of the fun.

**`PublicEvent` is counts only.** `{ kind: 'offer', playerId, count }`,
`{ kind: 'trade', a, b, count }`, `{ kind: 'expired', playerId, count }`. No
commodity appears in one, ever — session 2's bots read exactly this history and
nothing else, which is what makes "hard bots see the last N counts per player" a
matter of restricting the view rather than adding a handicap.

## 6. Corners and scoring

**Manual harvest, with a config toggle.** `canHarvest` lights the button when
the actor holds `HAND` of a commodity; they must press it. Missing your own win
while mid-trade is the tension the physical game has, and it is the thing most
likely to be wrong for the 11-year-old — so `autoCorner` is in `Config`, not in
the code. With it set, `tick` harvests for whoever qualifies.

The button says **"Harvest!"** — `../design.md` §2.4 says why, and it is a word
the little ones can be asked about before it is a word anybody has to change.

A corner scores the commodity's value. The session ends when a score reaches
`target`, default **300** and set at room setup, which is five or six rounds.

`isComplete(state)` returns `null` while `phase !== 'over'`, and otherwise the
outcome: every seat with its score and its rank, ties sharing a rank. It is the
input to the `plays` / `play_results` write in session 4 and knows nothing about
D1.

## 7. Tick

`tickIntervalMs = 500`, per `../gameroom.md` §7. `tick(state, now)` does three
things and no more:

- Expires offers past `expiresAt`, returning the cards and logging `expired`.
- Ends `roundEnd` after `REVEAL_BACKSTOP_MS` (30s) whether or not everyone
  pressed through.
- Harvests, when `autoCorner` is set and someone qualifies.

Bot gating is the fourth thing and arrives in session 2; `botsReadyAt` is in the
state now so that the shape does not change under a stored game.

## 8. Tests

The invariants are worth more than the cases here, because a trading game's bugs
are conservation bugs.

**Conservation.** After any sequence of applied actions, for every commodity in
play: cards in hands + cards in escrow = `HAND`. Run it as a loop over a few
hundred random legal action sequences from a seeded rng, asserting after every
step. This is the test that catches a blind swap that creates a card.

**The draw.** Over many seeds and every seat count: length is *C*, no duplicates,
no excluded pair below eight seats, values distinct, values ascending with the
returned order, cheapest is `BASE_VALUE`.

**Determinism.** Same seed, same seats, same action sequence, byte-identical
state. Twice.

**Trades.** An accept moves exactly `count` each way; the offerer's total is
unchanged and so is the accepter's; neither hand goes negative; the offer is
gone. A second accept of the same offer refuses with `taken` and changes
nothing.

**Corners.** `canHarvest` is true exactly when a hand holds `HAND` of one
commodity. Harvesting scores the right value, reveals every hand, and the next
round deals a fresh `HAND` to everyone. A session ends at `target` and not
before.

**The leak test.** For a state where every other seat holds a distinguishable
hand, walk the entire serialized view of every viewer during `trading` and
assert no other player's commodity appears anywhere in it — as a key, as a
value, or inside `history`. Then assert the same view *does* carry the viewer's
own hand, so the test cannot pass by returning nothing. `../gameroom.md` §9
names `view()` as the site of any leak bug; this is that test, and it is worth a
few minutes more than it costs to write.

**Expiry.** An offer past its TTL is gone after a tick and the cards are back,
and a tick with nothing to do returns a state equal to the one it got.

## 9. Acceptance criteria

1. `node --test 'test/*.test.js'` passes, existing suites included.
2. A test file plays a four-seat session to `target` through the public
   interface only — `init`, `validate`, `apply`, `tick`, `view`, `isComplete` —
   with no reach into state from outside the module.
3. Conservation holds over randomized play at every seat count from
   `minPlayers` to `maxPlayers`.
4. No view during `trading` contains another player's commodity.
5. Nothing in `public/pit/core/` imports the DOM, `window`, storage, `Date.now`
   or `Math.random`. A grep test asserts it, the same way sudoku's size test
   does.
6. `HAND`, `MAX_OFFER` and the point values appear in `commodities.js` and
   nowhere else under `public/pit/`.

## 10. Explicitly not in this session

Bots (session 2). The local driver (session 2). Any pixel (sessions 3 and 4).
The `plays` row (session 4). `GameRoom`, sockets, reconnect, room codes
(Phases 6 and 7). The wild and penalty cards, which `../design.md` §2.5 defers
until the base game has been played through by all four humans. Little-kid mode.
