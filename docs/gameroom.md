# `GameRoom` — Shared Room Interface Spec

**Status: interface provisional, assumptions verified.**

The §1 checklist has been run against the real sudoku source and every item is
closed — see below. The interface itself in §4 remains a design against two
games, one of which is not built. Treat §4 as open; treat §1 as settled fact.

Companion documents: `../ROADMAP.md`, `architecture.md`, `pit/design.md`.

**How to read this.** **Recommendation** items have named alternatives and a
revisit trigger.

---

## 1. Verification results

Run against `public/src/core/` and `public/src/ui/` at commit `a4718f6`.

**1.1 Puzzle generation is deterministic from a seed. ✅**
`mulberry32(seed)` in `core/rng.js`; core never calls `Math.random()`.
`deal(geom, seed, tier)` returns `{seed, solution, givens}` and repeat calls are
byte-identical. The room stores three values — seed, size key, tier id. Already
proven in production: `store/local.js` persists the seed and re-derives the
board on load rather than storing the grid.

*Caveat:* determinism holds within a code version. Any change to `fillComplete`,
`carve` or `ease` changes what a seed deals. `localStorage` guards this with a
version field; the room needs the same guard, and it matters more there because
a stored result references a puzzle.

**1.2 One solution grid produces many independent clue masks. ✅**
This was flagged as the most likely misfit. It is not one. `carve(geom,
solution, rng, keep)` takes the solution as an argument; `keep` is the tier's
clue count. Nothing couples solution to difficulty. Verified at 9×9, seed 12345:
identical solution grids at easy and hard, 50 and 32 clues.

The masks also **nest** — `hard ⊆ medium ⊆ easy`, verified. Both carves walk the
same shuffled cell order from the same rng state and stop at different counts.
This is the clue-superset layering the sudoku design specifies for R3, not an
accident, and it means no racer holds a clue their opponent lacks.

**1.3 Move validation is client-side, and there is no server. ⚠️**
`ui/app.js` holds `state.solution` and compares against it. The concern in the
original text is real, and there is a sharper version of it: because generation
is seeded, *sending the seed sends the solution*. Reconnect efficiency and
server authority pull against each other. Resolution and recommendation in
`architecture.md` §7.

**1.4 Best times live nowhere. ✅**
`wrangler.jsonc` has `assets` and nothing else — no D1, no KV, no DO. And
`store/local.js` is explicitly forbidden from holding results (sudoku Q7). So
this is better than "already device-local": **no records data exists anywhere**,
and the hub's D1 arrives with zero migration to perform. Q7 was written for
precisely this moment.

**1.5 The solo state shape is reusable, nearly verbatim. ✅**
Plain ES modules, no framework, no scattered component state. `app.js` holds one
flat object:

```js
{ seed, givens, values, solution, moveStack, redoStack, marks, selected, solved }
```

The split for race mode: `{seed, givens, values, moveStack}` is per-player
durable state — which is literally what `saveGame` already persists — `solution`
moves to shared state, and `{marks, selected, redoStack}` is view-local.

*Not yet present:* pencil marks (Phase 4), elapsed time (Phase 3), a mistakes
counter (`marks` is a transient `Set` from the check button). So this shape is
not final; Phase 4 adds a field to it.

**1.6 Grid encoding is a flat `Uint8Array`. ✅**
Length n², row-major, single index, `0` = empty. `core/grid.js` is explicit that
cells are never `[row][col]`. `store/local.js` already converts via
`Array.from()` for JSON, so the natural wire format is a plain number array —
not an 81-char string.

**A seventh finding, not on the list: cooperative sudoku was cut.**
`HISTORY.md` records it removed 2026-09-03, before this document was written.
§5's worked example for cooperative mode, and the argument in §5 that race and
cooperative are "the same game with opposite state topologies", rest on a mode
that does not exist. The conclusion — `State` stays opaque to the room — still
holds on Pit-versus-sudoku-race alone, but it is a weaker argument than it
reads. Do not build cooperative mode because this document mentions it;
`HISTORY.md` has the analysis and the condition for reopening it.

---

## 2. Repo layout

**Superseded.** The repo is not migrated — it is renamed and restructured in
place, preserving history and the working Cloudflare build connection. The
layout and the reasoning are in `restructure.md`; the no-bundler consequence
(there is no base path to set, and therefore no white-screen failure mode) is in
`architecture.md` §2.1.

---

## 3. Responsibility split

**The room owns, and rules modules never touch:**

- Room code generation, seat assignment, join/leave
- WebSocket lifecycle, hibernation, reconnect, disconnect grace
- Message framing and fan-out
- The tick alarm
- Bot scheduling and latency gating
- State persistence and the standings write on completion

**The rules module owns:**

- What a game state is
- Which actions are legal
- What an action does
- What each player is allowed to see
- When the game is over and who won
- What a bot would do given a view

A rules module never calls a socket, never sets a timer, never reads storage, and never learns a player's connection status. If it needs one of those, the interface is wrong and should be extended rather than worked around.

---

## 4. The interface

```ts
type PlayerId = string;

interface Seat {
  playerId: PlayerId;
  name: string;
  isBot: boolean;
  botLevel?: BotLevel;
}

interface GameRules<State, Action, View, Config> {
  id: string;
  minPlayers: number;
  maxPlayers: number;
  supportsBots: boolean;
  defaultConfig: Config;

  init(seats: Seat[], config: Config, seed: string): State;

  // Separate so the room can reject without mutating.
  // Both must be pure and deterministic — same inputs, same outputs,
  // no clock reads, no randomness except from state-carried seed.
  validate(state: State, actor: PlayerId, action: Action): 
    { ok: true } | { ok: false; reason: string };

  apply(state: State, actor: PlayerId, action: Action, now: number):
    { state: State; events: Event[] };

  // The confidentiality boundary. Pit's entire game depends on this
  // being correct: a player sees their own hand and public offer
  // counts, never another player's cards.
  view(state: State, viewer: PlayerId): View;

  // Optional. Room drives this via alarm, never setInterval.
  tickIntervalMs?: number;
  tick?(state: State, now: number): { state: State; events: Event[] };

  isComplete(state: State): Outcome | null;

  // Pure function of the view. A bot must not be handed State —
  // that's how bots accidentally become cheaters.
  botAction?(view: View, level: BotLevel, rng: () => number): Action | null;
}
```

### 4.1 Why `apply` returns new state

**Recommendation:** return a new state object rather than mutating, so the room can snapshot cheaply for reconnect and for debugging a disputed round.

*Alternative:* mutate in place and persist after each action. Simpler, less allocation, almost certainly fine at four to six players. **Revisit if:** reconnect turns out to need replay rather than a fresh full view push, or if you ever want an undo.

### 4.2 Why bots receive `View`, not `State`

A bot handed full state can see every hand. Even with the intent to ignore it, one refactor later it won't. Constraining bots to the same view a human gets makes cheating structurally impossible rather than merely intended-against, and it means bot difficulty is tuned by *restricting the view* rather than by adding artificial handicaps.

### 4.3 `rng` is injected

Bots need randomness for latency, contrarian target switches, and deliberate suboptimal play. Injecting it keeps `botAction` pure and makes a round reproducible from a seed when debugging "the bot did something insane."

---

## 5. State shapes — worked examples

These are sketches to pressure-test the interface, not final designs.

**Pit** — shared public board, private per-player hands:
```ts
{
  seed, phase, commodities[], values{},
  hands: { [playerId]: Commodity[] },        // private
  offers: [{ id, playerId, count, cards[] }], // count public, cards private
  botTimers: { [playerId]: earliestActMs },
  scores: { [playerId]: number }, round
}
```

**Sudoku race** — one puzzle, fully independent per-player progress:
```ts
{
  seed, solution,                             // never in any view
  players: { [playerId]: { 
    clueMask, entries, pencil, startedAt, completedAt, mistakes 
  }},
  gridSize
}
```

**Sudoku cooperative** — one genuinely shared grid:
```ts
{
  seed, solution, clueMask,
  entries, pencil,                            // shared, all players
  contributors: { [cell]: playerId },
  startedAt
}
```

**This is the case that breaks a naive interface.** Race and cooperative are the same game with opposite state topologies. Any `State` type that assumes "one shared board" or assumes "per-player parallel boards" fails one of them. `State` must stay fully opaque to the room — the room persists it, passes it, and never inspects it.

### 5.1 Cooperative concurrent edits

Two players entering the same cell at once. The Durable Object is single-threaded, so writes serialize naturally and you get last-write-wins for free.

**Recommendation:** accept last-write-wins, but *show* it — a brief highlight and the contributor's name on the cell, so it's visible that someone else's entry replaced yours. Silent overwrites between siblings produce arguments; visible ones produce laughing.

*Alternative:* soft cell locking — first player to focus a cell holds it briefly. More correct, more code, and creates its own frustration when someone wanders off holding a lock. **Revisit if:** last-write-wins actually causes friction in play, rather than in theory.

---

## 6. Connection lifecycle

**Accept via hibernation API.** `ctx.acceptWebSocket()` with `webSocketMessage` / `webSocketClose` / `webSocketError` handlers, not `addEventListener`. Store the player identity on the socket with `serializeAttachment()` so it survives hibernation, since in-memory state is reset and the constructor re-runs on wake.

**Hibernation is blocked by `setTimeout` and `setInterval`.** This is a platform constraint, not a style preference — a Durable Object with a scheduled callback cannot hibernate. The tick must therefore be an alarm that reschedules itself, and the room must clear the alarm when a game ends so idle rooms actually sleep.

**Heartbeats via `setWebSocketAutoResponse()`.** Ping/pong handled at the platform level doesn't wake the object or accrue wall-clock time.

**Reconnect: same player ID rejoins the same seat.** Room pushes a full fresh view. **Recommendation:** hold a disconnected seat for 90 seconds before offering to substitute a bot, which is long enough for a phone to come off a lock screen and short enough that nobody waits around.

**Join-in-progress: rules-module dependent.** Pit can't accept a mid-round join — the deck is dealt. Sudoku cooperative can accept one trivially. **Recommendation:** add `canJoinMidGame(state): boolean` to the interface rather than having the room guess.

---

## 7. Tick and cost

Alarm-driven, rescheduled each fire, cleared on game end.

**Recommendation: 500ms for Pit.** Trades resolve on player action, event-driven and immediate. The tick only handles bot latency gating and offer expiry, neither of which needs finer resolution. Sudoku needs no tick at all — race-mode clocks run client-side against a server start timestamp.

**Cost sanity check.** A Durable Object is billed for 128 MB regardless of use, so active time costs 0.125 GB-s per second. The free tier's 13,000 GB-s/day works out to roughly 29 hours of continuously-active room time per day. A ticking Pit room cannot hibernate while the tick is running, and it still doesn't matter at family scale. Requests are also generous — WebSocket messages bill at 20:1 against the 100,000/day free limit.

The tick is not a cost problem. Don't design around one.

---

## 8. Persistence

- **Live state:** DO storage, written after each `apply`. Disposable once the game ends.
- **Results:** D1 at the hub, written by the room on `isComplete`, never by the rules module.

```
results(player_id, game, mode, difficulty, result, value, completed_at)
```

`value` carries points for Pit, seconds for sudoku. Generic enough that a future board game needs no schema change.

---

## 9. Where this will leak

Named honestly so a future session recognizes them rather than treating them as surprises.

- **Rules modules will want to know about connection state.** Pit especially — a disconnected player's live offers should probably be withdrawn. Resist putting sockets in the rules module; pass a disconnect *event* into `apply` as an action instead.
- **`view()` will be the site of any leak bug.** It is the only thing standing between Pit and a player seeing another player's hand. Worth a unit test per game asserting no private field escapes.
- **Config will grow.** Grid size, difficulty, target score, bot count, ring-vs-auto — all per-game. Keep `Config` opaque to the room like `State`.
- **Two-consumer interfaces are usually wrong.** This one is designed against two games and will be extended by the third. That's expected. Extending it should be easier than working around it, which is the actual test of whether the split in §3 is right.

---

## 10. Open questions

1. All of §1, against the real sudoku code.
2. Does `canJoinMidGame` belong in the interface, or is join-in-progress simply not supported in v1?
3. Should the room own bot *identity* (names, avatars) or the rules module?
4. Reconnect: full view push, or event replay from a snapshot?
