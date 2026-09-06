# Trading Game ("Pit-style") — Design Spec

**Status:** design stage, no code. Phase 5 of `../../ROADMAP.md`, built and
played on one device against bots. `GameRoom` (`../gameroom.md`) is Phase 6 and
takes this rules module unchanged in Phase 7, when Pit becomes the interface's
first consumer at `games.immotus.app`.

**How to read this document.** Items marked **Decided** came from the user. Items marked **Recommendation** are proposals from design discussion — they have named alternatives and a revisit trigger, and a future session should treat them as open unless the user has since confirmed them. Nothing here is irreversible.

---

## 0. Context

- Target players: user, husband, two kids (11 and 12). Bots fill remaining seats.
- Served under `games.immotus.app` as one game module inside the hub Worker. Rules, bots and client are static files under `public/pit/` and need no server; multiplayer later adds the shared `GameRoom` Durable Object class with rules supplied per-game. Stack in `../architecture.md`.
- A separate simplified version for a 4- and 5-year-old is planned **last**, as its own mode. Notes in §7.
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

**Assets.** `public/pit/art/` holds two derived sets, both WebP, 836KB together:

- `cards/<commodity>.webp` — the full illustration at 512×768, ~75KB each. Used
  where the picture is the point and there is room for it: the round-end reveal,
  the harvest celebration, the game's tile on the shelf. Never during live play;
  nine portrait cards do not lay out at 360px.
- `cards/back.webp` — the one card back, 512×768, 42KB. Deep teal, gold frame,
  a three-leaf emblem, and nothing that varies: it is the same image behind every
  commodity, because a back that differed at all would be the leak §2.2 spends
  the whole game preventing. Its teal is dark enough not to be read as
  Self-Control's, which is the only tint in the set it comes near.
- `fruit/<commodity>.webp` — a 172px circular crop of the card's corner roundel,
  fruit only, no text, transparent outside the circle, ~12KB each. This is the
  working asset: hand groups, count badges, offer rows, the target tracker. It
  carries no text, so §7 uses it unchanged.

Both are generated from the ten 1024×1536 masters in `art-src/pit/` — nine faces
and the back — which are in the repo and not served. The fruit crop is the square 172px on a side centred
at (135, 98) in the master, circle-masked — that box clears the name band at the
bottom of the roundel on all nine. The masters are kept because without them the
crop box is irreversible and there is no CLI to redo it from. The back has no
derived crop; it is only downscaled.

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

**Not in v1 — deferred, not rejected:**
- Wild card (classic "Bull") — allows a corner with 8 + wild, at reduced value
- Penalty card (classic "Bear") — dead weight, penalizes whoever holds it at round end
- Doubling the corner value when cornered on the wild

These add real depth but they also add a second information channel and a lot of edge cases. **Revisit after:** the base game has been played through a full session by all four humans.

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

**Reaction timing.** A bot that accepts in 8ms wins every offer and the kids never trade. Bots need randomized latency (**recommendation:** 800–2500ms, sampled per action, scaled by difficulty) and that latency must **not** correlate with how good the trade is. If a bot hesitates on bad offers and pounces on good ones, players will read the tell within one session.

**Information modeling.** Every posted count is public information. A bot that logs the full count history and infers who is cornering what is genuinely strong — plausibly stronger than the humans. **Recommendation:** cap this deliberately by difficulty. Easy bots see only the current board; hard bots see the last N counts per player. Do not let a bot see everything just because it can.

**Not being exploitable.** Deterministic accept thresholds get reverse-engineered by a 12-year-old in about four rounds. Add noise: occasional bad trades, occasional passes on good ones, occasional target switches with no basis.

### 3.3 Scheduling

Bots do not self-schedule. The room's tick calls `botAction()`; bot latency is implemented as "earliest time this bot may act," checked on tick. This keeps bot behavior deterministic and replayable, and keeps all timing in one place.

---

## 4. Client

- Hand grouped by commodity, count badges, tap to select a block.
- Offer board: one row per live offer, `name` + big count numeral, tap to accept, greyed if you can't match the count.
- Persistent visible: your own counts per commodity, your target's progress toward 9.
- Harvest button, dark until legal.
- Round-end reveal of everyone's final hands — this is where the count history retroactively becomes readable and is a large part of the fun.

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
3. The table.
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
