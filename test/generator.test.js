import test from 'node:test';
import assert from 'node:assert/strict';

import { SIZES, SIZE_KEYS, TIER_IDS, tierFor } from '../public/src/core/sizes.js';
import { makeGeometry } from '../public/src/core/grid.js';
import { mulberry32 } from '../public/src/core/rng.js';
import { fillComplete, countSolutions, carve, deal } from '../public/src/core/generator.js';

const allSizes = Object.values(SIZES);
const FILL_SEEDS = 200;
const CARVE_SEEDS = 100;

function assertCompleteAndValid(geom, values, context) {
  for (let cell = 0; cell < geom.cellCount; cell++) {
    assert.notEqual(values[cell], 0, `${context}: cell ${cell} empty`);
  }
  for (const unit of geom.units) {
    const seen = new Set([...unit].map((cell) => values[cell]));
    assert.equal(seen.size, geom.n, `${context}: unit is not a permutation`);
    for (const value of seen) {
      assert.ok(value >= 1 && value <= geom.n, `${context}: value ${value} out of range`);
    }
  }
}

test('fillComplete returns a valid complete grid', () => {
  for (const size of allSizes) {
    const geom = makeGeometry(size);
    for (let seed = 1; seed <= FILL_SEEDS; seed++) {
      const values = fillComplete(geom, mulberry32(seed));
      assertCompleteAndValid(geom, values, `size ${size.n}, seed ${seed}`);
    }
  }
});

test('fillComplete is deterministic per seed, and seeds differ', () => {
  const geom = makeGeometry(SIZES[9]);
  const first = fillComplete(geom, mulberry32(7));
  const again = fillComplete(geom, mulberry32(7));
  assert.deepEqual(Array.from(first), Array.from(again));

  const other = fillComplete(geom, mulberry32(8));
  assert.notDeepEqual(Array.from(first), Array.from(other));
});

test('countSolutions on a complete grid is 1', () => {
  for (const size of allSizes) {
    const geom = makeGeometry(size);
    const values = fillComplete(geom, mulberry32(3));
    assert.equal(countSolutions(geom, values, 2), 1);
  }
});

test('countSolutions on a complete grid with one cell emptied is 1', () => {
  for (const size of allSizes) {
    const geom = makeGeometry(size);
    const values = fillComplete(geom, mulberry32(11));
    for (const cell of [0, Math.floor(geom.cellCount / 2), geom.cellCount - 1]) {
      const holed = Uint8Array.from(values);
      holed[cell] = 0;
      assert.equal(countSolutions(geom, holed, 2), 1, `size ${geom.n}, cell ${cell}`);
    }
  }
});

test('an empty 4x4 grid has exactly 288 solutions', () => {
  const geom = makeGeometry(SIZES[4]);
  assert.equal(countSolutions(geom, new Uint8Array(geom.cellCount), Infinity), 288);
});

test('countSolutions stops at the cap', () => {
  const geom = makeGeometry(SIZES[4]);
  assert.equal(countSolutions(geom, new Uint8Array(geom.cellCount), 2), 2);
});

test('countSolutions on a board with two peers sharing a value is 0', () => {
  const geom = makeGeometry(SIZES[4]);
  const values = new Uint8Array(geom.cellCount);
  values[0] = 1;
  values[1] = 1;
  assert.equal(countSolutions(geom, values, 2), 0);
});

// Every size, not just 9x9. 4x4 is the hard case for the uniqueness check
// rather than the easy one: with only 288 valid grids a solution counter that
// is subtly wrong shows up here as a puzzle with two solutions.
test('carve output is uniquely solvable, and a subset of its solution', () => {
  for (const size of allSizes) {
    const geom = makeGeometry(size);
    for (let seed = 1; seed <= CARVE_SEEDS; seed++) {
      const rng = mulberry32(seed);
      const solution = fillComplete(geom, rng);
      const givens = carve(geom, solution, rng, 0);
      const where = `size ${size.n}, seed ${seed}`;

      assert.equal(countSolutions(geom, givens, 2), 1, `${where} is not unique`);
      for (let cell = 0; cell < geom.cellCount; cell++) {
        if (givens[cell] !== 0) {
          assert.equal(givens[cell], solution[cell], `${where}, cell ${cell} disagrees`);
        }
      }
      assert.ok(givens.some((value) => value === 0), `${where} removed nothing`);
    }
  }
});

test('carve does not mutate the solution it was given', () => {
  const geom = makeGeometry(SIZES[9]);
  const rng = mulberry32(42);
  const solution = fillComplete(geom, rng);
  const before = Array.from(solution);
  carve(geom, solution, rng, 0);
  assert.deepEqual(Array.from(solution), before);
});

// Difficulty is clue count, so `keep` is the whole of it and hitting it exactly
// is what makes a label mean something. A carve that lands near the target
// instead of on it is a tier that varies deal to deal, which is the thing this
// replaced.
test('carve stops at exactly the clue target it was given', () => {
  for (const sizeKey of SIZE_KEYS) {
    const geom = makeGeometry(SIZES[sizeKey]);
    for (const tierId of TIER_IDS) {
      const { clues: keep } = tierFor(sizeKey, tierId);
      for (let seed = 1; seed <= 20; seed++) {
        const rng = mulberry32(seed);
        const solution = fillComplete(geom, rng);
        const carved = carve(geom, solution, rng, keep);
        const clues = carved.reduce((count, value) => count + (value === 0 ? 0 : 1), 0);
        assert.equal(clues, keep, `size ${sizeKey} ${tierId}, seed ${seed}: ${clues} clues`);
        assert.equal(countSolutions(geom, carved, 2), 1, `size ${sizeKey} ${tierId} not unique`);
      }
    }
  }
});

// The floor under the previous test. Every tier target must sit above the point
// where a board goes minimal, or `carve` would run out of removable clues and
// return more than asked. If a future tier is set too low this fails here
// rather than silently dealing an easier puzzle than its label.
test('every tier target is reachable at its size', () => {
  for (const sizeKey of SIZE_KEYS) {
    const geom = makeGeometry(SIZES[sizeKey]);
    const hardest = tierFor(sizeKey, TIER_IDS.at(-1)).clues;
    for (let seed = 1; seed <= 20; seed++) {
      const rng = mulberry32(seed);
      const solution = fillComplete(geom, rng);
      const minimal = carve(geom, solution, rng, 0);
      const floor = minimal.reduce((count, value) => count + (value === 0 ? 0 : 1), 0);
      assert.ok(
        floor <= hardest,
        `size ${sizeKey}, seed ${seed}: minimal is ${floor} clues, hardest tier asks ${hardest}`,
      );
    }
  }
});

test('a harder tier never deals more clues than an easier one', () => {
  for (const sizeKey of SIZE_KEYS) {
    const geom = makeGeometry(SIZES[sizeKey]);
    for (let seed = 1; seed <= 20; seed++) {
      const counts = TIER_IDS.map((tierId) => {
        const { givens } = deal(geom, seed, tierFor(sizeKey, tierId));
        return givens.reduce((count, value) => count + (value === 0 ? 0 : 1), 0);
      });
      for (let i = 1; i < counts.length; i++) {
        assert.ok(
          counts[i] <= counts[i - 1],
          `size ${sizeKey}, seed ${seed}: ${TIER_IDS[i]} dealt ${counts[i]} clues, `
          + `${TIER_IDS[i - 1]} dealt ${counts[i - 1]}`,
        );
      }
    }
  }
});

test('deal is deterministic per seed and tier', () => {
  const geom = makeGeometry(SIZES[9]);
  const tier = tierFor(9, 'medium');
  const first = deal(geom, 12345, tier);
  const again = deal(geom, 12345, tier);
  assert.deepEqual(Array.from(first.givens), Array.from(again.givens));
  assert.deepEqual(Array.from(first.solution), Array.from(again.solution));
  assert.equal(countSolutions(geom, first.givens, 2), 1);
});

// One solution grid per seed whatever the difficulty, which is what design 4.3
// needs for two people to race the same deal at two tiers.
test('every tier of one seed shares a solution grid', () => {
  for (const sizeKey of SIZE_KEYS) {
    const geom = makeGeometry(SIZES[sizeKey]);
    for (let seed = 1; seed <= 10; seed++) {
      const solutions = TIER_IDS.map(
        (tierId) => Array.from(deal(geom, seed, tierFor(sizeKey, tierId)).solution),
      );
      for (const solution of solutions) {
        assert.deepEqual(solution, solutions[0], `size ${sizeKey}, seed ${seed}`);
      }
    }
  }
});
