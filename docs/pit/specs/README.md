# Pit session specs

Implementation specs for the build order in [`../design.md`](../design.md) §5.
One file per session. A session is spec'd only when it is next or nearly next;
the rest live only as a row in the table below.

| # | Session | Spec | Cost | State |
|---|---|---|---|---|
| 1 | Rules core | [`session-1-rules-core.md`](session-1-rules-core.md) | Medium | ✅ Built |
| 2 | Bots and the local driver | [`session-2-bots-and-the-local-driver.md`](session-2-bots-and-the-local-driver.md) | Medium | ✅ Built |
| 3 | The table | — | Medium–Large | Next, not spec'd |
| 4 | Round end, the session, the record | — | Medium | Not spec'd |

Sessions 1–4 are hub Phase 5 and leave a Pit that one person plays against bots
on one phone. Multiplayer is Phases 6 and 7 — the `GameRoom` Durable Object,
then Pit on it — and is not spec'd here until the room exists.

## Why the game before the room

**Only multiplayer needs the Durable Object.** The rules module is pure. The
bots are a pure function of a view. The client renders a view and sends actions.
All three run in a browser tab with no server in the picture, and the family can
play the game while the room is still unwritten.

What that buys, stated as the things it avoids:

- **A rules bug is debugged in a tab, not through a socket.** The blind-swap
  arithmetic, the race for an offer, the corner check and the scoring are the
  parts most likely to be wrong. None of them is easier to find with WebSocket
  framing, hibernation and reconnect underneath.
- **The interface gets a second consumer before it is frozen.** The local driver
  in session 2 implements the same surface the room will, so `GameRoom` is
  written against a rules module that already exists rather than against
  `../gameroom.md` §4 alone.
- **Something is playable four sessions in.** The alternative order puts three
  sessions of infrastructure before the first hand is dealt.

The cost, stated honestly: the room contract is validated against a fake room
first, so the session that writes the real one will find gaps — a message the
driver never had to frame, a reconnect the driver never had to survive. That is
a session's worth of friction, paid once, against a game the kids can play in
the meantime.

## The contract both drivers implement

Session 2 writes `public/pit/room/local.js`. Phase 7 replaces it with a socket
to `GameRoom`. The client imports one or the other and knows nothing else about
either:

```js
join(seat)                  // returns nothing; the view arrives via onView
act(action)                 // fire and forget; a refusal comes back as onRefusal
onView(view => …)           // full view, pushed after every applied action and tick
onEvent(event => …)         // public events only, for animation and sound
onRefusal(({ action, reason }) => …)
leave()
```

Bots are not in it. They are gated and driven inside the rules module's `tick`,
because the gate lives in `State` and `State` is opaque to whatever carries it —
`session-2-bots-and-the-local-driver.md` §2 has the argument. A driver
therefore has nothing bot-shaped in it, and the two drivers cannot diverge over
bot timing.

Two rules that make the swap possible rather than merely intended:

- **The client never calls the rules module.** It renders `view` and sends
  `action`. It does not import `core/rules.js`, and a test asserts that.
- **Events are public.** Anything private is read from the next view. An event
  that carries a commodity is a leak whether or not the room is real.

## Conventions these specs assume

From `CLAUDE.md`, not from taste.

- **Pure core.** `public/pit/core/` never touches the DOM, `window`, storage or
  the clock. Every function that needs the time takes `now` as an argument.
  That is what lets `node --test` cover the same code the browser runs.
- **Rules modules never write.** Pit's result row is posted once by the client
  in session 4, the same way sudoku solo will post one. In Phase 7 the room
  posts it and the client stops.
- **No build step, no runtime dependencies.** Plain ES modules under
  `public/pit/`, relative imports, served at `/pit/` because that is where the
  files are.
- **Chrome only, current.** The 360px phone in portrait is the binding layout
  constraint. Nine full portrait cards do not lay out at that width, which is
  why `art/fruit/` exists — `../design.md` §4 says which art goes where.
- **Test files are `test/pit-*.test.js`.** The directory is flat and shared with
  sudoku's and the hub's, so the prefix is what keeps `rules.test.js` from being
  ambiguous when the third game arrives.

The size-literal ban in `CLAUDE.md` is sudoku's and does not apply here. Pit has
its own version of the same idea and it is narrower: **9, 4 and the point values
are named in `core/commodities.js` and nowhere else**, because the little-kid
mode in `../design.md` §6 changes all three.

## Device checks

Anything that can only be answered on a phone is an `S`* item in
[`../../sudoku/specs/questions.md`](../../sudoku/specs/questions.md), with the
person and the device named — not a line in a session's acceptance criteria.
Pit's are written when sessions 3 and 4 are spec'd, because until the client is
designed there is nothing specific to ask anybody to look at.
