// Seeded PRNG. Core never calls Math.random(): tests need determinism, and a
// round that went strangely can be replayed from its seed.
//
// This is a copy of `../../sudoku/core/rng.js`, not an import of it. Promoting
// it to a shared module means editing sudoku for the benefit of a game that did
// not exist when sudoku was written, and H2 in `../../../ROADMAP.md` is that
// adding a game must not require touching the ones already there. Revisit at
// game three, when there are two copies and a reason.

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
