// Seeded PRNG. Core never calls Math.random(): tests need determinism, and a
// bad puzzle can be reproduced from its seed when someone reports one.

/**
 * mulberry32 — small, fast, good enough for shuffling.
 * @param {number} seed
 * @returns {() => number} float in [0, 1)
 */
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function next() {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 0x100000000;
  };
}

/**
 * Fisher-Yates on a copy. Never mutates its input.
 * @template T
 * @param {() => number} rng
 * @param {ArrayLike<T>} arr
 * @returns {T[]}
 */
export function shuffled(rng, arr) {
  const out = Array.from(arr);
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const swap = out[i];
    out[i] = out[j];
    out[j] = swap;
  }
  return out;
}
