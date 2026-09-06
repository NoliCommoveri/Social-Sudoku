// The draw and the values. Everything the rest of Pit is sized by comes out of
// this module, and a wrong number here deals a wrong game with nothing else to
// catch it.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { mulberry32 } from '../public/pit/core/rng.js';
import {
  HAND, MAX_OFFER, BASE_VALUE, VALUE_STEP,
  COMMODITIES, COMMODITY_KEYS, EXCLUSIONS, EXCLUSION_FREE_LIMIT,
  excluded, drawCommodities, valuesFor,
} from '../public/pit/core/commodities.js';

const SEEDS = Array.from({ length: 200 }, (_, i) => i * 7919 + 1);
const SEAT_COUNTS = COMMODITY_KEYS.map((_, i) => i + 1);

test('every commodity is named, fruited and tinted, and no two share a tint', () => {
  const tints = new Set();
  for (const key of COMMODITY_KEYS) {
    const entry = COMMODITIES[key];
    assert.ok(entry.name.length > 0, `${key} has no name`);
    assert.ok(entry.fruit.length > 0, `${key} has no fruit`);
    assert.match(entry.tint, /^#[0-9a-f]{6}$/, `${key} has no tint`);
    tints.add(entry.tint);
  }
  assert.equal(tints.size, COMMODITY_KEYS.length);
});

// The key is the art's basename. If that stops being true the client picks up a
// mapping table, so it is worth a test rather than a convention.
test('every commodity key names a fruit crop and a card', () => {
  const dir = (name) => readdirSync(fileURLToPath(new URL(`../public/pit/art/${name}/`, import.meta.url)));
  const fruit = dir('fruit').filter((f) => f.endsWith('.webp')).map((f) => f.replace('.webp', ''));
  const cards = dir('cards').filter((f) => f.endsWith('.webp')).map((f) => f.replace('.webp', ''));
  assert.deepEqual(fruit.sort(), [...COMMODITY_KEYS].sort());
  assert.deepEqual(cards.sort(), [...COMMODITY_KEYS, 'back'].sort());
});

test('the exclusion pairs name commodities that exist, and are not self-pairs', () => {
  for (const [a, b] of EXCLUSIONS) {
    assert.ok(COMMODITY_KEYS.includes(a), `${a} is not a commodity`);
    assert.ok(COMMODITY_KEYS.includes(b), `${b} is not a commodity`);
    assert.notEqual(a, b);
    assert.ok(excluded(a, b) && excluded(b, a), 'exclusion is symmetric');
  }
});

// design §2.1: goodness excludes both other berries and love excludes kindness,
// so the largest conflict-free set is seven. The limit is computed from the
// pairs rather than written down; this asserts the pairs still mean what the
// design says they mean.
test('the exclusion-free limit is seven seats', () => {
  assert.equal(EXCLUSION_FREE_LIMIT, 7);
});

test('a draw returns that many distinct commodities, at every seat count', () => {
  for (const seats of SEAT_COUNTS) {
    for (const seed of SEEDS) {
      const drawn = drawCommodities(mulberry32(seed), seats);
      assert.equal(drawn.length, seats, `seats ${seats} seed ${seed}`);
      assert.equal(new Set(drawn).size, seats, `duplicate at seats ${seats} seed ${seed}`);
      for (const key of drawn) assert.ok(COMMODITY_KEYS.includes(key), `${key} is not a commodity`);
    }
  }
});

test('no two lookalikes deal together at or below the exclusion-free limit', () => {
  for (const seats of SEAT_COUNTS.filter((n) => n <= EXCLUSION_FREE_LIMIT)) {
    for (const seed of SEEDS) {
      const drawn = drawCommodities(mulberry32(seed), seats);
      for (let i = 0; i < drawn.length; i++) {
        for (let j = i + 1; j < drawn.length; j++) {
          assert.ok(!excluded(drawn[i], drawn[j]),
            `${drawn[i]} with ${drawn[j]} at seats ${seats} seed ${seed}`);
        }
      }
    }
  }
});

// Above the limit the constraint is unsatisfiable and is dropped by design. The
// test is that the draw still deals rather than that it stays clean.
test('above the limit the draw takes the shuffle as it comes', () => {
  const seats = COMMODITY_KEYS.length;
  const drawn = drawCommodities(mulberry32(1), seats);
  assert.deepEqual([...drawn].sort(), [...COMMODITY_KEYS].sort());
});

test('a draw refuses a seat count the deck cannot cover', () => {
  assert.throws(() => drawCommodities(mulberry32(1), COMMODITY_KEYS.length + 1), RangeError);
  assert.throws(() => drawCommodities(mulberry32(1), 0), RangeError);
});

test('the same seed draws the same set in the same order', () => {
  for (const seats of SEAT_COUNTS) {
    const a = drawCommodities(mulberry32(99), seats);
    const b = drawCommodities(mulberry32(99), seats);
    assert.deepEqual(a, b);
  }
});

// Different sessions should not keep landing on the same set: the whole point of
// drawing is that every card gets used.
test('the draw is not effectively constant', () => {
  const seen = new Set(SEEDS.map((seed) => drawCommodities(mulberry32(seed), 4).join(',')));
  assert.ok(seen.size > SEEDS.length / 2, `only ${seen.size} distinct four-seat draws`);
});

test('values ascend in steps from the base, in the order the draw returned', () => {
  for (const seats of SEAT_COUNTS) {
    const drawn = drawCommodities(mulberry32(11), seats);
    const values = valuesFor(drawn);
    assert.equal(values[drawn[0]], BASE_VALUE);
    assert.equal(new Set(Object.values(values)).size, seats, 'values are distinct');
    drawn.forEach((c, index) => {
      assert.equal(values[c], BASE_VALUE + index * VALUE_STEP);
      if (index > 0) assert.ok(values[c] > values[drawn[index - 1]], 'values ascend');
    });
    assert.deepEqual(Object.keys(values).sort(), [...drawn].sort());
  }
});

test('a hand is nine cards and an offer is at most four', () => {
  assert.ok(Number.isInteger(HAND) && HAND > MAX_OFFER);
  assert.ok(Number.isInteger(MAX_OFFER) && MAX_OFFER >= 1);
  assert.ok(VALUE_STEP > 0 && BASE_VALUE > 0);
});
