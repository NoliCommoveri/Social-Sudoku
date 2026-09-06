// What a bot does with a turn, and how long it waits before taking one.
//
// A bot sees a `view` and nothing else — the same one a human seat gets, from
// `rules.js` `view()`. This file imports `commodities.js` and nothing more; in
// particular it does not import `rules.js`, which is what makes "a bot cannot
// reach State" mechanical rather than intended. A grep in
// `../../../test/pit-core-purity.test.js` asserts it.
//
// Pure, like the rest of `core/`: no clock, no Math.random(). The rng arrives
// as an argument and `tick` draws it out of state.

import { HAND, MAX_OFFER } from './commodities.js';

/**
 * Difficulty is a restriction on what a bot reads, not a handicap applied to
 * what it decides — `../../../docs/pit/design.md` §3.2. `recall` is how many
 * of the most recent public events the bot may look at — the window of
 * `../../../docs/pit/specs/session-2-bots-and-the-local-driver.md` §3. An easy
 * bot sees none, so it plays the board in front of it and cannot compute
 * pressure at all.
 */
const LEVELS = {
  easy: { recall: 0, minDelay: 1600, maxDelay: 3200, noise: 0.25 },
  normal: { recall: 8, minDelay: 1000, maxDelay: 2200, noise: 0.12 },
  hard: { recall: 24, minDelay: 800, maxDelay: 1600, noise: 0.05 },
};

export const BOT_LEVELS = Object.keys(LEVELS);

/** A typo in a seat list must not crash a game. */
export const DEFAULT_LEVEL = 'normal';

/** @param {string} [level] @returns {{ recall: number, minDelay: number, maxDelay: number, noise: number }} */
function settings(level) {
  return LEVELS[level] ?? LEVELS[DEFAULT_LEVEL];
}

/**
 * How long this bot waits before its next turn.
 *
 * The signature is the guarantee: it takes the level and the rng and nothing
 * else, so latency cannot correlate with how good the board is. A bot that
 * hesitated on bad offers and pounced on good ones would be read as a tell
 * within one session, and the only way to be sure it does not is to make the
 * correlation unexpressible. `tick` draws this from its own substream for the
 * same reason.
 *
 * @param {string} [level]
 * @param {() => number} rng
 * @returns {number} milliseconds
 */
export function botDelay(level, rng) {
  const { minDelay, maxDelay } = settings(level);
  return minDelay + Math.floor(rng() * (maxDelay - minDelay + 1));
}

/* ------------------------------------------------------------------ hashing */

// FNV-1a over the parts joined. Used where a decision has to hold still across
// evaluations: a bot is a pure function of a view and has nowhere to remember
// what it decided last time, so anything that must not thrash is derived from
// values that do not change within a round.
function stableHash(...parts) {
  const text = parts.join('|');
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

/** The same hash as a float in [0, 1). */
function stableUnit(...parts) {
  return stableHash(...parts) / 0x100000000;
}

/* ------------------------------------------------------------------- target */

/** Roughly one bot in ten, for the length of a round. */
const CONTRARIAN_SHARE = 0.1;

/** A contrarian will not chase a pile this thin. */
const CONTRARIAN_MIN = 2;

/**
 * Whether this bot is playing against the run of its own hand this round.
 * Decided by the stable hash rather than the rng so it holds for the round
 * instead of flickering from one evaluation to the next.
 * @param {object} view
 * @returns {boolean}
 */
function isContrarian(view) {
  return stableUnit(view.you.playerId, view.round, 'contrarian') < CONTRARIAN_SHARE;
}

/**
 * The commodity this bot is chasing, or null when it holds nothing.
 *
 * Usually the commodity it holds most of. Ties break on a stable hash of
 * (playerId, round, commodity) and never on the injected rng, so the target
 * does not thrash between two equal holdings across evaluations — that is the
 * whole of the hysteresis `../../../docs/pit/design.md` §3.1 asks for.
 *
 * A contrarian takes the highest-value commodity it holds at least
 * CONTRARIAN_MIN of and keeps it whatever overtakes it, which is the same rule
 * from one evaluation to the next and so needs no memory either.
 *
 * Cards in escrow are not in the hand and so are not in the target. That is
 * deliberate: it is what makes the withdraw in `botAction` step 3 possible.
 *
 * @param {object} view
 * @returns {string | null}
 */
export function targetOf(view) {
  const hand = view.you.hand;
  const keys = Object.keys(hand);
  if (!keys.length) return null;

  const tiebreak = (c) => stableHash(view.you.playerId, view.round, c);

  if (isContrarian(view)) {
    const rich = keys.filter((c) => hand[c] >= CONTRARIAN_MIN);
    if (rich.length) {
      return rich.reduce((best, c) => {
        const better = view.values[c] - view.values[best];
        if (better !== 0) return better > 0 ? c : best;
        return tiebreak(c) > tiebreak(best) ? c : best;
      });
    }
  }

  return keys.reduce((best, c) => {
    const bigger = hand[c] - hand[best];
    if (bigger !== 0) return bigger > 0 ? c : best;
    return tiebreak(c) > tiebreak(best) ? c : best;
  });
}

/* ----------------------------------------------------------------- pressure */

// A count of 1 or 2 is fine-tuning near a corner; 3 or more is dumping bulk.
const SMALL_COUNT = 2;

// How close to a corner the bot has to be before it stops playing defence.
const ENDGAME_GAP = 2;

/**
 * Who in the remembered window has been trading small. Positive means more
 * small events than large ones, which is what a player closing on a corner
 * looks like from outside.
 * @param {object} view
 * @param {number} recall how many recent events this level may read
 * @returns {{ [playerId: string]: number }}
 */
function pressure(view, recall) {
  const scores = {};
  if (recall <= 0) return scores;
  const bump = (playerId, count) => {
    if (playerId === view.you.playerId) return;
    scores[playerId] = (scores[playerId] ?? 0) + (count <= SMALL_COUNT ? 1 : -1);
  };
  for (const event of view.history.slice(-recall)) {
    if (typeof event.count !== 'number') continue;
    if (event.playerId) bump(event.playerId, event.count);
    if (event.a) bump(event.a, event.count);
    if (event.b) bump(event.b, event.count);
  }
  return scores;
}

/** The seat trading smallest, or null when nobody stands out. Seat order breaks ties. */
function underPressure(view, recall) {
  const scores = pressure(view, recall);
  let worst = null;
  for (const seat of view.seats) {
    const score = scores[seat.playerId] ?? 0;
    if (score > 0 && (worst === null || score > scores[worst])) worst = seat.playerId;
  }
  return worst;
}

/* ------------------------------------------------------------------ actions */

/** Non-target commodities, largest block first, ties in the order the hand lists them. */
function dumpable(view, target) {
  const hand = view.you.hand;
  return Object.keys(hand)
    .filter((c) => c !== target)
    .sort((a, b) => hand[b] - hand[a]);
}

/** The largest single non-target block, which is what an accept is paid out of. */
function payFrom(view, target, count) {
  const hand = view.you.hand;
  const blocks = dumpable(view, target).filter((c) => hand[c] >= count);
  return blocks.length ? blocks[0] : null;
}

/** Every action this bot could legally take that also respects the target invariant. */
function alternatives(view, target) {
  const hand = view.you.hand;
  const out = [];
  if (view.you.offer) out.push({ type: 'withdraw' });
  for (const offer of view.offers) {
    if (offer.mine) continue;
    for (const commodity of dumpable(view, target)) {
      if (hand[commodity] >= offer.count) out.push({ type: 'accept', offerId: offer.id, commodity });
    }
  }
  if (!view.you.offer) {
    for (const commodity of dumpable(view, target)) {
      const most = Math.min(hand[commodity], MAX_OFFER);
      for (let count = 1; count <= most; count++) out.push({ type: 'offer', commodity, count });
    }
  }
  return out;
}

const same = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

/**
 * With probability `noise` the bot takes a random legal alternative to what it
 * chose, doing nothing included. One knob produces the occasional bad trade,
 * the occasional pass on a good offer and the occasional pointless target
 * switch that `../../../docs/pit/design.md` §3.2 asks for.
 *
 * The alternatives are legal *and* target-safe: noise perturbs preference and
 * never the invariant in §4.1 of the session spec, because a bot that dumps its
 * own corner reads as broken rather than as human.
 */
function perturb(view, target, chosen, level, rng) {
  const { noise } = settings(level);
  if (rng() >= noise) return chosen;
  const pool = [...alternatives(view, target), null].filter((option) => !same(option, chosen));
  if (!pool.length) return chosen;
  return pool[Math.floor(rng() * pool.length)];
}

/**
 * What this bot does with its turn, or null for nothing.
 *
 * Its only input about the game is a `view` — it is not a `State`, it cannot be
 * made into one, and this file has no import that would let it try.
 *
 * @param {object} view as returned by rules.view(state, botId)
 * @param {string} [level] 'easy' | 'normal' | 'hard'
 * @param {() => number} rng
 * @returns {object | null} an Action
 */
export function botAction(view, level, rng) {
  // A bot that misses its own corner reads as a bug. The tension
  // `../../../docs/pit/design.md` §2.4 is protecting is the human's, so this
  // outranks everything and noise does not touch it.
  if (view.you.canHarvest) return { type: 'harvest' };

  // Bots never send `ready`; `apply` waits only on human seats.
  if (view.phase !== 'trading') return null;

  const target = targetOf(view);
  return perturb(view, target, decide(view, target, level, rng), level, rng);
}

function decide(view, target, level, rng) {
  const hand = view.you.hand;

  // Trades made the offered commodity the largest holding, so the offer is now
  // giving away the corner it is chasing. Nothing else withdraws; expiry
  // clears the rest.
  if (view.you.offer && view.you.offer.commodity === target) return { type: 'withdraw' };

  const accept = bestAccept(view, target, level, rng);
  if (accept) return accept;

  if (!view.you.offer) {
    const blocks = dumpable(view, target);
    if (blocks.length) {
      // The largest block moves the most junk per trade, and it is also the
      // hardest for anyone to match — a real cost the noise pays occasionally
      // by posting a smaller one.
      const best = Math.min(hand[blocks[0]], MAX_OFFER);
      const tied = blocks.filter((c) => Math.min(hand[c], MAX_OFFER) === best);
      return { type: 'offer', commodity: tied[Math.floor(rng() * tied.length)], count: best };
    }
  }

  // A bot with nothing but its target sits still, which is correct: it is one
  // trade from a corner.
  return null;
}

/**
 * An offer of count K is takeable when the bot holds K or more of some single
 * non-target commodity, and it pays from its largest such block: a non-target
 * pile that big is a second corner it has decided not to chase, and it cannot
 * chase two. K unknown cards beat K cards it has already declined to want.
 */
function bestAccept(view, target, level, rng) {
  const { recall } = settings(level);
  const hand = view.you.hand;
  const closest = Math.max(0, ...Object.values(hand));
  // Within two of a corner nobody is playing defence any more.
  const endgame = closest >= HAND - ENDGAME_GAP;
  const cornering = endgame ? null : underPressure(view, recall);

  let best = null;
  for (const offer of view.offers) {
    if (offer.mine) continue;
    // Accepting a small offer from the seat trading smallest hands that seat a
    // matched block, which is exactly how it finishes. Easy bots see no
    // history and skip this read entirely.
    if (offer.playerId === cornering && offer.count <= SMALL_COUNT) continue;
    const commodity = payFrom(view, target, offer.count);
    if (!commodity) continue;
    if (best === null || offer.count > best.count) best = { count: offer.count, options: [] };
    if (offer.count === best.count) best.options.push({ type: 'accept', offerId: offer.id, commodity });
  }
  if (best === null) return null;
  return best.options[Math.floor(rng() * best.options.length)];
}
