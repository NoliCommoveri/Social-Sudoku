// Fill, count solutions, carve. One search backs all three: MRV cell ordering
// over incrementally maintained candidate masks, with the value order shuffled
// when an rng is supplied and left in index order when it is not.
//
// `deal` adds a fourth step, `ease`, which lives in openness.js and guarantees
// the openness floor on the rare carve that comes out closed.

import { mulberry32, shuffled } from './rng.js';
import { popcount, valuesIn, seedCandidates } from './candidates.js';
import { ease } from './openness.js';

// Places `value` in `cell`, clearing its bit from every empty peer that still
// carries it. `trail` collects those peers so the move can be taken back.
function assign(geom, values, cands, cell, value, trail) {
  values[cell] = value;
  cands[cell] = 0;
  const bit = 1 << (value - 1);
  for (const peer of geom.peersOf[cell]) {
    if (values[peer] === 0 && (cands[peer] & bit) !== 0) {
      cands[peer] &= ~bit;
      trail.push(peer);
    }
  }
}

function unassign(geom, values, cands, cell, prevMask, value, trail) {
  const bit = 1 << (value - 1);
  for (const peer of trail) cands[peer] |= bit;
  values[cell] = 0;
  cands[cell] = prevMask;
}

/**
 * Counts solutions of a partially filled board, stopping at `cap`.
 *
 * When it returns because the cap was reached, `values` is left holding the
 * last solution rather than being unwound — which is what lets fillComplete
 * run this with cap 1 and keep the board.
 */
function search(geom, values, cands, rng, cap) {
  let best = -1;
  let bestCount = geom.n + 1;
  for (let cell = 0; cell < geom.cellCount; cell++) {
    if (values[cell] !== 0) continue;
    const count = popcount(cands[cell]);
    if (count < bestCount) {
      bestCount = count;
      best = cell;
      if (count <= 1) break;
    }
  }
  if (best === -1) return 1;
  if (bestCount === 0) return 0;

  const order = rng ? shuffled(rng, valuesIn(cands[best])) : valuesIn(cands[best]);
  let total = 0;
  for (const value of order) {
    const prevMask = cands[best];
    const trail = [];
    assign(geom, values, cands, best, value, trail);
    total += search(geom, values, cands, rng, cap - total);
    if (total >= cap) return total;
    unassign(geom, values, cands, best, prevMask, value, trail);
  }
  return total;
}

/**
 * A complete valid grid.
 * @param {object} geom
 * @param {() => number} rng
 * @returns {Uint8Array}
 */
export function fillComplete(geom, rng) {
  const values = new Uint8Array(geom.cellCount);
  const cands = new Uint16Array(geom.cellCount).fill(geom.ALL);
  if (search(geom, values, cands, rng, 1) !== 1) {
    throw new Error('fillComplete found no solution for an empty grid');
  }
  return values;
}

/**
 * How many ways the board completes, counted no further than `cap`.
 * Every uniqueness check in this project passes cap 2 — nobody needs the real
 * count, only "is it more than one".
 *
 * @param {object} geom
 * @param {Uint8Array} values
 * @param {number} [cap]
 * @returns {number}
 */
export function countSolutions(geom, values, cap = 2) {
  const work = Uint8Array.from(values);
  const cands = new Uint16Array(geom.cellCount);
  if (!seedCandidates(geom, work, cands)) return 0;
  return search(geom, work, cands, null, cap);
}

/**
 * Removes clues from a complete grid while the remainder stays uniquely
 * solvable, stopping once `keep` clues are left. One pass in shuffled order.
 *
 * `keep` is the difficulty. A `keep` of 0 asks for everything removable to be
 * removed, which gives a minimal clue set with respect to that order — the
 * hardest puzzle this solution grid can make, and not what the app deals. Any
 * higher `keep` is hit exactly: clues come off one at a time and the pass ends
 * the moment the count reaches it.
 *
 * One pass suffices, and a second would find nothing. If removing a cell from
 * this board breaks uniqueness it also breaks it on every board further along
 * the pass, because those hold fewer clues and a subset never has fewer
 * solutions. So a cell refused once is refused forever, and the only way the
 * pass ends above `keep` is that the board went minimal first — which at every
 * size here happens well below the clue counts `SIZES` asks for.
 *
 * @param {object} geom
 * @param {Uint8Array} solution
 * @param {() => number} rng
 * @param {number} [keep] clues to stop at; 0 removes everything removable
 * @returns {Uint8Array}
 */
export function carve(geom, solution, rng, keep = 0) {
  const puzzle = Uint8Array.from(solution);
  let clues = geom.cellCount;
  const cells = new Array(geom.cellCount);
  for (let cell = 0; cell < geom.cellCount; cell++) cells[cell] = cell;
  for (const cell of shuffled(rng, cells)) {
    if (clues <= keep) break;
    const value = puzzle[cell];
    puzzle[cell] = 0;
    if (countSolutions(geom, puzzle, 2) !== 1) puzzle[cell] = value;
    else clues--;
  }
  return puzzle;
}

/**
 * A whole puzzle from one seed at one difficulty. Deterministic: the same seed,
 * size and tier always give the same givens and the same solution.
 *
 * Difficulty is `tier.clues`, and `carve` delivers it exactly. `ease` then adds
 * clues back only if the carve came out closed — a board singles cannot finish,
 * or one with a round offering fewer than `tier.openness` cells. At the clue
 * counts `SIZES` asks for that is rare, so the dealt clue count is the tier's
 * clue count on almost every deal and a little above it otherwise. Erring
 * upwards is erring easy, which is the right direction to err in.
 *
 * The clue set is a superset of a uniquely solvable one and agrees with
 * `solution` everywhere, so it is uniquely solvable whatever `ease` added.
 *
 * @param {object} geom
 * @param {number} seed
 * @param {{ clues: number, openness: number }} tier
 * @returns {{ seed: number, solution: Uint8Array, givens: Uint8Array }}
 */
export function deal(geom, seed, tier) {
  const rng = mulberry32(seed);
  const solution = fillComplete(geom, rng);
  const base = carve(geom, solution, rng, tier.clues);
  const givens = ease(geom, solution, base, rng, tier.openness);
  return { seed, solution, givens };
}
