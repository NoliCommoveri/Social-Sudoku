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

export const defaultConfig = {
  target: 300,        // five or six rounds, which is one sitting
  autoCorner: false,  // design §2.4: missing your own win is the tension
};

// Rounds deal from the session seed offset by the round number, so a round is
// reproducible on its own and the deal does not depend on how much trading
// happened in the one before it.
const ROUND_STRIDE = 0x9e3779b1;

const OK = Object.freeze({ ok: true });
const refuse = (reason) => ({ ok: false, reason });

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
    ready: [],
    roundEndsAt: 0,
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
  switch (action.type) {
    case 'offer': return applyOffer(state, actor, action, now);
    case 'withdraw': return applyWithdraw(state, actor);
    case 'accept': return applyAccept(state, actor, action);
    case 'harvest': return applyHarvest(state, actor, now);
    case 'ready': return applyReady(state, actor);
    case 'disconnect': return liveOffer(state, actor)
      ? applyWithdraw(state, actor)
      : { state, events: [] };
    default: throw new Error(`unapplied action ${action.type}`);
  }
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
  const value = state.values[commodity];

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
      harvest: { playerId: actor, commodity, value },
      roundEndsAt: now + REVEAL_BACKSTOP_MS,
      ready: [],
    },
    events: [{ kind: 'harvest', playerId: actor }],
  };
}

function applyReady(state, actor) {
  const ready = [...state.ready, actor];
  const waiting = state.seats.some((seat) => !seat.isBot && !ready.includes(seat.playerId));
  const next = { ...state, ready };
  return waiting ? { state: next, events: [] } : advance(next);
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
 * Three things and no more: expire offers, end the reveal, and harvest for
 * whoever qualifies when the room was set up that way. Bot gating is the fourth
 * and arrives in session 2.
 * @returns {{ state: object, events: object[] }}
 */
export function tick(state, now) {
  const events = [];
  let next = state;

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

  return { state: next, events };
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
