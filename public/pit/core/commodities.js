// The nine, and the three numbers the game is sized by.
//
// This is the only module under `public/pit/` that contains the cards in a
// hand, the largest block that may be offered, or a point value. Little-kid
// mode (`../../../docs/pit/design.md` §6) changes all three, and it changes
// them here — a test greps the rest of the tree to keep that true.
//
// The tint lives beside the name rather than in CSS because the client needs it
// in JavaScript to colour a count badge, and one source beats two that drift.

import { shuffled } from './rng.js';

export const HAND = 9;          // cards per commodity, and cards per player
export const MAX_OFFER = 4;     // largest block that may be offered
export const BASE_VALUE = 55;   // the cheapest commodity in play
export const VALUE_STEP = 5;

// Keyed by the basename of its art. `art/fruit/<key>.webp` and
// `art/cards/<key>.webp` resolve with no mapping table in between.
//
// `name` is what a player is ever shown; the commodities are the nine virtues.
// `fruit` names what the picture on that card is, which the art was drawn from
// and which the exclusions in §2.1 are reasoned about — it is never a label.
export const COMMODITIES = {
  love: { name: 'Love', fruit: 'Apple', tint: '#c31412' },
  joy: { name: 'Joy', fruit: 'Blackberry', tint: '#498cde' },
  peace: { name: 'Peace', fruit: 'Kiwi', tint: '#9ec841' },
  patience: { name: 'Patience', fruit: 'Orange', tint: '#ed6600' },
  kindness: { name: 'Kindness', fruit: 'Strawberry', tint: '#e94679' },
  goodness: { name: 'Goodness', fruit: 'Blueberry', tint: '#823ea0' },
  faithfulness: { name: 'Faithfulness', fruit: 'Banana', tint: '#f4c513' },
  gentleness: { name: 'Gentleness', fruit: 'Grapes', tint: '#c39de7' },
  selfcontrol: { name: 'Self-Control', fruit: 'Pineapple', tint: '#2ed6d9' },
};

/** In verse order, which is display order and nothing else. */
export const COMMODITY_KEYS = Object.keys(COMMODITIES);

// Pairs that are not safely distinguishable at the icon sizes the client uses,
// per `../../../docs/pit/design.md` §2.1. They never deal together while a
// conflict-free set of the required size exists.
export const EXCLUSIONS = [
  ['goodness', 'gentleness'],   // two purple clusters
  ['goodness', 'joy'],          // two dark berry clusters
  ['love', 'kindness'],         // two red rounds
];

/**
 * @param {string} a
 * @param {string} b
 * @returns {boolean}
 */
export function excluded(a, b) {
  return EXCLUSIONS.some(([x, y]) => (x === a && y === b) || (x === b && y === a));
}

/**
 * The largest set with no excluded pair in it, found by inspection rather than
 * written down, so that editing EXCLUSIONS cannot leave a stale number behind.
 * With the three pairs above it is seven: taking goodness costs both other
 * berries, so the best sets leave it out and keep one of love/kindness.
 * @returns {number}
 */
function largestConflictFreeSize() {
  let best = 0;
  for (let mask = 0; mask < (1 << COMMODITY_KEYS.length); mask++) {
    const set = COMMODITY_KEYS.filter((_, i) => mask & (1 << i));
    if (set.length <= best) continue;
    const clean = set.every((a, i) => set.slice(i + 1).every((b) => !excluded(a, b)));
    if (clean) best = set.length;
  }
  return best;
}

/** Seat counts up to this can be dealt without a lookalike pair. */
export const EXCLUSION_FREE_LIMIT = largestConflictFreeSize();

// Belt and braces, not the mechanism: a greedy pass from a uniform shuffle
// reaches the limit often enough that this loop is not a performance question
// at any table this family sits.
const DRAW_ATTEMPTS = 64;

/**
 * The commodities in play this session — one per seat, drawn at random so that
 * every card gets used and no fruit is permanently the valuable one.
 *
 * The returned order is value order, cheapest first, so "index 0 is the cheap
 * one" is true by construction and no caller has to sort.
 *
 * @param {() => number} rng
 * @param {number} seats
 * @returns {string[]}
 */
export function drawCommodities(rng, seats) {
  if (!Number.isInteger(seats) || seats < 1 || seats > COMMODITY_KEYS.length) {
    throw new RangeError(`cannot draw ${seats} commodities from ${COMMODITY_KEYS.length}`);
  }
  let picked = null;
  if (seats <= EXCLUSION_FREE_LIMIT) {
    for (let attempt = 0; attempt < DRAW_ATTEMPTS && picked === null; attempt++) {
      const taken = [];
      for (const key of shuffled(rng, COMMODITY_KEYS)) {
        if (taken.length === seats) break;
        if (taken.some((held) => excluded(held, key))) continue;
        taken.push(key);
      }
      if (taken.length === seats) picked = taken;
    }
  }
  // Above the limit the constraint is unsatisfiable and is dropped by design;
  // below it, an exhausted draw takes the shuffle as it comes rather than
  // failing to deal a game.
  if (picked === null) picked = shuffled(rng, COMMODITY_KEYS).slice(0, seats);
  return shuffled(rng, picked);
}

/**
 * Point values by rank within the drawn set. Values differ, which is what makes
 * which commodity you chase a decision rather than a readout of what you were
 * dealt; the cheap one is the reachable one.
 * @param {string[]} commodities in value order
 * @returns {{ [c: string]: number }}
 */
export function valuesFor(commodities) {
  const values = {};
  commodities.forEach((c, index) => { values[c] = BASE_VALUE + index * VALUE_STEP; });
  return values;
}
