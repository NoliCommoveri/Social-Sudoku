# Carson Family Gameroom

One site at `games.immotus.app` holding several games, shared player profiles,
and a record of what the family has played.

Sudoku is built and playable — solo at 4×4, 6×6 and 9×9 with three difficulty
tiers — behind a family passphrase, a profile picker and a shelf. Pit, the
trading game, is on the shelf beside it and is played against bots on one
phone. Everything is sized for six people who live together.

## Where things are

- **[`ROADMAP.md`](ROADMAP.md)** — what exists, the phases, and what is next.
  Start here.
- **[`docs/architecture.md`](docs/architecture.md)** — the Cloudflare stack, and
  what each piece is for.
- **[`docs/identity-and-stats.md`](docs/identity-and-stats.md)** — players,
  avatars, screen names, and the play record.
- **[`docs/design-language.md`](docs/design-language.md)** — how it looks, and
  the 4-to-12 age-span problem.
- **[`docs/gameroom.md`](docs/gameroom.md)** — the shared multiplayer room
  interface.
- **`docs/sudoku/`**, **`docs/pit/`** — per-game design and slice specs.
- **`public/`** — everything served. Plain ES modules, no build step, no runtime
  dependencies. One directory per game: `public/sudoku/`, `public/pit/`.
  `public/index.html`
  is the hub front page, `public/hub/` its picker and shelf, and
  `public/shared/` what every screen draws from.
- **`worker/`** — the Worker: routing, identity, the admin page, and everything
  that touches D1. Never served.
- **`test/`** — `node:test` suites, run by GitHub Actions on every push.

`public/sudoku/dev.html` is a developer page: generator timing on the actual
phone and a visual spot-check of dealt puzzles. It is not a test suite.

## Working on this

`CLAUDE.md` is the standing directives — no CLI, no build step, how migrations
work, how sessions are budgeted. Read it before changing anything.
