# Trading Game ("Pit-style") — Design Spec

**Status:** Phase 5 of `../../ROADMAP.md`, built and played on one device
against bots. The rules core, the bots, the local driver and the table are
built (`public/pit/`); the four sessions and their state are in
[`specs/README.md`](specs/README.md). `GameRoom` (`../gameroom.md`) is Phase 6 and
takes this rules module unchanged in Phase 7, when Pit becomes the interface's
first consumer at `games.immotus.app`.

**How to read this document.** Items marked **Decided** came from the user. Items marked **Recommendation** are proposals from design discussion — they have named alternatives and a revisit trigger, and a future session should treat them as open unless the user has since confirmed them. Nothing here is irreversible.

---

## 0. Context

- Target players: user, husband, two kids (11 and 12). Bots fill remaining seats.
- Served under `games.immotus.app` as one game module inside the hub Worker. Rules, bots and client are static files under `public/pit/` and need no server; multiplayer later adds the shared `GameRoom` Durable Object class with rules supplied per-game. Stack in `../architecture.md`.
- A separate simplified version for a 4- and 5-year-old is planned **last**, as its own mode. Notes in §6.
- The horse breeding game is **not** part of this hub. It stays on its own subdomain.
- IP: game mechanics are not copyrightable. Do not use the Parker Brothers name, its commodity set as a set, its card art, or the "Corner the Market" / Bull & Bear card naming and trade dress. The theme is original — the Fruit of the Spirit, §2.1 — so nothing here touches that set.

---

## 1. Room interface contract

Pit is the first game through this interface, so it defines it. Sudoku is the second consumer and its needs are noted where they pull in a different direction.

`GameRoom` (the Durable Object) owns and the rules module never touches:

- Room code generation, join/leave, seat assignment
- WebSocket lifecycle, hibernation attachment, reconnect
- Player identity passthrough
- Broadcast fan-out
- Disconnect grace timer

The rules module supplies:

```ts
interface GameRules<State, Action, View> {
  minPlayers: number;
  maxPlayers: number;
  supportsBots: boolean;

  init(players: Player[], config: GameConfig): State;

  // Validation and application are separate so the room can reject
  // without mutating. Must be pure and deterministic.
  validate(state: State, playerId: string, action: Action): Result;
  apply(state: State, playerId: string, action: Action): { state: State; events: Event[] };

  // CRITICAL for Pit: each player sees only their own hand plus
  // public offer counts. Never broadcast full state.
  view(state: State, playerId: string): View;

  // Real-time games only. Called on DO alarm.
  tickIntervalMs?: number;
  tick?(state: State, now: number): { state: State; events: Event[] };

  isComplete(state: State): Outcome | null;

  // Bot seats. Called by the room, never self-scheduling.
  botAction?(view: View, difficulty: BotLevel): Action | null;
}
```

**Two things this interface must support from day one**, or it gets rewritten at game three:

1. **A tick loop, not just discrete actions.** Pit needs one (bot timing, offer expiry). Sudoku's race mode needs one (clock). A pure request/response action queue will not cover it.
2. **Per-player independent state.** Sudoku race mode gives every player their own grid on the same puzzle. Pit gives every player a private hand. `State` must not assume one shared board.

**Recommendation:** `apply()` returns a new state rather than mutating, so the room can snapshot for reconnect replay. *Alternative:* mutate in place and persist after each action, which is simpler and probably fine at family scale. *Revisit if:* reconnect-mid-round turns out to need replay rather than a fresh view push.

**Sudoku solo mode should not use the room at all.** No socket, no DO — static client plus a standings write. Do not route it through `GameRoom` for the sake of consistency.

---

## 2. Game rules

### 2.1 Theme and commodities

**Decided:** the Fruit of the Spirit, Galatians 5:22–23. Nine commodities, one
per virtue, each pictured as a fruit:

| Commodity | Fruit | Card tint |
|---|---|---|
| Love | Apple | `#c31412` |
| Joy | Blackberry | `#498cde` |
| Peace | Kiwi | `#9ec841` |
| Patience | Orange | `#ed6600` |
| Kindness | Strawberry | `#e94679` |
| Goodness | Blueberry | `#823ea0` |
| Faithfulness | Banana | `#f4c513` |
| Gentleness | Grapes | `#c39de7` |
| Self-Control | Pineapple | `#2ed6d9` |

**The virtue is the commodity's name; the fruit is only what its picture
shows.** Every label a player reads — the hand, an offer row, a receipt, the
round-end panel — says *Love*, not *Apple*. The fruit column is what the art was
drawn from and what the lookalike exclusions below are reasoned about, and it
belongs to the picture, never to the text.

The deck is *C* commodities where *C* = seats (humans + bots), 9 cards each.
Four seats = four commodities = 36 cards, 9 dealt to each player. Nine
commodities exist so that *C* can reach the largest table this family will ever
sit; at a normal table most of the set is out of play.

Bots hold seats, so the bot count asked at room setup (§3) is also the deck
size. That one screen decides how many commodities are in play.

**Decided — the *C* in play are drawn at random per session**, not taken in
verse order. Two things follow, and both are the point:

- Every card gets used. A fixed order would leave Faithfulness through
  Self-Control on the shelf at every four- or five-player game.
- **Point values are assigned by rank within the drawn set, not fixed to a
  fruit.** The cheapest commodity in play scores 55, then 60, 65, 70, 75, 80 and
  so on in fives. No fruit is permanently the valuable one, which keeps the
  scoring numbers from making a claim about the virtues they sit on.

Values must differ — that is what makes *which* commodity you chase a decision
rather than a readout of what you were dealt — and low value means the more
common target, because the cheap corner is the reachable one.

**Two fruits that look alike never deal together.** At the icon sizes §4 uses,
these pairs are not safely distinguishable, and the draw rejects and redraws
when it hits one:

- Goodness (blueberry) with Gentleness (grapes) — two purple clusters.
- Goodness (blueberry) with Joy (blackberry) — two dark berry clusters.
- Love (apple) with Kindness (strawberry) — two red rounds.

Goodness therefore excludes both other berries; Joy and Gentleness may sit
together, navy against lilac. The constraint is droppable above seven seats,
where every fruit is in play by force.

**Assets.** `public/pit/art/` holds two derived sets, both WebP, 952KB together:

- `cards/<key>.webp` — the full illustration at 512×768, ~75KB each. Used
  where the picture is the point and there is room for it: the round-end reveal,
  the harvest celebration, the game's tile on the shelf. Never during live play;
  nine portrait cards do not lay out at 360px.
- `cards/back.webp` — the one card back, 512×768, 42KB. Deep teal, gold frame,
  a three-leaf emblem, and nothing that varies: it is the same image behind every
  commodity, because a back that differed at all would be the leak §2.2 spends
  the whole game preventing. Its teal is dark enough not to be read as
  Self-Control's, which is the only tint in the set it comes near.
- `fruit/<key>.webp` — a 172px circular crop of the card's corner roundel,
  the picture only, no text, transparent outside the circle, ~10KB each. This is
  the working asset: hand groups, count badges, offer rows, the target tracker.
  It carries no text, so §6 uses it unchanged.

Both are generated from the twelve 1024×1536 masters in `art-src/pit/` — nine
commodity faces, the back, and the two special cards below — which are in the
repo and not served. The fruit crop is the square 172px on a side centred
at (135, 98) in the master, circle-masked — that box clears the name band at the
bottom of the roundel on all twelve. The masters are kept because without them
the crop box is irreversible and there is no CLI to redo it from. The back has
no derived crop; it is only downscaled.

**Two of the twelve are not commodities.** `thorns` and `vine` are the art for
the two cards §2.5 defers — the penalty and the wild. They are drawn to the same
1024×1536 layout as the nine and derive through the same crop, so both sets carry
them, but they are not keys in `COMMODITIES`, nothing deals them, and no screen
requests them yet. Their names are The Thorns (Matthew 13:22) and The Vine (John
15:5); the roundel labels read THORNS and VINE. Having the pictures first is what
lets §2.5 be decided on how the mechanic plays rather than on whether there is
anything to put on the card.

### 2.2 Core loop

1. Deal 9 cards per player, one commodity's worth per player, shuffled together.
2. Trading opens. All players act simultaneously — no turns.
3. A player offers **1 to 4 cards, all of the same commodity**, face down. Only the **count** is public. The commodity is not.
4. Another player holding that same count of some single commodity can accept. Cards swap blind. Neither side knew what they were getting.
5. First player to hold all 9 of one commodity has cornered it and ends the round.
6. Score, redeal, repeat to a target score.

The count-only information channel is the entire game. Everything in the UI should protect it: never leak commodity identity in an offer, an animation, a sound, or a timing tell.

### 2.3 Real-time model — the central design decision

**Recommendation: public offer board with immediate resolution.**

- A player posts an offer: a count (1–4) and a private card selection. It appears to everyone as `Bo: 3`.
- Any player holding 3 of a single commodity can hit it.
- Offers stay live until accepted, withdrawn, or expired (**recommendation:** 20s expiry, so abandoned offers don't clog the board).
- A player may hold **one** live offer at a time. *Alternative:* allow multiple, which is closer to real table chaos but makes the board unreadable on a phone.

Why this over continuous shouting: a faithful open-outcry version over mobile WebSockets means whoever has the best connection and the fastest thumbs wins every contested trade. That is not a skill the game is about. The offer board keeps the blindness, keeps the count channel, keeps the simultaneity, and drops the reflex race.

*Alternative worth keeping on the table:* a hybrid where offers resolve on a short tick (2s) rather than instantly, batching simultaneous accepts and resolving them randomly rather than first-come. Fairer across latency, slightly less responsive. **Revisit if:** playtesting shows one player consistently winning races for reasons unrelated to play.

**Race resolution:** the DO is single-threaded, so simultaneous accepts serialize naturally. First accept wins; losers get an explicit "taken" response, not a silent failure. Their cards must be returned to hand, not consumed.

### 2.4 Corner detection

**Decided: a manual Harvest button, with `autoCorner` as a room config toggle.**
Reaching 9 of a kind lights the button; the player has to press it. Missing your
own win while you are mid-trade is the tension the physical game has, and it
survives the translation.

The toggle exists because the failure mode lands on the players rather than on
the design: an 11-year-old who misses two corners running finds it funny or
finds it maddening, and which one cannot be settled here. With `autoCorner` set,
the tick harvests for whoever qualifies. It is a room setting, not a build-time
choice — `specs/session-1-rules-core.md` §6 puts it in `Config`.

**The button says "Harvest!"** The classic name is off the table for the reason
in §0, and cornering a market in Love is an odd sentence besides. Every card in
§2.1 is fruit on the branch, so filling a basket is the frame the art already
sets. *Alternative:* "Full Basket!", which is what the little ones will say
anyway. *Revisit if:* the word does not survive first contact with the kids.

### 2.5 Scoring

A corner scores the commodity's point value, which §2.1 assigns by rank within
the set drawn for the session. **Decided: a session ends at 300 points**, set at
room setup. That is five or six rounds, which is one sitting.

**Not in v1 — deferred, not rejected.** Two cards, whose art exists (§2.1) and
whose rules do not:

- **The Vine** — the wild. Allows a corner with 8 + the Vine, at reduced value.
- **The Thorns** — the penalty. Dead weight; costs whoever is holding it at round end.
- Doubling the corner value when cornered on the Vine.

These add real depth but they also add a second information channel and a lot of
edge cases: a card that is not a commodity has to be offerable, acceptable and
countable without breaking §2.2's rule that only the count is public. **Revisit
after:** the base game has been played through a full session by all four
humans.

### 2.6 A seat that stops trading

**Decided.** A player's cards move only when that player trades, so a seat that
stops — a phone put down, a 5-year-old distracted, a disconnect in Phase 7 —
freezes nine cards where they sit. Nobody can corner a commodity somebody else
is holding one of, and a round with no corner has nothing that ends it: expiry
returns offers to hands and the trading phase has no clock on it. `roundEndsAt`
governs the reveal, not the trading.

**The round is decided at the deal, not by play.** A corner is nine of one
commodity in one hand, so a frozen hand holding at least one of every commodity
makes every commodity unreachable before a card has moved. With one seat frozen
from the deal, the chance that any corner remains possible is exact:

| Seats | Corner possible | Round reached one |
|---|---|---|
| 3 | 3.11% | 3.0% |
| 4 | **19.60%** | **17.0%** |
| 5 | 47.88% | 39.0% |
| 6 | 75.18% | 65.5% |

Left column: inclusion–exclusion over a nine-card hand drawn from nine of each
of *n* commodities. Right column: 200 seeded deals per row, one frozen seat and
the rest `normal` bots, three simulated minutes each. **At the four-seat table
this family will actually sit, 83% of rounds hang permanently.** The bots
convert 87% of the deals that are winnable at all, so they are not the weak
link. Three seats is not merely worse — at 3.11% it does not work, and
`minPlayers` is 3.

**Nothing else hangs.** With every seat acting, 300 seeded deals at each of 3,
4, 5 and 6 seats all reached a corner inside five simulated minutes. There is no
separate bot-deadlock to guard against; the idle seat is the whole failure.

**The fix.** Three mechanisms, one per way a seat stops. Together they also
answer what happens to an abandoned session, which is the same question.

- **Pause.** A room-level pause any seat can set and **any** seat can lift —
  not only the seat that set it, or one child holds the game hostage. This is
  the answer to the deliberate absence, which is most of them: a phone put
  down on purpose, a meal, a bathroom.
- **Bot takeover at 60s.** A seat that has not acted for sixty seconds starts
  being played by `botAction`, and **scores nothing for that round even if its
  bot corners**. Any valid action from the seat reclaims it immediately. This
  is the answer to the absence nobody chose — a screen lock, a dropped
  connection, a Phase 7 disconnect after the room's grace timer expires.
- **Abandon game.** Ends the session with no result. Needs a second seat to
  confirm, for the same reason pause needs any seat to be able to lift it. The
  play itself is still recorded as started and abandoned —
  `../identity-and-stats.md` §4.1 — which is a row with no result rather than
  no row.

**The takeover penalty is not anti-cheat.** Walking away cannot help a player,
so there is nothing to deter. It is there because a bot-won round still *ends*
— cards redeal, the rest of the table keeps playing — and the cost of that
falls on the seat that left rather than on everyone else. The penalty is per
round: the moment the player touches the screen they hold the seat again and
score normally from the next round. An uncontested corner on a taken-over seat
awards nothing rather than passing to second place.

**Why sixty seconds.** The trigger is one seat's idleness, not room-wide quiet,
and a seat that is still playing cannot sit still for long: `OFFER_TTL_MS` is
20s, so a live seat re-offers inside a TTL cycle. Across 1,596 rounds that
resolved normally, at 3 through 6 seats, the longest any single seat went
without acting was **23.5s**, and no round anywhere had a seat idle past 45s.

| Seats | p50 | p90 | p99 | max |
|---|---|---|---|---|
| 3 | 4s | 20.5s | 22s | 23.5s |
| 4 | 5.5s | 14.5s | 21.5s | 22.5s |
| 5 | 6s | 14s | 21s | 22s |
| 6 | 7s | 17s | 22s | 23s |

Sixty leaves 2.5× margin on the worst bot round. The risk it does not cover is
human, not mechanical: a player who lets an offer expire while thinking is
already past 20s, and two cycles of that is 40s. Which is why —

**`idleSince` goes in the view.** A median round is seventeen seconds of
trading, so sixty seconds of a frozen board is several rounds' worth of dead
air, and a seat vanishing without explanation reads as a bug. The view carries
each seat's idle time so the client can run a visible countdown on it. Sixty
seconds of "Bo is away — taking over in 12" is a different experience from
sixty seconds of nothing, and it gives a thinking player something to react to.

*Rec:* the client sends a no-op `present` action on any interaction — a tap, a
scroll — which validates always and only stamps the seat. Without it a player
deliberating with their thumb on the screen is indistinguishable from one whose
phone is in a pocket. *Alternative:* rely on the countdown, since a seat holding
nine cards always has a legal `offer` and a seat with a live offer always has a
legal `withdraw`, so a reclaiming action is always available. *Would revisit
if:* the countdown turns out to be enough in play.

**Pause has to move the clocks.** `OFFER_TTL_MS`, `roundEndsAt` and the idle
timer are all `now`-based. A pause that only sets a flag resumes into every
offer expiring at once and every seat tripping the idle timer together. Pause
stamps `pausedAt`; resume adds the elapsed span to every deadline in state.
This exists before the button does, or the button is worse than the hang.

**All three are rules actions.** `pause`, `resume` and `abandon` join `offer`,
`accept` and `ready` in `validate` and `apply`, because the timestamps they
move live in State. The room still owns sockets, grace and deleting the room.
The no-writes property of abandon then falls out of code that already exists:
`isComplete` returns null unless `phase === 'over'`, so an abandon that sets
`phase: 'abandoned'` writes nothing without anyone having to remember a rule.

**Would revisit if:** a seat stays gone for several rounds. Every round its bot
wins is a round nobody scores, and at some point abandoning is the honest
outcome. No count is set on that yet; abandon covers it by hand.

---

## 3. Bots

Required — the game is thin at four and the kids won't always all be available.
They are also how Pit is playable at all before a room exists: sessions 1-4
(`specs/README.md`) build the game against bots on one device.

**Decided: how many bots sit down is asked at room setup, every time.** Not a
default, and not a rule about filling short seats — whoever opens the room says.
Since *C* = seats, that answer picks the deck too (§2.1).

### 3.1 Decision logic

Per bot turn evaluation:

1. **Target selection.** Usually the commodity it holds most of. Switch targets when another commodity overtakes it by 2+, with hysteresis so it doesn't thrash. Occasionally (~10%) commit to a contrarian target and hold it.
2. **Offer construction.** Offer from its smallest non-target holdings, largest offerable block first.
3. **Accept evaluation.** Accepting count *K* means giving up *K* cards it holds. Accept when the expected value of *K* unknown cards exceeds the value of what it gives up — which is nearly always true when it's dumping non-target cards, so the real filter is: never break its target holding.

### 3.2 The three things that are actually hard

**Reaction timing.** A bot that accepts in 8ms wins every offer and the kids never trade. Two separate things have to be got right and only one of them is the sampled delay.

Bots need randomized latency, sampled per action and scaled by difficulty, and that latency must **not** correlate with how good the trade is. If a bot hesitates on bad offers and pounces on good ones, players will read the tell within one session. **The range is the table's, not the seat's:** an eight-seat table of bots each pausing a second is a board changing eight times a second, and a per-seat number quietly turns the difficulty setting into a table-size setting.

That alone does not make a block claimable. A delay says how often a bot looks; what a human needs is to be looking first. **Every offer is invisible to every bot for a fixed window after it is posted**, long enough that the person it landed in front of can see the card, find a matching block and press it. Without the window an offer can be taken on the tick after it appears, and a player on a phone spends the round watching trades happen. Difficulty is allowed to move this window — it costs the hard bot a trade the easy bot misses rather than showing either a card it should not see — and `specs/session-2-bots-and-the-local-driver.md` §3 has the numbers.

**Information modeling.** Every posted count is public information. A bot that logs the full count history and infers who is cornering what is genuinely strong — plausibly stronger than the humans. **Recommendation:** cap this deliberately by difficulty. Easy bots see only the current board; hard bots see the last N counts per player. Do not let a bot see everything just because it can.

**Not being exploitable.** Deterministic accept thresholds get reverse-engineered by a 12-year-old in about four rounds. Add noise: occasional bad trades, occasional passes on good ones, occasional target switches with no basis.

### 3.3 Scheduling

Bots do not self-schedule. The room's tick calls `botAction()`; bot latency is implemented as "earliest time this bot may act," checked on tick. This keeps bot behavior deterministic and replayable, and keeps all timing in one place.

---

## 4. Client

- **The hand is a fixed row of slots**, one per commodity in play, in value
  order, zeros included and greyed. Position is how a pre-reader finds a thing,
  so the row never reorders itself as counts change.
- **The hand is also the target tracker.** The largest group carries a ring and
  reads `7/9`; there is no second widget saying the same number.
- Offer board: one row per live offer, face and name and a big count numeral,
  greyed when you cannot match the count. Your own row carries Withdraw.
- Harvest button, present from the first render and dark until legal.
- Round-end reveal of everyone's final hands — this is where the count history
  retroactively becomes readable and is a large part of the fun.

**Recommendation: two taps for both actions, and the hand is the only place a
commodity is ever named.** Offering is tap a group, tap a count. Accepting is
tap an offer, tap the group you will pay from. One mechanism, no drag, no
long-press, and a screen little-kid mode (§6) can inherit without a rewrite.
*Alternative:* drag a block onto an offer, which is more physical and reads
better on a Chromebook. *Revisit if:* the 11-year-old does not work out that
they pay from their own hand — `specs/session-3-the-table.md` §5.3 is the
detail, and S10 step 9 is the reading.

**Which art goes where.** Live play uses `fruit/` and nothing else: the circular
crop reads at 40px, carries no text, and nine of them fit across a 360px phone.
The full `cards/` illustration appears in three places only — the round-end
reveal, the harvest celebration, and the game's tile on the hub shelf. A hand of
nine full cards is not a layout that exists at this width, so nothing should be
designed as though it were.

Commodity identity is carried by the fruit and by the tint behind it, per the
avatar rule in `../design-language.md` §2 — the name is a caption, never the
channel. That is what the exclusion pairs in §2.1 protect.

**There is no base path to configure.** There is no bundler —
`public/pit/` is plain ES modules with relative paths and serves at `/pit/`
because that is where the files are. See `../architecture.md` §2.1.

---

## 5. Build order

The game on one device first, the room after. Four sessions, with a table, a
cost per session and the driver contract that keeps the local driver and the
room interchangeable, are in [`specs/README.md`](specs/README.md):

1. Rules core — the whole game as pure functions.
2. Bots and the local driver.
3. The stopped seat (§2.6), and the table.
4. Round end, the session, the record.

That leaves a Pit one person plays against bots in a tab. `GameRoom`
(`../gameroom.md`) follows, then the same client on a socket to it, then
little-kid mode (§6).

Each step is playable before the next starts.

---

## 6. Little-kid mode (ages 4 and 5) — deferred

Not a difficulty slider. Separate mode, same room infrastructure.

- **No text anywhere.** Commodities are shape + color, which the `fruit/` crops
  in §2.1 already are — they were cut above the name band precisely so this mode
  needs no second asset path.
- **Tap only.** Tap commodity, tap count, tap offer.
- Smaller: 3–4 commodities, 5-card corners, 4–6 card hands. The draw is the
  same one as §2.1, so the exclusion pairs carry over and matter more here: a
  4-year-old telling a blueberry from a grape at 64px is the whole mode.
- Slower tick, and a helper that highlights offers matching their target.

Mixed tables with the older kids were discussed and set aside as the harder problem. If revisited, the approach that seemed most promising was asymmetric win conditions on a shared deck — 5-card corners for the little ones, 9 for adults — plus the helper, rather than any speed handicap, since visible speed handicaps get noticed and resented.
