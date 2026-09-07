// Pit as pure functions: what a deal is, which trades are legal, what a trade
// does, what each player is allowed to see, and when a session is over.
//
// This is the `GameRules` of `../../../docs/gameroom.md` §4. Nothing here reads
// a clock, calls Math.random(), or touches the DOM — `now` arrives as an
// argument and randomness comes from the seed carried in state, which is what
// lets the same code run in a tab, in a test runner, and in a Durable Object
// that may be woken from storage between two actions.
//
// State is opaque to whatever carries it and is plain JSON: no Set, no Map, no
// class instance, because in Phase 6 it is written to DO storage.

import { mulberry32, shuffled } from './rng.js';
import { HAND, MAX_OFFER, COMMODITY_KEYS, drawCommodities, valuesFor } from './commodities.js';
import { botAction, botDelay, botNotice, DEFAULT_LEVEL } from './bot.js';

export const id = 'pit';

// Three is the smallest table where a blind swap is a decision rather than an
// exchange with the only other person holding cards. The ceiling is the deck:
// one commodity per seat.
export const minPlayers = 3;
export const maxPlayers = COMMODITY_KEYS.length;
export const supportsBots = true;

/** `../../../docs/gameroom.md` §7. Offer expiry and bot gating, nothing finer. */
export const tickIntervalMs = 500;

/** An abandoned offer clears itself rather than clogging the board. */
export const OFFER_TTL_MS = 20000;

/** The round-end reveal ends here whether or not everyone pressed through. */
export const REVEAL_BACKSTOP_MS = 30000;

/**
 * How long a seat may go without acting before a bot takes it over.
 * `../../../docs/pit/design.md` §2.6: a four-seat round hangs the moment
 * somebody puts their phone down, and a frozen board is not something a
 * 5-year-old waits out.
 */
export const IDLE_TAKEOVER_MS = 60000;

/** An abandon proposal nobody seconds clears itself rather than sitting there. */
export const ABANDON_TTL_MS = 30000;

/**
 * The level a caretaker bot plays a taken-over seat at. It is not the session's
 * chosen level: the caretaker's job is to keep the round moving rather than to
 * win it, and `../../../docs/pit/design.md` §2.6's simulations are at this one.
 */
const CARETAKER_LEVEL = DEFAULT_LEVEL;

export const defaultConfig = {
  target: 300,        // five or six rounds, which is one sitting
  autoCorner: false,  // design §2.4: missing your own win is the tension
};

// Rounds deal from the session seed offset by the round number, so a round is
// reproducible on its own and the deal does not depend on how much trading
// happened in the one before it.
const ROUND_STRIDE = 0x9e3779b1;

// Bot substreams are offset by this so that consecutive draws are consecutive
// only in the counter and not in the seed.
const BOT_STRIDE = 0x85ebca6b;

const OK = Object.freeze({ ok: true });
const refuse = (reason) => ({ ok: false, reason });

/** The three a paused table still accepts. Everything else refuses `paused`. */
const PAUSE_EXEMPT = ['resume', 'abandon', 'present'];

/* ------------------------------------------------------------------ hands */

/** @typedef {{ [commodity: string]: number }} Hand */

/**
 * An absent key means zero, and a count that reaches zero loses its key. That
 * is not tidiness: a key held at 0 still names a commodity, and view() is
 * checked by walking its output for commodity names.
 * @param {Hand} hand
 * @param {string} commodity
 * @returns {number}
 */
export function held(hand, commodity) {
  return hand[commodity] || 0;
}

/**
 * @param {Hand} hand
 * @param {string} commodity
 * @param {number} delta
 * @returns {Hand} a copy
 */
function moved(hand, commodity, delta) {
  const next = { ...hand };
  const count = held(next, commodity) + delta;
  if (count < 0) throw new RangeError(`${commodity} would go negative`);
  if (count === 0) delete next[commodity];
  else next[commodity] = count;
  return next;
}

/** @param {Hand} hand @returns {number} */
export function handSize(hand) {
  return Object.values(hand).reduce((sum, n) => sum + n, 0);
}

/**
 * The commodity this hand is a corner of, or null.
 * @param {Hand} hand
 * @returns {string | null}
 */
export function cornered(hand) {
  const keys = Object.keys(hand);
  if (keys.length !== 1) return null;
  return hand[keys[0]] === HAND ? keys[0] : null;
}

/* ------------------------------------------------------------------- init */

/**
 * @param {string | number} seed
 * @returns {number}
 */
function numericSeed(seed) {
  if (typeof seed === 'number' && Number.isFinite(seed)) return seed | 0;
  const text = String(seed);
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash | 0;
}

/**
 * @param {{ playerId: string, name?: string, isBot?: boolean, botLevel?: string }[]} seats
 * @param {{ target?: number, autoCorner?: boolean }} [config]
 * @param {string | number} [seed]
 * @returns {object} state
 */
export function init(seats, config = {}, seed = 0) {
  if (!Array.isArray(seats) || seats.length < minPlayers || seats.length > maxPlayers) {
    throw new RangeError(`Pit seats ${seats?.length} outside ${minPlayers}..${maxPlayers}`);
  }
  const taken = seats.map((seat) => String(seat.playerId));
  if (new Set(taken).size !== taken.length) throw new RangeError('duplicate playerId');

  const table = seats.map((seat, index) => ({
    playerId: taken[index],
    name: seat.name ?? taken[index],
    isBot: seat.isBot === true,
    ...(seat.botLevel ? { botLevel: seat.botLevel } : {}),
  }));

  const numeric = numericSeed(seed);
  const commodities = drawCommodities(mulberry32(numeric), table.length);
  const scores = {};
  for (const seat of table) scores[seat.playerId] = 0;

  return deal({
    seed: numeric,
    target: config.target ?? defaultConfig.target,
    autoCorner: config.autoCorner ?? defaultConfig.autoCorner,
    seats: table,
    commodities,
    values: valuesFor(commodities),
    round: 0,
    phase: 'trading',
    hands: {},
    offers: [],
    offerSeq: 0,
    scores,
    history: [],
    botsReadyAt: {},
    botSeq: 0,
    ready: [],
    roundEndsAt: 0,
    // Per-seat and per-session, parallel to `hands` and `scores` rather than
    // fields on `seats[]`, which is the static roster.
    idleSince: {},
    takenOver: [],
    forfeit: [],
    pausedAt: null,
    abandon: null,
  }, 1);
}

/**
 * A fresh HAND to every seat, and everything that is per-round back to nothing.
 * @param {object} state
 * @param {number} round
 * @returns {object}
 */
function deal(state, round) {
  const rng = mulberry32((state.seed + Math.imul(round, ROUND_STRIDE)) | 0);
  const deck = [];
  for (const commodity of state.commodities) {
    for (let i = 0; i < HAND; i++) deck.push(commodity);
  }
  const dealt = shuffled(rng, deck);

  const hands = {};
  state.seats.forEach((seat, index) => {
    let hand = {};
    for (let i = 0; i < HAND; i++) hand = moved(hand, dealt[index * HAND + i], 1);
    hands[seat.playerId] = hand;
  });

  const next = {
    ...state,
    round,
    phase: 'trading',
    hands,
    offers: [],
    offerSeq: 0,
    history: [],
    botsReadyAt: {},
    ready: [],
    roundEndsAt: 0,
    // The penalty is per round. `takenOver` is not reset beside it on purpose:
    // a phone still in a pocket at the next deal is still in a pocket.
    forfeit: [],
  };
  delete next.harvest;
  return next;
}

/* --------------------------------------------------------------- validate */

const seatOf = (state, actor) => state.seats.find((seat) => seat.playerId === actor) ?? null;
const liveOffer = (state, actor) => state.offers.find((offer) => offer.playerId === actor) ?? null;

/**
 * Never mutates, and is called immediately before apply() in the same turn —
 * both the local driver and the Durable Object are single-threaded, which is
 * what makes "validate then apply" atomic and lets the loser of a race for an
 * offer come back with `taken` rather than a half-applied trade.
 * @returns {{ ok: true } | { ok: false, reason: string }}
 */
export function validate(state, actor, action) {
  if (!seatOf(state, actor)) return refuse('no-seat');
  if (!action || typeof action.type !== 'string') return refuse('no-action');

  // One guard above the switch rather than a clause in every case: a paused
  // table is a table where nothing moves, and an action added later cannot
  // forget to be refused. `pause` lands here too, which is how a second press
  // refuses with `paused` and not with a reason of its own.
  if (state.pausedAt !== null && !PAUSE_EXEMPT.includes(action.type)) return refuse('paused');

  const hand = state.hands[actor] ?? {};

  switch (action.type) {
    case 'offer': {
      if (state.phase !== 'trading') return refuse('phase');
      if (!state.commodities.includes(action.commodity)) return refuse('commodity');
      if (!Number.isInteger(action.count) || action.count < 1 || action.count > MAX_OFFER) {
        return refuse('count');
      }
      // One live offer per player is what keeps the board readable at 360px.
      if (liveOffer(state, actor)) return refuse('live-offer');
      if (held(hand, action.commodity) < action.count) return refuse('cards');
      return OK;
    }
    case 'withdraw': {
      if (state.phase !== 'trading') return refuse('phase');
      if (!liveOffer(state, actor)) return refuse('no-offer');
      return OK;
    }
    case 'accept': {
      if (state.phase !== 'trading') return refuse('phase');
      const offer = state.offers.find((o) => o.id === action.offerId);
      if (!offer) return refuse('taken');
      if (offer.playerId === actor) return refuse('own-offer');
      if (!state.commodities.includes(action.commodity)) return refuse('commodity');
      if (held(hand, action.commodity) < offer.count) return refuse('cards');
      return OK;
    }
    case 'harvest': {
      if (state.phase !== 'trading') return refuse('phase');
      if (!cornered(hand)) return refuse('no-corner');
      return OK;
    }
    case 'ready': {
      if (state.phase !== 'roundEnd') return refuse('phase');
      if (state.ready.includes(actor)) return refuse('ready');
      return OK;
    }
    // Any seat may pause and any seat may resume, so that no one child holds
    // the game (`../../../docs/pit/design.md` §2.6).
    case 'pause':
    case 'resume':
    case 'abandon':
    case 'present': {
      if (state.phase === 'over' || state.phase === 'abandoned') return refuse('phase');
      if (action.type === 'resume' && state.pausedAt === null) return refuse('not-paused');
      return OK;
    }
    case 'disconnect':
      return OK;
    default:
      return refuse('unknown-action');
  }
}

/* ------------------------------------------------------------------ apply */

/**
 * Assumes the action has just validated. Returns a new state rather than
 * mutating, so a room can snapshot cheaply.
 * @returns {{ state: object, events: object[] }}
 */
export function apply(state, actor, action, now) {
  const done = dispatch(state, actor, action, now);
  // The room telling us a socket is gone must not look like presence. A stamp
  // here would keep a player who has left looking present for another minute,
  // which is exactly the case takeover exists for.
  if (action.type === 'disconnect') return done;
  return stamped(done, actor, now);
}

function dispatch(state, actor, action, now) {
  switch (action.type) {
    case 'offer': return applyOffer(state, actor, action, now);
    case 'withdraw': return applyWithdraw(state, actor);
    case 'accept': return applyAccept(state, actor, action);
    case 'harvest': return applyHarvest(state, actor, now);
    case 'ready': return applyReady(state, actor);
    case 'pause': return applyPause(state, actor, now);
    case 'resume': return applyResume(state, actor, now);
    case 'abandon': return applyAbandon(state, actor, now);
    // The only action whose entire effect is the stamp every action already
    // gets. It exists so that a player deliberating with a thumb on the screen
    // is distinguishable from one whose phone is in a pocket, and no other
    // action can say that without also trading.
    case 'present': return { state, events: [] };
    case 'disconnect': return liveOffer(state, actor)
      ? applyWithdraw(state, actor)
      : { state, events: [] };
    default: throw new Error(`unapplied action ${action.type}`);
  }
}

/**
 * Every valid action is evidence its seat is at the table. Done once, around
 * the dispatch, so an action added later cannot forget it — and a seat a bot
 * had taken over comes back to its player by the same line.
 */
function stamped({ state, events }, actor, now) {
  const next = { ...state, idleSince: { ...state.idleSince, [actor]: now } };
  if (!state.takenOver.includes(actor)) return { state: next, events };
  next.takenOver = state.takenOver.filter((id) => id !== actor);
  // `forfeit` is deliberately left alone: reclaiming the seat does not undo the
  // round the bot played it for.
  return { state: next, events: [...events, { kind: 'reclaim', playerId: actor }] };
}

// Offered cards leave the hand. Escrow rather than a lock: conservation stays a
// one-line invariant, and you cannot corner with cards you have offered away,
// which is the honest reading of a table where those cards are face down in
// front of everybody.
function applyOffer(state, actor, action, now) {
  const seq = state.offerSeq + 1;
  const offer = {
    id: `${state.round}-${seq}`,
    playerId: actor,
    count: action.count,
    commodity: action.commodity,
    postedAt: now,
    expiresAt: now + OFFER_TTL_MS,
  };
  const event = { kind: 'offer', playerId: actor, count: action.count };
  return {
    state: {
      ...state,
      offerSeq: seq,
      offers: [...state.offers, offer],
      hands: { ...state.hands, [actor]: moved(state.hands[actor], action.commodity, -action.count) },
      history: [...state.history, event],
    },
    events: [event],
  };
}

function applyWithdraw(state, actor) {
  const offer = liveOffer(state, actor);
  return {
    state: {
      ...state,
      offers: state.offers.filter((o) => o.id !== offer.id),
      hands: { ...state.hands, [actor]: moved(state.hands[actor], offer.commodity, offer.count) },
    },
    events: [{ kind: 'withdraw', playerId: actor, count: offer.count }],
  };
}

// The blind swap. Neither side knew what they were getting, which is the entire
// game, so this is the arithmetic worth reading twice: the escrow goes to the
// accepter, the accepter's nominated block goes to the offerer, and no card is
// created or destroyed by either move.
function applyAccept(state, actor, action) {
  const offer = state.offers.find((o) => o.id === action.offerId);
  const hands = { ...state.hands };
  hands[actor] = moved(moved(hands[actor], action.commodity, -offer.count), offer.commodity, offer.count);
  hands[offer.playerId] = moved(hands[offer.playerId], action.commodity, offer.count);
  const event = { kind: 'trade', a: offer.playerId, b: actor, count: offer.count };
  return {
    state: {
      ...state,
      hands,
      offers: state.offers.filter((o) => o.id !== offer.id),
      history: [...state.history, event],
    },
    events: [event],
  };
}

function applyHarvest(state, actor, now) {
  const commodity = cornered(state.hands[actor]);
  // `../../../docs/pit/design.md` §2.6's penalty: the round still ends, the
  // reveal still happens, the next round still deals — the cost of a bot having
  // ended it falls on the seat that left, and on nobody else. Nothing passes to
  // second place.
  const forfeited = state.forfeit.includes(actor);
  const value = forfeited ? 0 : state.values[commodity];

  // Every escrow comes home before the reveal, so the hands that are shown are
  // all the cards there are.
  const hands = { ...state.hands };
  for (const offer of state.offers) {
    hands[offer.playerId] = moved(hands[offer.playerId], offer.commodity, offer.count);
  }

  return {
    state: {
      ...state,
      phase: 'roundEnd',
      hands,
      offers: [],
      scores: { ...state.scores, [actor]: state.scores[actor] + value },
      harvest: { playerId: actor, commodity, value, forfeited },
      roundEndsAt: now + REVEAL_BACKSTOP_MS,
      ready: [],
    },
    events: [{ kind: 'harvest', playerId: actor }],
  };
}

function applyReady(state, actor) {
  const ready = [...state.ready, actor];
  // A taken-over seat is not waited on, or an absent player holds the reveal
  // open for the whole backstop every round while a bot plays their cards.
  const waiting = state.seats.some((seat) =>
    !seat.isBot && !state.takenOver.includes(seat.playerId) && !ready.includes(seat.playerId));
  const next = { ...state, ready };
  return waiting ? { state: next, events: [] } : advance(next);
}

function applyPause(state, actor, now) {
  return { state: { ...state, pausedAt: now }, events: [{ kind: 'paused', playerId: actor }] };
}

/**
 * Every clock in State is an absolute timestamp, so a pause that only stopped
 * `tick` would resume by expiring the whole board, opening every bot gate and
 * taking over every seat in one frame. Resuming moves all four forward by the
 * span instead, which is the entire reason pause is more than one line.
 */
function applyResume(state, actor, now) {
  const span = now - state.pausedAt;
  const shift = (map) => {
    const out = {};
    for (const key of Object.keys(map)) out[key] = map[key] + span;
    return out;
  };
  return {
    state: {
      ...state,
      pausedAt: null,
      offers: state.offers.map((offer) => ({ ...offer, expiresAt: offer.expiresAt + span })),
      roundEndsAt: state.roundEndsAt === 0 ? 0 : state.roundEndsAt + span,
      idleSince: shift(state.idleSince),
      // The one `design.md` §2.6 does not name, and the same bug with a
      // different symptom: without it, resume opens with every bot acting.
      botsReadyAt: shift(state.botsReadyAt),
    },
    events: [{ kind: 'resumed', playerId: actor, span }],
  };
}

/**
 * The second seat exists so that one child cannot end everybody's game. At a
 * table with one non-bot seat there is nobody to protect, and a confirmation no
 * bot will ever send would make the session unquittable.
 */
function applyAbandon(state, actor, now) {
  const alone = state.seats.filter((seat) => !seat.isBot).length < 2;
  const seconded = state.abandon !== null && state.abandon.by !== actor;
  if (alone || seconded) {
    return { state: { ...state, phase: 'abandoned' }, events: [{ kind: 'abandoned' }] };
  }
  // A second press from the proposing seat is the way out, rather than a fourth
  // action nobody would find.
  if (state.abandon !== null) {
    return { state: { ...state, abandon: null }, events: [{ kind: 'abandon-cancelled', playerId: actor }] };
  }
  return {
    state: { ...state, abandon: { by: actor, at: now } },
    events: [{ kind: 'abandon-proposed', playerId: actor }],
  };
}

/**
 * Out of the reveal: either the session is over or the next round deals.
 */
function advance(state) {
  const best = Math.max(...Object.values(state.scores));
  if (best >= state.target) {
    return { state: { ...state, phase: 'over' }, events: [{ kind: 'over' }] };
  }
  const next = deal(state, state.round + 1);
  return { state: next, events: [{ kind: 'round', round: next.round }] };
}

/* ------------------------------------------------------------------- tick */

/**
 * Four things and no more: expire offers, end the reveal, harvest for whoever
 * qualifies when the room was set up that way, and let one bot act.
 *
 * Bots live here rather than in whichever driver is attached because the gate
 * they wait on is a field of State, and State is opaque to a room — see
 * `../../../docs/pit/specs/session-2-bots-and-the-local-driver.md` §2. A driver
 * therefore has nothing bot-shaped in it and the local driver and the Durable
 * Object cannot diverge over bot timing.
 *
 * Returns the state it was given when nothing happened, which is how a driver
 * knows not to push a view.
 * @returns {{ state: object, events: object[] }}
 */
export function tick(state, now) {
  // Returning the state it was given is already how a driver knows not to push
  // a view, so a paused room goes quiet with no driver change at all. A session
  // that has ended goes quiet the same way — there is no seat left worth taking
  // over once nothing can be played.
  if (state.pausedAt !== null) return { state, events: [] };
  if (state.phase === 'over' || state.phase === 'abandoned') return { state, events: [] };

  const events = [];
  let next = state;

  // Before the phase branches: idleness accrues during the reveal too.
  const stopped = takeovers(next, now);
  next = stopped.state;
  events.push(...stopped.events);

  if (next.abandon !== null && now - next.abandon.at >= ABANDON_TTL_MS) {
    next = { ...next, abandon: null };
  }

  if (next.phase === 'trading') {
    const expired = next.offers.filter((offer) => offer.expiresAt <= now);
    if (expired.length) {
      const hands = { ...next.hands };
      const logged = [];
      for (const offer of expired) {
        hands[offer.playerId] = moved(hands[offer.playerId], offer.commodity, offer.count);
        logged.push({ kind: 'expired', playerId: offer.playerId, count: offer.count });
      }
      next = {
        ...next,
        hands,
        offers: next.offers.filter((offer) => offer.expiresAt > now),
        history: [...next.history, ...logged],
      };
      events.push(...logged);
    }
    if (next.autoCorner) {
      const winner = next.seats.find((seat) => cornered(next.hands[seat.playerId]));
      if (winner) {
        const done = applyHarvest(next, winner.playerId, now);
        next = done.state;
        events.push(...done.events);
      }
    }
  } else if (next.phase === 'roundEnd' && now >= next.roundEndsAt) {
    const done = advance(next);
    next = done.state;
    events.push(...done.events);
  }

  if (next.phase === 'trading') {
    const done = bots(next, now);
    next = done.state;
    events.push(...done.events);
  }

  return { state: next, events };
}

/**
 * The seats whose players have stopped, and what happens to them.
 *
 * `init` is given no clock (`../../../docs/gameroom.md` §4), so an absent stamp
 * is seeded here rather than read as an infinitely old one — the same shape as
 * `botsReadyAt` below, and for the same reason: a table nobody has touched
 * trips the timer a minute after the first tick rather than on it.
 *
 * Bot seats are excluded by `isBot` rather than by trusting bots to stamp
 * themselves. A bot cannot be absent and this timer should not become a
 * statement about bot scheduling.
 */
function takeovers(state, now) {
  const idleSince = { ...state.idleSince };
  const takenOver = [...state.takenOver];
  const forfeit = [...state.forfeit];
  const events = [];
  let changed = false;

  for (const seat of state.seats) {
    if (seat.isBot) continue;
    const id = seat.playerId;
    if (idleSince[id] === undefined) { idleSince[id] = now; changed = true; continue; }
    if (takenOver.includes(id)) continue;
    if (now - idleSince[id] < IDLE_TAKEOVER_MS) continue;
    takenOver.push(id);
    if (!forfeit.includes(id)) forfeit.push(id);
    events.push({ kind: 'takeover', playerId: id });
    changed = true;
  }

  if (!changed) return { state, events };
  return { state: { ...state, idleSince, takenOver, forfeit }, events };
}

/**
 * The stream a bot draws from, taken out of state because tick is pure and is
 * given no rng. `botSeq` is session-long and never reset: resetting it per
 * round would hand two rounds the same stream.
 */
function botRng(state, seq) {
  return mulberry32((state.seed ^ Math.imul(state.round, ROUND_STRIDE) ^ Math.imul(seq + 1, BOT_STRIDE)) | 0);
}

/**
 * The view a bot gets: the seat's own view with the blocks nobody has had time
 * to look at yet taken out of it.
 *
 * Everyone gets first refusal on a new offer for `botNotice(level)`, and at a
 * table of bots that means the human does. Without it the board is unplayable
 * from a phone: a bot decides on the next tick, so a block posted between two
 * ticks can be gone 500ms later, before the person it landed in front of has
 * found a matching block of their own to press.
 *
 * Done here rather than in `bot.js` because it needs `now` and `bot.js` has no
 * clock and must not grow one — the whole of
 * `../../../docs/pit/specs/session-2-bots-and-the-local-driver.md` §3 is that
 * nothing about the board or the clock reaches a bot's latency. Filtering the view it is
 * handed leaves that alone: the bot still decides purely, out of a smaller
 * board. Its own offer stays visible, because withdrawing one it has already
 * posted is not a race with anybody.
 *
 * @param {object} state
 * @param {string} botId
 * @param {string} level
 * @param {number} now
 * @returns {object} a view, as `view()` builds it
 */
function noticed(state, botId, level, now) {
  const seen = view(state, botId);
  const notice = botNotice(level);
  const fresh = new Set(
    state.offers.filter((offer) => offer.playerId !== botId && now - offer.postedAt < notice)
      .map((offer) => offer.id),
  );
  if (!fresh.size) return seen;
  return { ...seen, offers: seen.offers.filter((offer) => !fresh.has(offer.id)) };
}

/**
 * At most one bot acts per tick. When several gates are open the oldest goes
 * and the rest wait: a backgrounded phone comes back with every gate open and
 * would otherwise fire four actions into one frame, the client gets one change
 * per view push, and a Durable Object's work per alarm stays bounded.
 */
function bots(state, now) {
  // A taken-over seat is driven from here like any other, which is what makes
  // the caretaker inherit the gating, the one-per-tick rule and the substreams
  // with no second code path.
  const seated = state.seats.filter((seat) => seat.isBot || state.takenOver.includes(seat.playerId));
  if (!seated.length) return { state, events: [] };
  const levelOf = (seat) => (seat.isBot ? seat.botLevel : CARETAKER_LEVEL);

  const readyAt = { ...state.botsReadyAt };
  let seq = state.botSeq;
  let changed = false;

  // deal() clears the gates, and an absent gate is not an open one: the first
  // tick of a round seeds them, or the round would open with a flurry.
  for (const seat of seated) {
    if (readyAt[seat.playerId] === undefined) {
      readyAt[seat.playerId] = now + botDelay(levelOf(seat), botRng(state, seq++), seated.length);
      changed = true;
    }
  }

  const due = seated
    .filter((seat) => readyAt[seat.playerId] <= now)
    .sort((a, b) => readyAt[a.playerId] - readyAt[b.playerId]);

  let next = state;
  const events = [];
  if (due.length) {
    const seat = due[0];
    // The delay is drawn first and from its own substream, so how long a bot
    // waits cannot depend on how many draws its decision took — the board must
    // not be able to reach the clock even through the stream position.
    readyAt[seat.playerId] = now + botDelay(levelOf(seat), botRng(state, seq++), seated.length);
    const action = botAction(noticed(state, seat.playerId, levelOf(seat), now), levelOf(seat), botRng(state, seq++));
    changed = true;
    if (action && validate(state, seat.playerId, action).ok) {
      // `dispatch`, not `apply`: a caretaker acting on a seat must not stamp it
      // present, or the seat would reclaim itself on the bot's first move.
      const done = dispatch(state, seat.playerId, action, now);
      next = done.state;
      events.push(...done.events);
    }
  }

  if (!changed) return { state, events };
  return { state: { ...next, botsReadyAt: readyAt, botSeq: seq }, events };
}

/* ------------------------------------------------------------------- view */

/**
 * The confidentiality boundary, and the one function in Pit that a bug in is
 * fatal to the game. It is also what a bot sees, so a bot cannot cheat by
 * construction rather than by intent.
 *
 * Everything a viewer is allowed to know is assembled here from scratch. There
 * is no filtered copy of state and no deletion of private fields — a view is
 * built out of public counts plus one player's own hand, so a field added to
 * State in a later session cannot leak by being forgotten about here.
 *
 * @param {object} state
 * @param {string} viewer
 * @returns {object}
 */
export function view(state, viewer) {
  const hand = { ...(state.hands[viewer] ?? {}) };
  const mine = liveOffer(state, viewer);
  const revealed = state.phase !== 'trading';

  const out = {
    round: state.round,
    phase: state.phase,
    target: state.target,
    // Absolute, like offer.expiresAt and for the same reason: view() is given
    // no `now` and must not be, so both countdowns on the screen are a CSS
    // animation whose duration the client works out once.
    pausedAt: state.pausedAt,
    abandon: state.abandon === null ? null : { ...state.abandon },
    commodities: [...state.commodities],
    values: { ...state.values },
    you: {
      playerId: viewer,
      hand,
      canHarvest: state.phase === 'trading' && cornered(hand) !== null,
      ready: state.ready.includes(viewer),
    },
    seats: state.seats.map((seat) => ({
      playerId: seat.playerId,
      name: seat.name,
      isBot: seat.isBot,
      // Public: cards are visible in a hand at a table, and a player who has
      // offered three away is visibly holding six.
      cards: handSize(state.hands[seat.playerId] ?? {}),
      score: state.scores[seat.playerId] ?? 0,
      ready: state.ready.includes(seat.playerId),
      idleSince: state.idleSince[seat.playerId] ?? null,
      // The deadline rather than the duration, for the same reason
      // `offer.expiresAt` is: view() is given no `now`, and a client that had
      // to be told IDLE_TAKEOVER_MS to work this out would be a client with a
      // rules constant written down in it. Null for a bot, which cannot be
      // absent and has no clock running on it.
      takeoverAt: seat.isBot || state.idleSince[seat.playerId] === undefined
        ? null
        : state.idleSince[seat.playerId] + IDLE_TAKEOVER_MS,
      takenOver: state.takenOver.includes(seat.playerId),
      forfeited: state.forfeit.includes(seat.playerId),
    })),
    offers: state.offers.map((offer) => ({
      id: offer.id,
      playerId: offer.playerId,
      count: offer.count,
      expiresAt: offer.expiresAt,
      mine: offer.playerId === viewer,
      // The greying rule, computed once on this side of the boundary rather
      // than three times in the client.
      matchable: Object.keys(hand).some((c) => hand[c] >= offer.count),
    })),
    history: state.history.map((event) => ({ ...event })),
  };

  // Your own offer, so its commodity is yours to see.
  if (mine) out.you.offer = { id: mine.id, count: mine.count, commodity: mine.commodity };

  if (revealed && state.harvest) out.harvest = { ...state.harvest };
  if (revealed) {
    out.reveal = {};
    for (const seat of state.seats) out.reveal[seat.playerId] = { ...(state.hands[seat.playerId] ?? {}) };
  }
  return out;
}

/* ------------------------------------------------------------- isComplete */

/**
 * Null while the session is running; afterwards every seat with its score and
 * its rank, ties sharing a rank. The input to the play record in session 4, and
 * it knows nothing about D1.
 * @returns {null | { game: string, target: number, seats: object[] }}
 */
export function isComplete(state) {
  if (state.phase !== 'over') return null;
  const ordered = [...state.seats].sort((a, b) => state.scores[b.playerId] - state.scores[a.playerId]);
  let rank = 0;
  let previous = null;
  const seats = ordered.map((seat, index) => {
    const score = state.scores[seat.playerId];
    if (score !== previous) { rank = index + 1; previous = score; }
    return { playerId: seat.playerId, name: seat.name, isBot: seat.isBot, score, rank };
  });
  return { game: id, target: state.target, rounds: state.round, seats };
}

/** The whole interface in one object, for a room that takes rules as a value. */
export const pitRules = {
  id, minPlayers, maxPlayers, supportsBots, defaultConfig,
  tickIntervalMs, init, validate, apply, view, tick, isComplete,
};
