import test from 'node:test';
import assert from 'node:assert/strict';

import { SIZES, SIZE_KEYS, TIER_IDS, tierFor } from '../public/src/core/sizes.js';
import { makeGeometry } from '../public/src/core/grid.js';
import { mulberry32 } from '../public/src/core/rng.js';
import { fillComplete, countSolutions, carve, deal } from '../public/src/core/generator.js';
import { measureOpenness, ease } from '../public/src/core/openness.js';

const allSizes = Object.values(SIZES);
const DEAL_SEEDS = 60;

test('a complete grid is solved with no round to constrain it', () => {
  for (const size of allSizes) {
    const geom = makeGeometry(size);
    const values = fillComplete(geom, mulberry32(5));
    assert.deepEqual(measureOpenness(geom, values), { solved: true, floor: Infinity });
  }
});

test('a board with two peers sharing a value is not open at all', () => {
  const geom = makeGeometry(SIZES[4]);
  const values = new Uint8Array(geom.cellCount);
  values[0] = 1;
  values[1] = 1;
  assert.deepEqual(measureOpenness(geom, values), { solved: false, floor: 0 });
});

// The endgame exclusion. Two holes in different rows, columns and boxes are
// both forced by their row alone, so the single round fills the board: the
// count is low only because nothing is left, which is not the puzzle being
// tight. Without the exclusion every puzzle would fail its own floor.
test('a round that finishes the board does not constrain the floor', () => {
  const geom = makeGeometry(SIZES[4]);
  const values = fillComplete(geom, mulberry32(9));
  const holes = [0, geom.cellCount - geom.boxW - 1];
  for (const cell of holes) values[cell] = 0;
  assert.notEqual(geom.rowOf[holes[0]], geom.rowOf[holes[1]]);
  assert.notEqual(geom.colOf[holes[0]], geom.colOf[holes[1]]);
  assert.notEqual(geom.boxOf[holes[0]], geom.boxOf[holes[1]]);

  const measured = measureOpenness(geom, values);
  assert.equal(measured.solved, true);
  assert.equal(measured.floor, Infinity);
});

// Why `ease` still exists now that difficulty is clue count. A minimal carve is
// routinely a board singles cannot finish, so removing the floor and trusting
// the clue target would leave those deals unplayable. The tiers never ask for a
// minimal carve, which is why this uses `keep` 0 rather than a tier.
test('a minimal carve leaves 9x9 boards singles cannot finish', () => {
  const geom = makeGeometry(SIZES[9]);
  let stalled = 0;
  for (let seed = 1; seed <= DEAL_SEEDS; seed++) {
    const rng = mulberry32(seed);
    const solution = fillComplete(geom, rng);
    if (!measureOpenness(geom, carve(geom, solution, rng, 0)).solved) stalled++;
  }
  assert.ok(stalled > 0, 'every minimal 9x9 carve already solved by singles');
});

test('ease returns a superset of its base that agrees with the solution', () => {
  for (const size of allSizes) {
    const geom = makeGeometry(size);
    for (let seed = 1; seed <= DEAL_SEEDS; seed++) {
      const rng = mulberry32(seed);
      const solution = fillComplete(geom, rng);
      const base = carve(geom, solution, rng, 0);
      const eased = ease(geom, solution, base, rng, size.tiers.hard.openness);
      const where = `size ${size.n}, seed ${seed}`;

      for (let cell = 0; cell < geom.cellCount; cell++) {
        if (base[cell] !== 0) {
          assert.equal(eased[cell], base[cell], `${where}: cell ${cell} lost a base clue`);
        }
        if (eased[cell] !== 0) {
          assert.equal(eased[cell], solution[cell], `${where}: cell ${cell} disagrees`);
        }
      }
    }
  }
});

test('ease does not mutate the base or the solution it was given', () => {
  const geom = makeGeometry(SIZES[9]);
  const rng = mulberry32(21);
  const solution = fillComplete(geom, rng);
  const base = carve(geom, solution, rng, 0);
  const solutionBefore = Array.from(solution);
  const baseBefore = Array.from(base);
  ease(geom, solution, base, rng, SIZES[9].tiers.hard.openness);
  assert.deepEqual(Array.from(solution), solutionBefore);
  assert.deepEqual(Array.from(base), baseBefore);
});

// The whole point, stated as one assertion per size and difficulty: what the
// app deals is finishable with singles, never has a round below its tier's
// floor, and is still a puzzle rather than a filled grid.
test('every dealt puzzle meets its tier openness floor', () => {
  for (const sizeKey of SIZE_KEYS) {
    const geom = makeGeometry(SIZES[sizeKey]);
    for (const tierId of TIER_IDS) {
      const tier = tierFor(sizeKey, tierId);
      for (let seed = 1; seed <= DEAL_SEEDS; seed++) {
        const { givens, solution } = deal(geom, seed, tier);
        const where = `size ${sizeKey} ${tierId}, seed ${seed}`;
        const measured = measureOpenness(geom, givens);

        assert.equal(measured.solved, true, `${where} does not solve by singles`);
        assert.ok(
          measured.floor >= tier.openness,
          `${where} has a round of ${measured.floor}, floor is ${tier.openness}`,
        );
        assert.equal(countSolutions(geom, givens, 2), 1, `${where} is not unique`);

        let empty = 0;
        for (let cell = 0; cell < geom.cellCount; cell++) {
          if (givens[cell] === 0) empty++;
          else assert.equal(givens[cell], solution[cell], `${where}, cell ${cell} disagrees`);
        }
        assert.ok(empty > 0, `${where} was filled in completely`);
      }
    }
  }
});

// The measurement the tier table is built on, held in place. Difficulty has to
// be felt as difficulty: an easier tier must leave more of the board findable
// at any moment, not just more clues printed on it.
test('an easier tier leaves more of the board findable', () => {
  for (const sizeKey of SIZE_KEYS) {
    const geom = makeGeometry(SIZES[sizeKey]);
    const averages = TIER_IDS.map((tierId) => {
      let total = 0;
      for (let seed = 1; seed <= DEAL_SEEDS; seed++) {
        const { givens } = deal(geom, seed, tierFor(sizeKey, tierId));
        const { floor } = measureOpenness(geom, givens);
        total += floor === Infinity ? geom.cellCount : floor;
      }
      return total / DEAL_SEEDS;
    });
    for (let i = 1; i < averages.length; i++) {
      assert.ok(
        averages[i] < averages[i - 1],
        `size ${sizeKey}: ${TIER_IDS[i]} averages ${averages[i].toFixed(1)} findable, `
        + `${TIER_IDS[i - 1]} averages ${averages[i - 1].toFixed(1)}`,
      );
    }
  }
});

// A floor of 1 is the weakest one that means anything, and asking for it must
// not make ease add clues a stalled board did not need.
test('a higher floor never deals fewer clues than a lower one', () => {
  const geom = makeGeometry(SIZES[9]);
  const higher = SIZES[9].tiers.easy.openness;
  for (let seed = 1; seed <= 20; seed++) {
    const counts = [1, higher].map((floor) => {
      const rng = mulberry32(seed);
      const solution = fillComplete(geom, rng);
      const base = carve(geom, solution, rng, 0);
      const eased = ease(geom, solution, base, rng, floor);
      return eased.reduce((total, value) => total + (value === 0 ? 0 : 1), 0);
    });
    assert.ok(counts[1] >= counts[0], `seed ${seed}: floor ${higher} gave fewer clues`);
  }
});

// `ease` runs on every deal and is expected to do nothing on most of them. If
// that stops being true the clue targets are no longer what the app deals, and
// the tier labels have quietly drifted.
test('ease leaves most dealt boards alone at the tier clue counts', () => {
  const geom = makeGeometry(SIZES[9]);
  for (const tierId of TIER_IDS) {
    const tier = tierFor(9, tierId);
    let untouched = 0;
    for (let seed = 1; seed <= DEAL_SEEDS; seed++) {
      const { givens } = deal(geom, seed, tier);
      const clues = givens.reduce((total, value) => total + (value === 0 ? 0 : 1), 0);
      if (clues === tier.clues) untouched++;
    }
    assert.ok(
      untouched > DEAL_SEEDS / 2,
      `9x9 ${tierId}: ease had to add clues to ${DEAL_SEEDS - untouched} of ${DEAL_SEEDS} deals`,
    );
  }
});
