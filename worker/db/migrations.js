// The only module in the project that imports SQL, and the only reason it
// exists. It holds no logic; everything that decides anything is in plan.js,
// where CI can reach it.
//
// The two lists have opposite rules and are easy to average by accident:
//
//   MIGRATIONS  schema. Checksummed. Applied once, in order, by Apply pending.
//               An edit after it has run shows as drift and is never silently
//               reapplied. Adding one means adding a file and a line here.
//
//   SEEDS       data. Never checksummed, never recorded. Run seed re-executes
//               the whole list on every press, which is what lets a puzzle
//               bank or an avatar set grow by editing a file in the web
//               editor. Every statement is INSERT ... ON CONFLICT DO NOTHING.
//
// The Text rule in wrangler.jsonc is what makes these imports strings.
// test/sql-files.test.js fails if a .sql file under sql/ is not named here: a
// file nobody imports looks applied and is not.

import schema001 from './sql/001_schema.sql';
import seedPlayers from './sql/seed_players.sql';

/** @type {{ name: string, sql: string }[]} */
export const MIGRATIONS = [
  { name: '001_schema.sql', sql: schema001 },
];

/** @type {{ name: string, sql: string }[]} */
export const SEEDS = [
  { name: 'seed_players.sql', sql: seedPlayers },
];
