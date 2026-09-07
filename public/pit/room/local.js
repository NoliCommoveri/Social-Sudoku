// The client's end of a connection to a room that is not there.
//
// This implements the surface `../../../docs/pit/specs/README.md` names, the
// same one Phase 7's socket to `GameRoom` implements, and the client cannot
// tell them apart. That is the whole point of the file: the game is playable
// against bots on one device now, and the swap later is an import.
//
// One viewer per driver. This is a connection, not the room seen from above —
// a second `join` replaces the viewer and pushes a fresh view, which is what
// the room's reconnect will do.
//
// Nothing bot-shaped is in here. Bots are gated and driven inside `tick`,
// because the gate lives in State and State is opaque to whatever carries it —
// `../../../docs/pit/specs/session-2-bots-and-the-local-driver.md` §2.

import {
  init, validate, apply, view, tick, isComplete, tickIntervalMs, minPlayers, maxPlayers,
} from '../core/rules.js';
import { BOT_LEVELS, DEFAULT_LEVEL } from '../core/bot.js';

/**
 * How many can sit down, asked of the room rather than of the rules module.
 *
 * The setup screen needs the range to draw its tile row and may not import
 * `core/rules.js` — `../../../docs/pit/specs/session-3-the-table.md` §9. The
 * room is the right place to be asked: Phase 7's socket answers the same
 * question about the same rules, so a tenth commodity widens the row with no
 * edit in the client.
 *
 * @returns {{ minPlayers: number, maxPlayers: number, levels: string[], defaultLevel: string }}
 */
export function seatLimits() {
  return { minPlayers, maxPlayers, levels: [...BOT_LEVELS], defaultLevel: DEFAULT_LEVEL };
}

/**
 * The wall clock, and the only place under `public/pit/` that reads one. It is
 * injected because `node --test` has to play a full session in milliseconds and
 * a driver that reads the wall clock cannot be tested at all. The browser gets
 * this and never passes its own.
 */
const wallClock = {
  now: () => Date.now(),
  every: (ms, fn) => {
    const handle = setInterval(fn, ms);
    return () => clearInterval(handle);
  },
};

/**
 * @typedef {{ now: () => number, every: (ms: number, fn: () => void) => (() => void) }} Clock
 */

/**
 * @param {{ seats: object[], config?: object, seed?: string | number, clock?: Clock }} options
 * @returns {{ join: Function, act: Function, onView: Function, onEvent: Function, onRefusal: Function, onComplete: Function, leave: Function }}
 */
export function createLocalRoom({ seats, config = {}, seed = 0, clock = wallClock }) {
  let state = init(seats, config, seed);
  let viewer = null;
  let cancel = null;
  const handlers = { view: null, event: null, refusal: null, complete: null };
  let completed = false;

  // The view is the truth and the events are garnish for animation and sound.
  // A client that had to accumulate state from events would be a client that
  // drifts, and the first thing to drift would be a hand.
  function push(events) {
    if (viewer === null) return;
    if (handlers.view) handlers.view(view(state, viewer));
    if (handlers.event) for (const event of events) handlers.event(event);

    // After the view that ended the session, so the client paints the final
    // board before it draws the standings over it. Once: `tick` keeps running
    // until `leave()` and every one of those ticks sees the same finished
    // state. An abandoned session produces nothing at all, because
    // `isComplete` is null in `'abandoned'` — the no-writes property
    // `../../../docs/pit/design.md` §2.6 built, working as designed.
    if (completed) return;
    const outcome = isComplete(state);
    if (outcome === null) return;
    completed = true;
    // False here and true from Phase 7's socket, where the room writes the row
    // itself. `app.js`'s post is then one `if` rather than a file to delete.
    if (handlers.complete) handlers.complete({ ...outcome, recorded: false });
  }

  // A backgrounded tab comes back to one tick with a large `now` delta. Expiry
  // is timestamped so it self-corrects, and §2.1 of the session spec keeps the
  // bots from firing all at once. The catch-up is one tick, not one per
  // interval missed.
  function step() {
    const done = tick(state, clock.now());
    if (done.state === state) return;
    state = done.state;
    push(done.events);
  }

  return {
    /**
     * Which seat this client occupies. Takes a seat or a playerId.
     * @param {object | string} seat
     */
    join(seat) {
      viewer = typeof seat === 'string' ? seat : seat.playerId;
      if (cancel === null) cancel = clock.every(tickIntervalMs, step);
      push([]);
    },

    /**
     * Fire and forget. Validated immediately before applying, in the same turn,
     * which is what lets the loser of a race for an offer come back with
     * `taken` rather than a half-applied trade. A refusal pushes no view,
     * because nothing changed.
     * @param {object} action
     */
    act(action) {
      if (viewer === null) {
        if (handlers.refusal) handlers.refusal({ action, reason: 'not-joined' });
        return;
      }
      const check = validate(state, viewer, action);
      if (!check.ok) {
        if (handlers.refusal) handlers.refusal({ action, reason: check.reason });
        return;
      }
      const done = apply(state, viewer, action, clock.now());
      state = done.state;
      push(done.events);
    },

    /** @param {(view: object) => void} fn */
    onView(fn) { handlers.view = fn; },

    /** @param {(event: object) => void} fn */
    onEvent(fn) { handlers.event = fn; },

    /** @param {(refusal: { action: object, reason: string }) => void} fn */
    onRefusal(fn) { handlers.refusal = fn; },

    /**
     * Fired once, after the view that ended the session. The end screen needs
     * ranks, ranks with ties are `isComplete`'s to state, and the client may
     * not import the rules module — so the driver answers, the same way
     * `seatLimits()` does.
     * @param {(outcome: object) => void} fn
     */
    onComplete(fn) { handlers.complete = fn; },

    /** Idempotent, and fires nothing: leaving is not an ending. */
    leave() {
      if (cancel) cancel();
      cancel = null;
      viewer = null;
      handlers.view = null;
      handlers.event = null;
      handlers.refusal = null;
      handlers.complete = null;
    },
  };
}

// Eight characters or fewer, because the seat strip has to hold four of them at
// 360px, and plain first names: a bot that announces itself as a bot in its
// name is a bot the 5-year-old will not want to play.
const BOT_NAMES = [
  'Ada', 'Bo', 'Cleo', 'Dev', 'Esme', 'Finn', 'Gus', 'Hazel', 'Ida',
  'Jonah', 'Kit', 'Lena', 'Milo', 'Nia', 'Otto', 'Pip', 'Rosa', 'Tess',
];

/**
 * Bot seats, named here rather than in the rules module: names and ids are a
 * room's business and the rules do not have an opinion about either.
 *
 * How many bots sit down is asked at room setup every time — which is also the
 * deck size — so it is the client that calls this.
 *
 * @param {number} count
 * @param {string} [level] 'easy' | 'normal' | 'hard'
 * @param {() => number} [rng]
 * @returns {{ playerId: string, name: string, isBot: true, botLevel: string }[]}
 */
export function botSeats(count, level = DEFAULT_LEVEL, rng = Math.random) {
  if (!Number.isInteger(count) || count < 0 || count > BOT_NAMES.length) {
    throw new RangeError(`cannot seat ${count} bots`);
  }
  const pool = [...BOT_NAMES];
  return Array.from({ length: count }, (_, index) => ({
    playerId: `bot-${index + 1}`,
    name: pool.splice(Math.floor(rng() * pool.length), 1)[0],
    isBot: true,
    botLevel: level,
  }));
}
