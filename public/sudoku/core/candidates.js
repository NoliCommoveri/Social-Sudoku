// Candidate masks: one bitmask per cell holding the values that cell can still
// take. Two things in core/ need them — the generator's search, which uses them
// to prune, and the openness measure, which uses them to work out what a person
// could find. Neither owns them, so they live here.
//
// Bit v-1 set means value v is still allowed. A filled cell's mask is 0.

/**
 * @param {number} mask
 * @returns {number} how many values the mask allows
 */
export function popcount(mask) {
  let m = mask;
  let count = 0;
  while (m) {
    m &= m - 1;
    count++;
  }
  return count;
}

/**
 * @param {number} mask
 * @returns {number[]} the values the mask allows, ascending
 */
export function valuesIn(mask) {
  const out = [];
  let m = mask;
  while (m) {
    const low = m & -m;
    out.push(lowestValue(low));
    m ^= low;
  }
  return out;
}

/**
 * The smallest value a mask allows. Only meaningful on a non-zero mask.
 * @param {number} mask
 * @returns {number}
 */
export function lowestValue(mask) {
  return 31 - Math.clz32(mask & -mask) + 1;
}

/**
 * Fills `cands` from the values already on the board.
 *
 * @param {object} geom
 * @param {Uint8Array} values
 * @param {Uint16Array} cands written into
 * @returns {boolean} false if two peers already hold the same value, which is a
 *   board with no solutions at all
 */
export function seedCandidates(geom, values, cands) {
  cands.fill(geom.ALL);
  for (let cell = 0; cell < geom.cellCount; cell++) {
    const value = values[cell];
    if (value === 0) continue;
    const bit = 1 << (value - 1);
    cands[cell] = 0;
    for (const peer of geom.peersOf[cell]) {
      if (values[peer] === value) return false;
      cands[peer] &= ~bit;
    }
  }
  return true;
}
