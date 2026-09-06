// The tier table is data, and it is the only place difficulty is decided. A
// number typed wrong here deals the wrong puzzle at every size with nothing
// else to catch it, so its shape is checked mechanically.

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  SIZES, SIZE_KEYS, DEFAULT_SIZE_KEY,
  TIER_IDS, TIER_LABELS, DEFAULT_TIER_ID, tierFor,
} from '../public/src/core/sizes.js';

test('every size defines every tier, and no others', () => {
  for (const sizeKey of SIZE_KEYS) {
    assert.deepEqual(Object.keys(SIZES[sizeKey].tiers), TIER_IDS, `size ${sizeKey}`);
  }
});

test('every tier is labelled', () => {
  assert.deepEqual(Object.keys(TIER_LABELS).sort(), [...TIER_IDS].sort());
  for (const id of TIER_IDS) assert.ok(TIER_LABELS[id].length > 0, `${id} has no label`);
});

test('the defaults name things that exist', () => {
  assert.ok(SIZE_KEYS.includes(DEFAULT_SIZE_KEY));
  assert.ok(TIER_IDS.includes(DEFAULT_TIER_ID));
});

// TIER_IDS is drawn in order and read as a ramp. A table whose middle tier
// deals fewer clues than its hardest would put the buttons in a lie.
test('clue counts fall across the tiers, hardest last', () => {
  for (const sizeKey of SIZE_KEYS) {
    const counts = TIER_IDS.map((id) => SIZES[sizeKey].tiers[id].clues);
    const floors = TIER_IDS.map((id) => SIZES[sizeKey].tiers[id].openness);
    for (let i = 1; i < TIER_IDS.length; i++) {
      assert.ok(counts[i] < counts[i - 1], `size ${sizeKey}: ${TIER_IDS[i]} is not harder`);
      assert.ok(floors[i] <= floors[i - 1], `size ${sizeKey}: ${TIER_IDS[i]} is not tighter`);
    }
  }
});

test('every tier leaves a playable number of cells to fill', () => {
  for (const sizeKey of SIZE_KEYS) {
    const cellCount = sizeKey * sizeKey;
    for (const id of TIER_IDS) {
      const { clues, openness } = SIZES[sizeKey].tiers[id];
      assert.ok(clues > 0 && clues < cellCount, `size ${sizeKey} ${id}: ${clues} clues`);
      assert.ok(Number.isInteger(openness) && openness >= 1, `size ${sizeKey} ${id}: no floor`);
      assert.ok(openness <= cellCount - clues, `size ${sizeKey} ${id}: floor exceeds the blanks`);
    }
  }
});

// Ids reach this from localStorage, where anything can be written. A board is
// the only acceptable answer — the page has no way to report a thrown error.
test('tierFor falls back to the default tier on an unknown id', () => {
  for (const sizeKey of SIZE_KEYS) {
    const fallback = SIZES[sizeKey].tiers[DEFAULT_TIER_ID];
    assert.equal(tierFor(sizeKey, 'impossible'), fallback);
    assert.equal(tierFor(sizeKey, undefined), fallback);
    for (const id of TIER_IDS) {
      assert.equal(tierFor(sizeKey, id), SIZES[sizeKey].tiers[id]);
    }
  }
});
