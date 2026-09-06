// The built-in avatar set. Thirty inline SVG glyphs, no uploads, no R2, no
// image moderation problem with four children on the site
// (docs/identity-and-stats.md §3.1).
//
// Rules they are drawn to, because they are the reason the set is fixed:
//
// - **Readable at 32px.** Bold silhouettes, flat fills, no strokes thinner
//   than 2 units in a 48-unit box, no detail that survives only at full size.
//   The avatar is how a pre-reader finds their own row on a page they cannot
//   read, so a glyph that turns to mush in a play-log row has failed.
// - **One tint each, and no two alike.** Colour is half the identification.
//   Two foxes in different oranges would be a mistake; there is one fox.
// - **No theme dependency.** The tint is the fill and the details are one dark
//   ink that stays dark. A glyph sits on its own bright disc in both themes,
//   so nothing here reads `prefers-color-scheme`.
// - **Pure.** No DOM, no document, no window: `avatarSvg` returns a string.
//   That is what lets test/avatars.test.js import this file directly.
//
// The set is a fixed list rather than a directory of files because the seed
// (`worker/db/sql/seed_players.sql`) names keys from it, and a key that does
// not exist here is a player with no face. That is asserted in CI.

/** Detail ink. Dark in both themes, because it always sits on a tint. */
const INK = '#181c24';

/** The one pale tone: bellies, muzzles, panda, teeth. */
const PALE = '#fbf7ef';

/** @param {number} x @param {number} y @param {number} [r] @param {string} [fill] */
const dot = (x, y, r = 2.4, fill = INK) => `<circle cx="${x}" cy="${y}" r="${r}" fill="${fill}"/>`;

/** A pair of eyes, mirrored about the centre line. */
const eyes = (y, dx = 6, r = 2.4) => dot(24 - dx, y, r) + dot(24 + dx, y, r);

/** The head disc every four-legged glyph is built on. `currentColor` is the tint. */
const head = (cy = 27, r = 14) => `<circle cx="24" cy="${cy}" r="${r}" fill="currentColor"/>`;

/** Pointed ears, mirrored. `x` is the outer edge, `tip` the height above it. */
const earsPointed = (x = 10, tip = 7, inner = 21, base = 24) =>
  `<path d="M${x} ${tip} L${inner} ${tip + 11} L${x - 1} ${base} Z" fill="currentColor"/>` +
  `<path d="M${48 - x} ${tip} L${48 - inner} ${tip + 11} L${49 - x} ${base} Z" fill="currentColor"/>`;

/** Round ears, mirrored. */
const earsRound = (cx = 12, cy = 14, r = 6) =>
  `<circle cx="${cx}" cy="${cy}" r="${r}" fill="currentColor"/>` +
  `<circle cx="${48 - cx}" cy="${cy}" r="${r}" fill="currentColor"/>`;

/**
 * @typedef {{ key: string, label: string, tint: string, art: string }} Avatar
 */

/**
 * The set, in the order the picker draws it. Animals first because that is
 * what the 4- and 5-year-old reach for, then the things that are not animals.
 *
 * @type {Avatar[]}
 */
export const AVATARS = [
  {
    key: 'fox', label: 'Fox', tint: '#ff8b3d',
    art: earsPointed(9, 6) + head() +
      `<path d="M24 41c-5 0-9-4-9-8h18c0 4-4 8-9 8z" fill="${PALE}"/>` +
      eyes(25) + dot(24, 34, 2.8),
  },
  {
    key: 'cat', label: 'Cat', tint: '#b58cff',
    art: earsPointed(11, 8, 21, 23) + head() + eyes(25) +
      `<path d="M11 27h6m14 0h6" stroke="${INK}" stroke-width="2" stroke-linecap="round"/>` +
      `<path d="M24 31l-2.5-2h5z" fill="${INK}"/>` +
      `<path d="M20 34a4 4 0 0 0 4 2 4 4 0 0 0 4-2" stroke="${INK}" stroke-width="2" stroke-linecap="round" fill="none"/>`,
  },
  {
    key: 'dog', label: 'Dog', tint: '#c98a54',
    art: `<ellipse cx="7" cy="26" rx="6" ry="12" fill="currentColor"/>` +
      `<ellipse cx="41" cy="26" rx="6" ry="12" fill="currentColor"/>` +
      head(28, 13) +
      `<ellipse cx="24" cy="35" rx="8" ry="6" fill="${PALE}"/>` + eyes(26, 5.5, 2.4) +
      `<ellipse cx="24" cy="32" rx="3.4" ry="2.8" fill="${INK}"/>` +
      `<path d="M24 35v3" stroke="${INK}" stroke-width="2" stroke-linecap="round"/>`,
  },
  {
    key: 'bear', label: 'Bear', tint: '#8d6a4f',
    art: earsRound(11, 13, 6) + head() +
      `<ellipse cx="24" cy="33" rx="8" ry="6" fill="${PALE}"/>` + eyes(25, 6, 2.2) +
      `<ellipse cx="24" cy="31" rx="3.4" ry="2.8" fill="${INK}"/>` +
      `<path d="M24 34v2m-3 3a3 3 0 0 0 6 0" stroke="${INK}" stroke-width="1.8" stroke-linecap="round" fill="none"/>`,
  },
  {
    key: 'panda', label: 'Panda', tint: '#f4f1ea',
    art: `<circle cx="11" cy="13" r="6" fill="${INK}"/><circle cx="37" cy="13" r="6" fill="${INK}"/>` +
      head() +
      `<ellipse cx="17" cy="25" rx="5" ry="6" fill="${INK}"/><ellipse cx="31" cy="25" rx="5" ry="6" fill="${INK}"/>` +
      dot(17, 25, 2, PALE) + dot(31, 25, 2, PALE) + dot(24, 33, 3),
  },
  {
    key: 'tiger', label: 'Tiger', tint: '#ffb02e',
    art: earsRound(11, 12, 5.5) + head() +
      `<path d="M10 22h6m16 0h6M11 30h5m16 0h5M20 14l1 5m6-5-1 5" stroke="${INK}" stroke-width="2.6" stroke-linecap="round" fill="none"/>` +
      `<ellipse cx="24" cy="34" rx="7" ry="5" fill="${PALE}"/>` + eyes(25) +
      `<path d="M24 33l-2.5-2h5z" fill="${INK}"/>`,
  },
  {
    key: 'wolf', label: 'Wolf', tint: '#8a97a8',
    art: earsPointed(9, 5, 20, 22) + head() +
      `<path d="M24 42c-4 0-7-3-8-7l8-3 8 3c-1 4-4 7-8 7z" fill="${PALE}"/>` +
      eyes(24) + dot(24, 33, 2.6),
  },
  {
    key: 'rabbit', label: 'Rabbit', tint: '#ffc0d3',
    art: `<ellipse cx="17" cy="12" rx="4.5" ry="11" fill="currentColor"/>` +
      `<ellipse cx="31" cy="12" rx="4.5" ry="11" fill="currentColor"/>` + head(30, 12) +
      eyes(28, 5) + dot(24, 33, 2.4) +
      `<path d="M24 35v3" stroke="${INK}" stroke-width="2" stroke-linecap="round"/>`,
  },
  {
    key: 'mouse', label: 'Mouse', tint: '#b8b3c9',
    art: `<circle cx="10" cy="18" r="8" fill="currentColor"/><circle cx="38" cy="18" r="8" fill="currentColor"/>` +
      `<circle cx="10" cy="18" r="4" fill="${PALE}"/><circle cx="38" cy="18" r="4" fill="${PALE}"/>` +
      head(29, 13) + eyes(27, 5, 2.2) + dot(24, 35, 2.6, '#ff7ba0'),
  },
  {
    key: 'frog', label: 'Frog', tint: '#5ec962',
    art: `<circle cx="15" cy="16" r="7" fill="currentColor"/><circle cx="33" cy="16" r="7" fill="currentColor"/>` +
      `<circle cx="15" cy="16" r="4" fill="${PALE}"/><circle cx="33" cy="16" r="4" fill="${PALE}"/>` +
      dot(15, 16, 2.2) + dot(33, 16, 2.2) +
      `<path d="M9 26a15 15 0 0 0 30 0z" fill="currentColor"/>` +
      `<path d="M15 33h18" stroke="${INK}" stroke-width="2.4" stroke-linecap="round"/>`,
  },
  {
    key: 'owl', label: 'Owl', tint: '#a1745a',
    art: `<path d="M11 9l6 6-6 3zM37 9l-6 6 6 3z" fill="currentColor"/>` +
      `<ellipse cx="24" cy="27" rx="15" ry="16" fill="currentColor"/>` +
      `<circle cx="17" cy="24" r="6" fill="${PALE}"/><circle cx="31" cy="24" r="6" fill="${PALE}"/>` +
      dot(17, 24, 3) + dot(31, 24, 3) +
      `<path d="M24 27l3 5h-6z" fill="#ffb02e"/>`,
  },
  {
    key: 'penguin', label: 'Penguin', tint: '#3b4a63',
    art: `<ellipse cx="24" cy="26" rx="14" ry="17" fill="currentColor"/>` +
      `<ellipse cx="24" cy="30" rx="9" ry="12" fill="${PALE}"/>` + eyes(21, 5, 2.4) +
      `<path d="M24 24l4 4h-8z" fill="#ffb02e"/>` +
      `<path d="M14 41h8l-4-4zm20 0h-8l4-4z" fill="#ffb02e"/>`,
  },
  {
    key: 'shark', label: 'Shark', tint: '#7f93a8',
    art: `<path d="M21 14l3-10 7 10z" fill="currentColor"/>` +
      `<path d="M5 24c6-7 17-10 27-9l11-7-4 15 4 15-11-7c-10 1-21-2-27-7z" fill="currentColor"/>` +
      `<path d="M7 29c6 4 15 6 23 5l-1 4c-9 1-18-1-23-4z" fill="${PALE}"/>` +
      `<path d="M6 28l4 2 4-2 4 2 4-2" stroke="${PALE}" stroke-width="2.4" stroke-linejoin="round" fill="none"/>` +
      dot(14, 22, 2.6),
  },
  {
    key: 'whale', label: 'Whale', tint: '#4f7fd4',
    art: `<path d="M24 14c-2-5-6-7-6-7s1 5-1 7z" fill="${PALE}"/>` +
      `<path d="M8 22c8-4 22-4 30 2l8-6-3 10 3 10-8-6c-10 6-24 4-30-4z" fill="currentColor"/>` +
      `<path d="M11 30c6 5 16 6 24 2l-2 4c-8 3-18 2-22-2z" fill="${PALE}"/>` + dot(15, 25, 2.6),
  },
  {
    key: 'octopus', label: 'Octopus', tint: '#ff6f91',
    art: `<path d="M9 28a15 15 0 0 1 30 0v4H9z" fill="currentColor"/>` +
      `<path d="M9 32c0 6 3 6 3 10m6-10c0 6-2 7-2 10m8-10c0 6 0 7 0 10m8-10c0 6 2 7 2 10m6-10c0 6-3 6-3 10" stroke="currentColor" stroke-width="4" stroke-linecap="round" fill="none"/>` +
      eyes(24, 5, 3) + dot(19, 24, 1.4, PALE) + dot(29, 24, 1.4, PALE),
  },
  {
    key: 'bee', label: 'Bee', tint: '#ffd23f',
    art: `<ellipse cx="14" cy="16" rx="7" ry="5" fill="${PALE}" opacity=".85" transform="rotate(-25 14 16)"/>` +
      `<ellipse cx="34" cy="16" rx="7" ry="5" fill="${PALE}" opacity=".85" transform="rotate(25 34 16)"/>` +
      `<ellipse cx="24" cy="28" rx="12" ry="14" fill="currentColor"/>` +
      `<path d="M13 24h22M14 33h20" stroke="${INK}" stroke-width="3.4" stroke-linecap="round"/>` +
      eyes(19, 4.5, 2.2),
  },
  {
    key: 'ladybug', label: 'Ladybug', tint: '#ef3f4a',
    art: `<circle cx="24" cy="27" r="15" fill="currentColor"/>` +
      `<path d="M24 12a15 15 0 0 0-9 3 11 11 0 0 0 18 0 15 15 0 0 0-9-3z" fill="${INK}"/>` +
      `<path d="M24 12v30" stroke="${INK}" stroke-width="2.4"/>` +
      dot(16, 25, 2.6) + dot(32, 25, 2.6) + dot(18, 34, 2.2) + dot(30, 34, 2.2),
  },
  {
    key: 'dino', label: 'Dino', tint: '#3fbf8f',
    art: `<path d="M16 18l5-11 5 11 5-11 5 11" stroke="currentColor" stroke-width="5" stroke-linecap="round" stroke-linejoin="round" fill="none"/>` +
      `<circle cx="28" cy="27" r="14" fill="currentColor"/>` +
      `<rect x="4" y="24" width="20" height="13" rx="6" fill="currentColor"/>` +
      `<path d="M6 32h16v3H8a3 3 0 0 1-2-3z" fill="${PALE}"/>` +
      dot(28, 23, 3) + dot(9, 27, 1.8),
  },
  {
    key: 'dragon', label: 'Dragon', tint: '#7b5cff',
    art: `<path d="M12 12l-3-8 9 5zM36 12l3-8-9 5z" fill="currentColor"/>` +
      head(28, 13) +
      `<path d="M13 34a11 11 0 0 0 22 0z" fill="${PALE}"/>` +
      `<path d="M15 34h18l-2 4H17z" fill="#ff5a5a"/>` + eyes(25, 6, 2.6) +
      dot(21, 31, 1.6) + dot(27, 31, 1.6),
  },
  {
    key: 'unicorn', label: 'Unicorn', tint: '#ffe1f0',
    art: `<path d="M24 2l4 12h-8z" fill="#ffd23f"/>` +
      `<path d="M12 13l6 3-4 5z" fill="currentColor"/><path d="M36 13l-6 3 4 5z" fill="currentColor"/>` +
      `<path d="M13 15c-5 6-5 14 0 20l5-6z" fill="#b58cff"/>` +
      `<path d="M35 15c5 6 5 14 0 20l-5-6z" fill="#6fd3e0"/>` +
      `<ellipse cx="24" cy="29" rx="11" ry="13" fill="currentColor"/>` +
      `<ellipse cx="24" cy="36" rx="6.5" ry="5" fill="${PALE}"/>` +
      eyes(26, 5.5, 2.4) + dot(21.5, 36, 1.5) + dot(26.5, 36, 1.5),
  },
  {
    key: 'robot', label: 'Robot', tint: '#6fd3e0',
    art: `<path d="M24 4v6" stroke="currentColor" stroke-width="3" stroke-linecap="round"/>` + dot(24, 6, 3, 'currentColor') +
      `<rect x="9" y="12" width="30" height="28" rx="7" fill="currentColor"/>` +
      `<rect x="14" y="20" width="8" height="6" rx="2" fill="${INK}"/>` +
      `<rect x="26" y="20" width="8" height="6" rx="2" fill="${INK}"/>` +
      `<path d="M16 32h16" stroke="${INK}" stroke-width="3" stroke-linecap="round"/>` +
      `<path d="M20 32v3m8-3v3" stroke="${INK}" stroke-width="2"/>`,
  },
  {
    key: 'alien', label: 'Alien', tint: '#8cf05a',
    art: `<path d="M24 6c10 0 16 8 16 17s-7 19-16 19S8 32 8 23 14 6 24 6z" fill="currentColor"/>` +
      `<ellipse cx="16" cy="24" rx="5" ry="7" fill="${INK}" transform="rotate(-15 16 24)"/>` +
      `<ellipse cx="32" cy="24" rx="5" ry="7" fill="${INK}" transform="rotate(15 32 24)"/>` +
      `<path d="M20 35h8" stroke="${INK}" stroke-width="2.4" stroke-linecap="round"/>`,
  },
  {
    key: 'ghost', label: 'Ghost', tint: '#e8ecf6',
    art: `<path d="M24 5c9 0 15 7 15 16v22l-5-4-5 4-5-4-5 4-5-4-5 4V21C9 12 15 5 24 5z" fill="currentColor"/>` +
      `<ellipse cx="18" cy="22" rx="3.4" ry="4.4" fill="${INK}"/>` +
      `<ellipse cx="30" cy="22" rx="3.4" ry="4.4" fill="${INK}"/>` +
      `<path d="M21 31a4 4 0 0 0 6 0" stroke="${INK}" stroke-width="2.4" stroke-linecap="round" fill="none"/>`,
  },
  {
    key: 'rocket', label: 'Rocket', tint: '#ff5a5a',
    art: `<path d="M24 3c7 7 10 15 10 24H14c0-9 3-17 10-24z" fill="currentColor"/>` +
      `<path d="M14 27l-5 9 8-3zm20 0l5 9-8-3z" fill="currentColor"/>` +
      `<path d="M17 31h14l-2 6H19z" fill="${PALE}"/>` +
      `<circle cx="24" cy="18" r="5" fill="${PALE}"/><circle cx="24" cy="18" r="2.6" fill="#4f7fd4"/>` +
      `<path d="M24 38c2 3 3 5 0 8-3-3-2-5 0-8z" fill="#ffd23f"/>`,
  },
  {
    key: 'star', label: 'Star', tint: '#ffdd55',
    art: `<path d="M24 4l6 13 14 2-10 10 2 15-12-7-12 7 2-15L4 19l14-2z" fill="currentColor"/>` +
      eyes(24, 5, 2.2) +
      `<path d="M21 30a4 4 0 0 0 6 0" stroke="${INK}" stroke-width="2.2" stroke-linecap="round" fill="none"/>`,
  },
  {
    key: 'moon', label: 'Moon', tint: '#cbd5f5',
    art: `<path d="M31 4a20 20 0 1 0 13 33A17 17 0 0 1 31 4z" fill="currentColor"/>` +
      `<circle cx="17" cy="18" r="3" fill="${INK}" opacity=".25"/>` +
      `<circle cx="13" cy="30" r="4" fill="${INK}" opacity=".25"/>` +
      `<circle cx="24" cy="33" r="2.4" fill="${INK}" opacity=".25"/>` +
      dot(20, 24, 2.2) + dot(30, 26, 2.2),
  },
  {
    key: 'pizza', label: 'Pizza', tint: '#ffc02e',
    art: `<path d="M24 5l17 34a60 60 0 0 1-34 0z" fill="currentColor"/>` +
      `<path d="M7 39a60 60 0 0 0 34 0l2 4a66 66 0 0 1-38 0z" fill="#c98a54"/>` +
      dot(24, 20, 3.2, '#ef3f4a') + dot(17, 31, 3.2, '#ef3f4a') + dot(30, 31, 3.2, '#ef3f4a'),
  },
  {
    key: 'donut', label: 'Donut', tint: '#ff9ec7',
    art: `<circle cx="24" cy="24" r="19" fill="#c98a54"/>` +
      `<path d="M24 6a18 18 0 0 1 0 36 18 18 0 0 1 0-36z" fill="currentColor"/>` +
      `<circle cx="24" cy="24" r="18" fill="currentColor"/>` +
      `<circle cx="24" cy="24" r="6" fill="#241a14"/>` +
      `<path d="M14 15l3 3m14 10l4 2m-9 8l1 4m-11-9l-4 1m17-19l2-4" stroke="${PALE}" stroke-width="2.6" stroke-linecap="round"/>`,
  },
  {
    key: 'mushroom', label: 'Mushroom', tint: '#d92b3f',
    art: `<path d="M24 5c11 0 19 8 19 16H5C5 13 13 5 24 5z" fill="currentColor"/>` +
      dot(15, 15, 3.4, PALE) + dot(31, 14, 4, PALE) + dot(24, 20, 2.6, PALE) +
      `<path d="M17 21h14v14a7 7 0 0 1-14 0z" fill="${PALE}"/>` + eyes(28, 4, 2),
  },
  {
    key: 'cherry', label: 'Cherry', tint: '#e5344a',
    art: `<path d="M24 6c-6 4-12 10-14 18m14-18c5 4 9 10 11 16" stroke="#3fbf8f" stroke-width="3" stroke-linecap="round" fill="none"/>` +
      `<path d="M24 6c4-3 9-3 12 0-4 1-7 2-9 5z" fill="#3fbf8f"/>` +
      `<circle cx="13" cy="32" r="9" fill="currentColor"/><circle cx="34" cy="32" r="8" fill="currentColor"/>` +
      dot(11, 30, 2, PALE) + dot(32, 30, 1.8, PALE),
  },
];

/** Key to avatar, for the one lookup everything does. */
const BY_KEY = new Map(AVATARS.map((avatar) => [avatar.key, avatar]));

/** @param {string} key @returns {Avatar | null} */
export function avatar(key) {
  return BY_KEY.get(key) || null;
}

/**
 * One avatar as an `<svg>` string, ready to drop into innerHTML.
 *
 * Unknown keys draw a neutral question disc rather than nothing. A player whose
 * avatar key was edited to something the set does not have still needs a
 * tappable tile, and an empty one is a tile nobody can find themselves on.
 *
 * `aria-hidden` is deliberate: every place this is used carries the screen name
 * in text beside it, and a second announcement of "fox" helps nobody.
 *
 * @param {string} key
 * @param {{ size?: number | string }} [options]
 * @returns {string}
 */
export function avatarSvg(key, options = {}) {
  const found = avatar(key);
  const size = options.size === undefined ? '100%' : options.size;
  const tint = found ? found.tint : '#8a97a8';
  const art = found
    ? found.art
    : `<circle cx="24" cy="24" r="18" fill="currentColor"/>` +
      `<path d="M19 19a5 5 0 0 1 9 3c0 3-4 3-4 6" stroke="${INK}" stroke-width="3" stroke-linecap="round" fill="none"/>` +
      dot(24, 33, 2.4);
  return `<svg class="avatar-glyph" viewBox="0 0 48 48" width="${size}" height="${size}" ` +
    `style="color:${tint}" aria-hidden="true" focusable="false">${art}</svg>`;
}

/** The tint behind a tile, so a card can match the glyph it holds. */
export function avatarTint(key) {
  const found = avatar(key);
  return found ? found.tint : '#8a97a8';
}
