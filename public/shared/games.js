// The shelf's contents. One entry per game, and the only place a game is named
// to the hub: adding a third means adding an object here and nothing else,
// which is H2 stated as code.
//
// `accent` is the game's one saturated colour — its tile here and its
// highlights inside itself, which is what makes "which game am I in"
// answerable at a glance (docs/design-language.md §4).
//
// `art` is the tile's picture and is drawn at 96px. It has to be legible as
// *which game* from across a room, and it never carries the game's name as text
// — the caption is the text. Inline SVG in `currentColor` and an `<img>` both
// qualify: sudoku's mark is drawn here, and Pit's is the back of its own card,
// which is the one image in that set claiming no commodity.

/**
 * @typedef {{ key: string, title: string, href: string, accent: string, blurb: string, art: string }} Game
 */

/** @type {Game[]} */
export const GAMES = [
  {
    key: 'sudoku',
    title: 'Sudoku',
    href: '/sudoku/',
    accent: '#4f9dff',
    blurb: 'Numbers, on your own',
    art: `<svg viewBox="0 0 64 64" aria-hidden="true" focusable="false">
      <rect x="4" y="4" width="56" height="56" rx="8" fill="currentColor" opacity=".18"/>
      <path d="M4 23h56M4 41h56M23 4v56M41 4v56" stroke="currentColor" stroke-width="3.5" stroke-linecap="round"/>
      <rect x="4" y="4" width="56" height="56" rx="8" fill="none" stroke="currentColor" stroke-width="4"/>
      <text x="13.5" y="19" font-family="system-ui, sans-serif" font-size="14" font-weight="700" fill="currentColor">5</text>
      <text x="31.5" y="37" font-family="system-ui, sans-serif" font-size="14" font-weight="700" fill="currentColor">3</text>
      <text x="49.5" y="55" font-family="system-ui, sans-serif" font-size="14" font-weight="700" fill="currentColor">8</text>
    </svg>`,
  },
  {
    key: 'pit',
    title: 'Pit',
    href: '/pit/',
    // `--pit` in public/pit/ui/pit.css, written twice on purpose: the hub cannot
    // import a game's stylesheet and the game cannot import this list, and one
    // saturated accent per game used in both places is what
    // docs/design-language.md §4 asks for.
    accent: '#ffb02e',
    blurb: 'Trade fast, fill your basket',
    art: '<img src="/pit/art/cards/back.webp" alt="" width="96" height="96" decoding="async">',
  },
];
