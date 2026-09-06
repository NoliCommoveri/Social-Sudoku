# Carson Family Gameroom — Roadmap

One site at `games.immotus.app` holding several games, shared player profiles,
and a record of what the family has played.

Players are 4, 5, 11 and 12, plus two adults. Everything below is sized for six
people who know each other, not for the public internet.

## What exists today

A standalone sudoku, deployed and playable:

- Grid model, seeded generator, and clue-count difficulty tiers at 4×4, 6×6 and
  9×9 — `public/src/core/`, about 600 lines, zero dependencies.
- Solo play with undo, redo, and a check button — `public/src/ui/`.
- In-progress boards saved per size and tier in `localStorage`.
- 46 tests under `test/`, run by GitHub Actions on every push.
- A Worker serving `public/` at a `.workers.dev` URL, built by Cloudflare's
  GitHub integration on push to `main`.

No database, no Durable Object, no identity, no stored results. Nothing that a
player would miss has been written anywhere yet, which is what makes the
restructure below cheap.

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

This document, `docs/architecture.md`, `docs/restructure.md`,
`docs/identity-and-stats.md`, `docs/design-language.md`. Design docs nested
under `docs/`. No code moved.

### Phase 1 — Restructure

Move the sudoku code into the hub layout. No new features, no new behaviour,
no new bindings. `public/src/core/` → `public/sudoku/core/`, and so on. The 46
tests are the proof the move was clean.

Full plan in [`docs/restructure.md`](docs/restructure.md). Small.

### Phase 2 — The hub: door, profiles, database

The first phase with a server in it. Delivers **H1** and **H3**.

- D1 database, the migrations/seeds module, and the admin page.
- The family passphrase gate and the two signed cookies.
- Profiles: create, pick, change avatar, change screen name.
- The hub landing page — the game shelf.
- Custom domain `games.immotus.app`.

Setup tasks in `docs/architecture.md` §8. One of them, the optional Worker
rename, is cheapest *before* this phase rather than during it.

This absorbs the old `slice-07-storage-foundation.md` and its erase/export
sibling, both rewritten for D1. Medium, likely two sessions.

### Phase 3 — The record

Delivers **H4**. Sudoku solo writes a row when a board is finished; the hub
reads it back. Per-game and overall views. This is the first phase where the
site does something the standalone sudoku could not.

Absorbs the old slice 9. Medium.

### Phase 4 — Finish sudoku

Pencil marks, the reduced logical solver, the technique library and hint
button. Three existing specs, unchanged by the pivot — they are pure client
work with no server in them.

`docs/sudoku/specs/slice-04` (unwritten), `slice-05-solver.md`,
`slice-06-technique-library-hints.md`. Small, Small–Medium, Medium.

### Phase 5 — GameRoom

The Durable Object: seats, sockets, hibernation, reconnect, tick, per-player
views. No game logic in it. [`docs/gameroom.md`](docs/gameroom.md). Medium.

### Phase 6 — Pit

Rules module, then client, then the ring. Playable against humans only.
[`docs/pit/design.md`](docs/pit/design.md). Medium, likely two sessions.

### Phase 7 — Pit bots

The game is thin at four players and the kids are not always all available.
Medium.

### Phase 8 — Sudoku race

Same puzzle, per-player difficulty, on the now-proven room. The generator
already supports this — see `docs/architecture.md` §7. Medium.

### Phase 9 — Little-kid mode

Pit with no text, pip counts, 5-card corners. Its own mode, not a slider.
`docs/pit/design.md` §7. Medium.

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

**The kids get something in Phase 2, not Phase 6.** Profiles with avatars are
the part a 5-year-old cares about, and they land before any new game does. A
shelf with one game on it and everyone's face on the front page is a real thing
to show them; a half-built trading game is not.

**Sudoku finishes late, on purpose.** Pencil marks and the technique library are
genuinely wanted, but they improve a game that is already playable. The hub does
not exist at all until Phase 2.

## What the pivot did not cost

Named because the obvious fear is that a redesign throws work away.

- **All 600 lines of sudoku core survive unedited.** Pure functions, no DOM, no
  storage, no imports outside `core/`. They move directories and nothing else.
- **The UI survives.** It gets re-parented under `/sudoku/` and later gains a
  hub header. No rewrite.
- **The tests survive.** Import paths change; assertions do not.
- **Three slice specs survive verbatim** — pencil marks, solver, technique
  library. None of them has a server in it.
- **`localStorage` survives** as the in-progress-board store. It was already
  forbidden from holding results, which is exactly why the hub's database
  arrives with no migration to perform.

One spec is superseded: `slice-07-storage-foundation.md`, which built the
storage layer on DO SQLite. Its migrations-and-admin machinery carries over
almost whole; only its target changes. See `docs/architecture.md` §3.

## Open items

`docs/sudoku/specs/questions.md` holds the sudoku ones. Still open and still
relevant after the pivot: **S2**, **S4** and **S5** — the device checks on the
phone and Chromebook that no test can close. They are about the board, which
this restructure does not touch, so they carry forward unchanged.

Hub-level open items are in the documents that own them: identity and stats in
[`docs/identity-and-stats.md`](docs/identity-and-stats.md), the visual system in
[`docs/design-language.md`](docs/design-language.md), the Cloudflare setup tasks
in [`docs/architecture.md`](docs/architecture.md) §8.
