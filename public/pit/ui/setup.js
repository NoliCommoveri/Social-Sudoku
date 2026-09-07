// The room-setup screen's pure half: the seat list a set of choices makes, and
// the config that goes with it.
//
// It takes plain values rather than a form element, which is what keeps it
// testable, and it reaches the rules module's limits through the room —
// `../room/local.js`'s `seatLimits()` — because the client may not import
// `../core/rules.js` (`../../../docs/pit/specs/session-3-the-table.md` §9).

import { botSeats, seatLimits } from '../room/local.js';
import { AVATARS } from '../../shared/avatars.js';

/** How many rounds a session is. Three choices, and one of them is remembered. */
export const TARGETS = [200, 300, 500];

/** Two bots is the floor: there is one human and `minPlayers` is three. */
export function botRange() {
  const { minPlayers, maxPlayers } = seatLimits();
  return Array.from({ length: maxPlayers - minPlayers + 1 }, (_, i) => minPlayers - 1 + i);
}

/**
 * The faces bots are allowed to wear: every avatar no real profile holds.
 *
 * A bot in the 11-year-old's fox is a bot the 11-year-old will mind, and thirty
 * faces against six profiles leaves plenty. The face is the client's, not the
 * game's — `Seat` has no avatar field and does not get one.
 *
 * @param {{ avatar: string }[]} players every live profile
 * @returns {string[]}
 */
export function botAvatarPool(players) {
  const taken = new Set(players.map((player) => player.avatar));
  return AVATARS.map((entry) => entry.key).filter((key) => !taken.has(key));
}

/**
 * The seats, and the faces to draw them with.
 *
 * `seats[0]` is the human; the rest come from the room's `botSeats`. Faces are
 * drawn without replacement, so no two bots at one table look alike.
 *
 * @param {{ me: { id: string, name: string, avatar: string }, botCount: number,
 *          botLevel?: string, avatars: string[], rng?: () => number }} choices
 * @returns {{ seats: object[], faces: { [playerId: string]: string } }}
 */
export function buildSeats({ me, botCount, botLevel, avatars, rng = Math.random }) {
  const { minPlayers, maxPlayers, levels, defaultLevel } = seatLimits();
  if (!Number.isInteger(botCount) || botCount < minPlayers - 1 || botCount > maxPlayers - 1) {
    throw new RangeError(`cannot seat ${botCount} bots beside one player`);
  }
  const level = levels.includes(botLevel) ? botLevel : defaultLevel;
  const bots = botSeats(botCount, level, rng);

  const pool = [...avatars];
  const faces = { [me.id]: me.avatar };
  for (const seat of bots) {
    // An exhausted pool is not a reason to refuse a game; the fallback repeats
    // rather than leaving a seat faceless.
    const index = pool.length ? Math.floor(rng() * pool.length) : -1;
    faces[seat.playerId] = index < 0 ? me.avatar : pool.splice(index, 1)[0];
  }

  return {
    seats: [{ playerId: me.id, name: me.name }, ...bots],
    faces,
  };
}

/**
 * The rules config out of the setup screen's choices. An unrecognised
 * remembered value falls back rather than reaching `init` — a preference
 * written by an older shape of the screen must not be able to deal a game with
 * a target nobody can reach.
 *
 * @param {{ target?: unknown, autoCorner?: unknown }} choices
 * @returns {{ target: number, autoCorner: boolean }}
 */
export function configFrom(choices = {}) {
  const target = TARGETS.includes(choices.target) ? choices.target : TARGETS[1];
  return { target, autoCorner: choices.autoCorner === true };
}
