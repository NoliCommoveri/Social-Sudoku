-- The whole schema, including the ledger that records this file being applied.
-- There is no zeroth migration: applying 001 creates _migrations and writes its
-- own row into it, in one batch.
--
-- Every statement here is idempotent -- CREATE ... IF NOT EXISTS, or an INSERT
-- with ON CONFLICT DO NOTHING. That is not decoration. A failed migration is
-- rolled back whole by D1, and the admin page then re-runs the statements one
-- at a time to name the one that failed (worker/db/apply.js). Re-running is
-- only safe because of this rule, and test/sql-files.test.js asserts it.

CREATE TABLE IF NOT EXISTS _migrations (
  name        TEXT    PRIMARY KEY,
  checksum    TEXT    NOT NULL,
  applied_at  INTEGER NOT NULL
);

-- id is stable and never shown; screen_name changes as often as a 12-year-old
-- likes and nothing keys on it. retired_at is a soft delete, so results keep
-- their author. docs/identity-and-stats.md §3.
CREATE TABLE IF NOT EXISTS players (
  id          TEXT    PRIMARY KEY,
  screen_name TEXT    NOT NULL,
  avatar      TEXT    NOT NULL,
  created_at  INTEGER NOT NULL,
  retired_at  INTEGER
);

-- An avatar is how a pre-reader finds their own row, so two live players may
-- not share one. Retired players release theirs.
CREATE UNIQUE INDEX IF NOT EXISTS players_avatar_live
  ON players (avatar) WHERE retired_at IS NULL;

-- A play is a thing that happened. mode is per-game ('solo', 'race', ...) and
-- config_json carries what the game needs to describe itself later -- size and
-- tier for sudoku -- without a column per game. docs/architecture.md §3.1.
CREATE TABLE IF NOT EXISTS plays (
  id          TEXT    PRIMARY KEY,
  session_id  TEXT,
  game        TEXT    NOT NULL,
  mode        TEXT    NOT NULL,
  config_json TEXT,
  started_at  INTEGER NOT NULL,
  ended_at    INTEGER
);

-- The play log is read newest-first on the hub's front page, and per-game views
-- filter on game.
CREATE INDEX IF NOT EXISTS plays_recent ON plays (started_at DESC);
CREATE INDEX IF NOT EXISTS plays_by_game ON plays (game, started_at DESC);

-- One player's outcome in one play. unit says what value means ('seconds',
-- 'points') so a reader needs no per-game knowledge; detail_json absorbs the
-- extras a third game brings. A play with no rows here is an abandoned game,
-- which is a true thing worth being able to see.
CREATE TABLE IF NOT EXISTS play_results (
  play_id     TEXT    NOT NULL REFERENCES plays (id),
  player_id   TEXT    NOT NULL REFERENCES players (id),
  rank        INTEGER,
  outcome     TEXT    NOT NULL,
  value       REAL,
  unit        TEXT,
  detail_json TEXT,
  PRIMARY KEY (play_id, player_id)
);

-- "Who is fastest at 9x9 hard" is one index scan: a player's results, best
-- value first. There is no bests table -- a best is MIN(value) over this.
CREATE INDEX IF NOT EXISTS play_results_by_player
  ON play_results (player_id, value);
