// Three settings and nothing else.
//
// **No game is saved.** A trading game against bots runs on a tick, and there
// is nothing meaningful to resume into an hour later — a hand mid-round is only
// worth anything against a board that is still moving. What a session somebody
// walked away from does instead is `../core/rules.js`'s pause and takeover.
//
// The bot count is deliberately absent. It is asked every time, because it is
// also the deck size (`../../../docs/pit/specs/session-3-the-table.md` §4), and
// a remembered one is a rule about filling short seats wearing a disguise.

const PREFS_KEY = 'pit.v1.prefs';
const VERSION = 1;

/**
 * A blocked or full store is never worth interrupting a game over, and neither
 * is a value written by an older shape of this file: both read as "no
 * preference", which is what the setup screen's defaults are for.
 * @returns {{ botLevel?: string, target?: number, autoCorner?: boolean }}
 */
export function loadPrefs() {
  try {
    const raw = localStorage.getItem(PREFS_KEY);
    const saved = raw === null ? null : JSON.parse(raw);
    if (saved === null || saved.version !== VERSION) return {};
    return saved;
  } catch {
    return {};
  }
}

/** @param {{ botLevel?: string, target?: number, autoCorner?: boolean }} prefs */
export function savePrefs(prefs) {
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify({ ...prefs, version: VERSION }));
  } catch {
    // Nothing here is worth a message on the screen.
  }
}
