// The hub: the picker and the shelf, and the switch between them.
//
// Two screens, one page:
//
//   picker   nobody is chosen on this device yet, or somebody tapped to switch.
//            Every live profile as a big face. Tap yours.
//   shelf    the games, and the family strip along the bottom of them.
//
// The picker comes first on a device that has never been used, because a play
// needs a player and asking once is cheaper than asking on the way into every
// game. After that the shelf is what opens, which is the whole point of the
// `who` cookie: the 12-year-old's phone opens straight to them and the shared
// tablet is cleared back to the picker with the Nobody tile.
//
// Rendering is innerHTML into one container. There is nothing here worth a
// framework, no dependency is allowed, and every screen redraws whole — the
// most this page ever holds is thirty faces and a handful of tiles.

import { avatarSvg, avatarTint } from '../shared/avatars.js';
import { GAMES } from '../shared/games.js';
import { ApiError, getPlayers, setWho } from '../shared/api.js';

const root = /** @type {HTMLElement} */ (document.getElementById('app'));

/** @type {{ players: import('../shared/api.js').Player[], me: string | null, switching: boolean }} */
const state = { players: [], me: null, switching: false };

/** @param {string} text */
const esc = (text) =>
  String(text)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');

/**
 * A face on its disc, tinted to match the glyph. The tint is set on the tile
 * rather than inside the SVG so the disc behind it can mix with it.
 *
 * @param {string} avatarKey
 */
const face = (avatarKey) =>
  `<span class="disc" style="color:${avatarTint(avatarKey)}">${avatarSvg(avatarKey)}</span>`;

/**
 * One player, as a button. The same markup in the picker and in the strip; the
 * two sizes are CSS.
 *
 * `aria-pressed` carries "this is you" to a screen reader and draws the ring in
 * CSS, which is one attribute doing both jobs.
 *
 * @param {import('../shared/api.js').Player} player
 * @param {boolean} isMe
 */
function playerTile(player, isMe) {
  return `<button class="who" type="button" data-id="${esc(player.id)}" aria-pressed="${isMe}">
    ${face(player.avatar)}
    <span>${esc(player.name)}</span>
  </button>`;
}

/** @param {import('../shared/games.js').Game} game */
function gameTile(game) {
  return `<a class="game" href="${game.href}" style="--tile:${game.accent}">
    ${game.art}
    <div>
      <h2>${esc(game.title)}</h2>
      <p>${esc(game.blurb)}</p>
    </div>
  </a>`;
}

/**
 * The picker. `switching` is the difference between the first screen a device
 * ever shows and the one reached from the bar: only the second offers Nobody,
 * because clearing a device that has nobody on it is a button that does
 * nothing.
 */
function picker() {
  const tiles = state.players.map((player) => `<li>${playerTile(player, player.id === state.me)}</li>`);

  const nobody = state.switching
    ? `<li><button class="who nobody" type="button" data-id="" aria-pressed="false">
        <span class="disc">${avatarSvg('__none__')}</span>
        <span>Nobody</span>
      </button></li>`
    : '';

  if (state.players.length === 0) {
    return `<h1 class="ask">Nobody lives here yet</h1>
    <p class="note">There are no profiles in the database. Somebody with the keys to
    <code>/admin</code> presses <strong>Run seed</strong>, and everyone appears.</p>`;
  }

  return `<h1 class="ask">${state.switching ? 'Who is playing now?' : 'Who is playing?'}</h1>
  <ul class="picker">${tiles.join('')}${nobody}</ul>`;
}

/** The shelf: the games, then everybody's face. */
function shelf() {
  const me = state.players.find((player) => player.id === state.me);

  return `<header class="bar">
    <h1 class="wordmark">Gameroom</h1>
    <button class="me" type="button" id="switch">
      ${face(me ? me.avatar : '__none__')}
      <span>
        <b>${esc(me ? me.name : 'Nobody')}</b>
        <small>not you? tap</small>
      </span>
    </button>
  </header>
  <section class="games">${GAMES.map(gameTile).join('')}</section>
  <section class="family">
    <h2 class="section">Everybody</h2>
    <div class="strip">${state.players.map((player) => playerTile(player, player.id === state.me)).join('')}</div>
  </section>`;
}

function render() {
  root.innerHTML = `<div class="shell">${state.me && !state.switching ? shelf() : picker()}</div>`;
}

/** @param {string} message */
function renderProblem(message) {
  root.innerHTML = `<div class="shell">
    <h1 class="ask">Hmm.</h1>
    <p class="note bad">${esc(message)}</p>
    <div class="row"><button class="btn" type="button" id="retry">Try again</button></div>
  </div>`;
}

/**
 * Picking is optimistic: the ring moves under the thumb and the screen changes
 * before the server has answered, because a tap that does nothing for 200ms on
 * a phone reads as a tap that missed (docs/design-language.md §2). If the write
 * fails the screen goes back to the picker and says so, which is the only case
 * where the optimism costs anything.
 *
 * @param {string} id the player, or '' for nobody
 */
async function pick(id) {
  const previous = state.me;
  state.me = id || null;
  state.switching = false;
  render();

  try {
    await setWho(id || null);
  } catch (err) {
    state.me = previous;
    state.switching = true;
    if (err instanceof ApiError && err.status === 401) return;
    renderProblem(err instanceof Error ? err.message : 'That did not work.');
  }
}

// One listener on the container rather than one per tile: every screen here is
// redrawn whole, and handlers attached to elements that no longer exist are the
// bug that follows from that.
root.addEventListener('click', (event) => {
  const target = /** @type {HTMLElement} */ (event.target);

  const tile = target.closest('.who');
  if (tile instanceof HTMLElement) {
    pick(tile.dataset.id || '');
    return;
  }

  if (target.closest('#switch')) {
    state.switching = true;
    render();
    return;
  }

  if (target.closest('#retry')) start();
});

async function start() {
  root.innerHTML = '<div class="shell"><p class="note">Opening the gameroom…</p></div>';
  try {
    const { players, me } = await getPlayers();
    state.players = players;
    state.me = me;
    state.switching = false;
    render();
  } catch (err) {
    // A 401 has already navigated to the gate; anything else is ours to say.
    if (err instanceof ApiError && err.status === 401) return;
    renderProblem(err instanceof Error ? err.message : 'Something went wrong.');
  }
}

start();
