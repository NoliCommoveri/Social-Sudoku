// The only place grid dimensions are written down, and the only place a
// difficulty is given a number. Every other module in core/ derives its numbers
// from a geometry built out of one of these, or from a tier looked up in one.

// Difficulty is clue count (design 4.3). `clues` is how many givens the tier
// deals and it is hit exactly: `carve` stops removing there rather than
// reducing to the minimal set that keeps the puzzle unique. Fewer clues means
// more blanks to fill and fewer cells findable at any moment, which is the same
// thing a person means by "harder".
//
// `openness` is the floor under that — the fewest cells any round of the puzzle
// may offer (design 4.3, "floor"). At these clue counts a carve clears it
// unaided almost every time, so it is a guarantee rather than a lever: it
// catches the occasional deal that closes down, and `ease` adds clues back
// until it does not.
//
// The numbers are measured, not guessed. At 9x9 the easy tier leaves 31 cells
// to fill with around 22 findable at any moment — two children, ten minutes,
// never stuck. The hard tier sits just above the point where singles stop
// being enough, which is where a puzzle stops being fun and starts being work.
export const SIZES = {
  4: {
    n: 4, boxW: 2, boxH: 2,
    tiers: {
      easy: { clues: 9, openness: 4 },
      medium: { clues: 7, openness: 3 },
      hard: { clues: 5, openness: 2 },
    },
  },
  6: {
    n: 6, boxW: 3, boxH: 2,
    tiers: {
      easy: { clues: 20, openness: 8 },
      medium: { clues: 16, openness: 5 },
      hard: { clues: 12, openness: 3 },
    },
  },
  9: {
    n: 9, boxW: 3, boxH: 3,
    tiers: {
      easy: { clues: 50, openness: 10 },
      medium: { clues: 40, openness: 6 },
      hard: { clues: 32, openness: 4 },
    },
  },
};

// Hardest last. The order the picker draws them in.
export const TIER_IDS = ['easy', 'medium', 'hard'];

export const TIER_LABELS = { easy: 'Easy', medium: 'Medium', hard: 'Hard' };

// The size dealt when no size preference has been stored yet.
export const DEFAULT_SIZE_KEY = 9;

// Easy, not medium. The players this is for are 11 and 12, and the one who
// finds it too easy has a button to press.
export const DEFAULT_TIER_ID = 'easy';

export const SIZE_KEYS = Object.keys(SIZES).map(Number);

/**
 * The tier a size deals under a difficulty id, or the size's easiest tier if
 * the id is not one this project knows. Callers hold ids that came out of
 * storage, and an unrecognised one must deal a playable board rather than
 * throw on a page that has no other way to report it.
 *
 * @param {number} sizeKey
 * @param {string} tierId
 * @returns {{ clues: number, openness: number }}
 */
export function tierFor(sizeKey, tierId) {
  const { tiers } = SIZES[sizeKey];
  return tiers[tierId] ?? tiers[DEFAULT_TIER_ID];
}
