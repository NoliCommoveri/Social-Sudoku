# Carson Family Gameroom — Roadmap

One site at `games.immotus.app` holding several games, shared player profiles,
and a record of what the family has played.

Players are 4, 5, 11 and 12, plus two adults. Everything below is sized for six
people who know each other, not for the public internet.

## What exists today

A sudoku at `/sudoku/`, deployed and playable, behind a hub that knows who you
are:

- Grid model, seeded generator, and clue-count difficulty tiers at 4×4, 6×6 and
  9×9 — `public/sudoku/core/`, about 600 lines, zero dependencies.
- Solo play with undo, redo, and a check button — `public/sudoku/ui/`.
- In-progress boards saved per size and tier in `localStorage`.
- The hub at `public/index.html`: a passphrase gate, the picker, the profile
  editor and the shelf the games sit on, drawing from `public/shared/` — the
  tokens, the thirty avatars, the profile rules, and the four calls the client
  makes.
- Pit's rules core, its bots and its local driver — `public/pit/core/` and
  `public/pit/room/`. A full session deals, trades, corners, scores and finishes
  against three bots, driven by a test file and by nothing else. No pixels.
- 250 tests under `test/`, run by GitHub Actions on every push.
- A Worker, `carson-gameroom`, serving `public/` at a `.workers.dev` URL, built
  by Cloudflare's GitHub integration on push to `main`.
- A D1 database, `gameroom`, holding the schema in `docs/architecture.md` §3.1,
  and the admin page at `/admin` that applies it, seeds it, backs it up, erases
  it and restores it — `worker/`.
- Identity: the gate at `/gate`, two signed cookies, and the four calls behind
  them — `worker/auth.js`, `worker/gate.js`, `worker/api.js`.

No Durable Object and no stored results. Profiles are made, renamed and
re-faced from the hub; nothing a player would miss has been written anywhere
yet. Pit has rules and no interface — nothing under `public/pit/` is reachable
from a browser, and the shelf does not offer it.

## The five things this is for

Stated as requirements so a slice can be checked against them.

- **H1 — One door.** Every game reachable from one address, one profile, one
  place that remembers you.
- **H2 — Several games.** Sudoku and a Pit-style trading game first. Adding a
  third must not require touching the first two.
- **H3 — Real players.** Profiles the family defines, with avatars and screen
  names each player changes whenever they like.
- **H4 — A record.** What was played, when, by whom, and how it went — per game
  and across all of them.
- **H5 — Kids want to open it.** The 4-year-old can find themselves and start
  something without reading. The 12-year-old is not embarrassed by it.

H5 is not a phase. It is a constraint on every phase that renders anything.

## Phases

Each phase leaves `main` deployed and playable. No phase depends on a later one.

### Phase 0 — Regroup ✅

This document, `docs/architecture.md`, `docs/identity-and-stats.md`,
`docs/design-language.md`. Design docs nested under `docs/`. No code moved.

### Phase 1 — Restructure ✅

The sudoku moved into the hub layout — `public/src/` → `public/sudoku/` —
behind a placeholder front page linking to it. No features, no behaviour
change, no bindings. The 46 tests passing on the moved tree are the proof the
move was clean.

### Phase 2 — The hub: door, profiles, database

The first phase with a server in it. Delivers **H1** and **H3**.

All four sessions are built. What is left is not code: setup tasks **A3** and
**A4**, and the browser checks **S6**–**S9**, which can be answered nowhere but
a deployment.

Setup tasks in `docs/architecture.md` §8. A1 — deleting the Worker left orphaned
by the rename — comes before the rest of them and before any binding exists.

This absorbs the old `slice-07-storage-foundation.md` and its erase/export
sibling, both rewritten for D1. Four sessions, because the erase/export sibling,
the avatar set, and editing a profile are each a piece of work rather than a
detail of one.

**Session A — database and admin.** Medium, ~50k. ✅ Built. `wrangler.jsonc`
gains `main`, the D1 binding and the `Text` rule for `**/*.sql`.
`worker/index.js` routes `/admin` and `/api/*` and lets everything else fall
through to assets. `worker/db/plan.js` is the pure half — quote-aware splitter,
checksums, applied/pending/drifted — and is the only part CI can reach, because
`node --test` cannot import a `.sql` file. `worker/db/migrations.js` is the only
module that imports SQL and holds no logic. `001_schema.sql` carries `players`,
`plays` and `play_results`; `seed_players.sql` carries placeholders. The admin
page renders before login and before any table exists, and puts the failing
statement and its error on the page. **A2** is done; the database is empty until
**S6** applies the schema from `/admin`.

**Session B — erase, export, re-import.** Medium, ~45k. ✅ Built.
[`docs/hub/specs/phase-2-session-b-erase-export.md`](docs/hub/specs/phase-2-session-b-erase-export.md)
is the design. `worker/db/backup.js` is the pure half — the export document, its
fingerprint, and the import plan — and `apply.js` gained the three D1 halves.
The export download sets a ten-minute cookie holding the fingerprint of the
snapshot it served, and the erase confirmation refuses without it, refuses when
the database has changed since, and refuses until the word `erase` is typed:
that is how the backup is unskippable with no client JavaScript and no secret.
Erase drops one table per statement, retrying until a pass drops nothing new,
because a batch that fails whole never makes progress against a foreign key.
Import is tolerant of a schema that moved, which is the case that actually
happens, and is `INSERT OR IGNORE` throughout. **S7** is the browser half.

**Session C — gate, picker, shelf.** Medium–Large, ~60k. ✅ Built.
[`docs/hub/specs/phase-2-session-c-gate-picker-shelf.md`](docs/hub/specs/phase-2-session-c-gate-picker-shelf.md)
is the design. `worker/auth.js` is the pure half — the HMAC, the two cookies,
and the check that keeps the gate's redirect on this site — and `gate.js` and
`api.js` are the halves that touch requests. The gate covers `/api/*` and
nothing else: the shell is a static file served before the Worker runs, so it
renders a spinner and no data until `/api/players` answers, and `/admin` stays
exempt because a gated `/admin` is a database that can never be brought up.
`public/shared/` gains the tokens, the thirty avatars, the game list and the
client's two calls; `public/hub/` is the picker and the shelf. Needs **A3** to
be usable at all, and **A4** follows it. **S8** is the browser half.

**Session D — editing a profile.** Small–Medium, ~30k. ✅ Built.
[`docs/hub/specs/phase-2-session-d-editing-a-profile.md`](docs/hub/specs/phase-2-session-d-editing-a-profile.md)
is the design. `public/shared/profile.js` is the pure half — what a name and a
face have to pass — and it sits under `public/` rather than `worker/` so the
editor and the Worker check the same rules without the dependency between the
trees turning round. `worker/api.js` gained `POST /api/players` and
`PATCH /api/players/:id`; a refusal names the field it is about, so the editor
can put the sentence beside the control that is wrong. Creating a profile picks
it only when the device had nobody, which is the difference between somebody
making themselves and a parent making one for a child. The editor is the hub's
third screen and both ways into it are on the picker — the front page stays the
games and the faces. **S9** is the browser half.

**Why C and D split.** C was at the top of its band before any of D was in it,
and the line between them is the one Phase 3 cares about: **Phase 3 needs
picking, not editing.** A `play_results` row needs a `player_id`, which the
`who` cookie answers; nothing in the record depends on a name being editable.

### Phase 3 — The record

Delivers **H4**. Sudoku solo writes a row when a board is finished; the hub
reads it back. Per-game and overall views. This is the first phase where the
site does something the standalone sudoku could not.

Absorbs the old slice 9. Medium.

### Phase 4 — Finish sudoku

Pencil marks, the reduced logical solver, the technique library and hint
button. Three existing specs, all pure client work with no server in them.

`docs/sudoku/specs/slice-04` (unwritten), `slice-05-solver.md`,
`slice-06-technique-library-hints.md`. Small, Small–Medium, Medium.

### Phase 5 — Pit, on one device

The whole game with no server under it: rules core, bots, the local driver, the
table, scoring and the result row. Four sessions, each Medium, tabled in
[`docs/pit/specs/README.md`](docs/pit/specs/README.md); the design is
[`docs/pit/design.md`](docs/pit/design.md).

Only multiplayer needs the Durable Object. The rules module is pure, the bots
are a pure function of a view, and the client renders a view and sends actions,
so all three run in a browser tab and the family can play against bots while the
room is still unwritten. Phase 6 is then written against a rules module that
exists rather than against `docs/gameroom.md` alone.

**Sessions 1 and 2 are built.** `public/pit/core/` holds the deal, the offer
board, the blind swap, the corner, the scoring and the confidentiality boundary;
`core/bot.js` holds the three levels, the target invariant and the latency that
cannot see the board; `tick` gates the bots, one per tick, because the gate is a
field of `State` and `State` is opaque to a room. `public/pit/room/local.js` is
the driver the client talks to and Phase 7 replaces with a socket. Session 3 —
the table — is next and is not spec'd.

A seat that stops trading freezes its cards, and most four-seat rounds cannot
then be won by anybody. `docs/pit/design.md` §2.6 settles it and nothing of it
is built: pause, bot takeover of a seat idle for sixty seconds, and abandon.
All three are rules actions, so they land before the table can draw a pause
button, an abandon button, or the takeover countdown.

### Phase 6 — GameRoom

The Durable Object: seats, sockets, hibernation, reconnect, tick, per-player
views. No game logic in it. [`docs/gameroom.md`](docs/gameroom.md). Medium.

### Phase 7 — Pit on the room

The local driver is replaced by a socket to `GameRoom` and the same client plays
against the family. The rules module does not change; the result row moves from
the client to the room. Medium.

### Phase 8 — Sudoku race

Same puzzle, per-player difficulty, on the now-proven room. The generator
already supports this — see `docs/architecture.md` §7. Medium.

### Phase 9 — Little-kid mode

Pit with no text, pip counts, 5-card corners. Its own mode, not a slider.
`docs/pit/design.md` §6. Medium.

### Phase 10 — PWA

Manifest, service worker, install to homescreen. Last by choice, not by
dependency. Small.

## Order, and why this one

**Hub plumbing before the Durable Object.** Phases 2 and 3 exercise every piece
that is easy to get wrong and painful to debug later — subpath routing, the
identity cookie, D1 migrations without a CLI, the custom domain — and they do it
against a game that already works. The alternative, building `GameRoom` first,
means debugging the hardest component before the pipeline that deploys it has
ever carried anything.

**The kids get something in Phase 2, not Phase 5.** Profiles with avatars are
the part a 5-year-old cares about, and they land before any new game does. A
shelf with one game on it and everyone's face on the front page is a real thing
to show them; a half-built trading game is not.

**The game before the room.** Pit's rules, bots and client are client-side
work, so building them first means a playable game four sessions in and a rules
bug debugged in a tab rather than through a socket. The cost is that the room
contract is validated against a local driver before the real room exists, and
the session that writes `GameRoom` will find the gaps — one session's friction,
paid once. `docs/pit/specs/README.md` states it in full.

**Sudoku finishes late, on purpose.** Pencil marks and the technique library are
genuinely wanted, but they improve a game that is already playable. The hub does
not exist at all until Phase 2.

## Open items

`docs/sudoku/specs/questions.md` holds the browser checks. Open: **S2**, **S4**
and **S5** — the device checks on the phone and Chromebook that no test can
close, all about the board, which nothing since has touched — and **S6**,
**S7**, **S8** and **S9**, which can be checked nowhere but a deployment. They
run in that order: S6 leaves a database with the schema and the six players in
it, S7 erases and rebuilds it, S8 needs both plus setup task **A3**, without
which nobody can get past the gate, and S9 is the editor, which needs somebody
to be through it.

Hub-level open items are in the documents that own them: identity and stats in
[`docs/identity-and-stats.md`](docs/identity-and-stats.md), the visual system in
[`docs/design-language.md`](docs/design-language.md), the Cloudflare setup tasks
in [`docs/architecture.md`](docs/architecture.md) §8.
