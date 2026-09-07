// The wiring: who you are, the setup screen, the room, and the four callbacks.
//
// It is the impure file by design — identity, the clock, `Math.random`, the
// store and the DOM all live here — and it makes no decisions about the table.
// A view arrives, `present.js` turns it into a Screen, `table.js` paints it; a
// tap arrives as a target, `present.js` says what it means, the room is sent
// the action. Nothing in between recomputes the game.

import { getPlayers } from '../../shared/api.js';
import { HAND, MAX_OFFER } from '../core/commodities.js';
import { createLocalRoom, seatLimits } from '../room/local.js';
import { loadPrefs, savePrefs } from '../store/local.js';
import { buildSeats, botAvatarPool, configFrom, botRange, TARGETS } from './setup.js';
import { createTable } from './table.js';
import { idle, onTap, onInteraction, present, receiptFor, RECEIPT_MS } from './present.js';

const $ = (id) => document.getElementById(id);
const show = (id) => {
  for (const section of document.querySelectorAll('.screen')) section.hidden = section.id !== id;
};

/** The counts reach CSS as custom properties, so no rule in pit.css names one. */
document.documentElement.style.setProperty('--hand', String(HAND));
document.documentElement.style.setProperty('--max-offer', String(MAX_OFFER));

const state = {
  me: null,
  players: [],
  choices: { botCount: null, ...loadPrefs() },
  room: null,
  table: null,
  view: null,
  ui: { ...idle },
  hand: null,        // the previous hand, for the receipt
  receiptAt: 0,
  repaint: 0,
};

/* ---------------------------------------------------------------- getting in */

// `/pit/` is a static file and is not gated — the Worker serves it before
// `worker/auth.js` runs — so this screen does what every hub screen does: it
// asks for data and finds out. A 401 navigates to /gate on its own inside
// api.js and is not re-implemented here.
async function start() {
  let answer;
  try {
    answer = await getPlayers();
  } catch (error) {
    if (error.status === 401) return;
    $('loading').innerHTML = '<p class="note bad"></p>';
    $('loading').querySelector('.note').textContent = error.message;
    return;
  }
  state.players = answer.players;
  state.me = answer.players.find((player) => player.id === answer.me) ?? null;
  // Nobody is chosen on this device, and the picker is already the screen that
  // comes up for exactly that reason.
  if (state.me === null) { location.replace('/'); return; }
  buildSetup();
  show('setup');
}

/* ------------------------------------------------------------------- setup */

function buildSetup() {
  const { levels, defaultLevel } = seatLimits();

  // Each tile carries its count and the deck it makes: "4 bots" and "five kinds
  // in play" are the same fact, and only one of them is visible otherwise.
  fill($('bots'), botRange().map((count) => ({
    value: count,
    label: String(count),
    sub: `${count + 1} kinds`,
    className: 'tile',
  })), 'botCount');

  fill($('levels'), levels.map((level) => ({
    value: level, label: level, className: 'pill',
  })), 'botLevel', defaultLevel);

  fill($('targets'), TARGETS.map((target) => ({
    value: target, label: String(target), className: 'pill',
  })), 'target', configFrom(state.choices).target);

  fill($('auto'), [
    { value: false, label: 'I press it', className: 'pill' },
    { value: true, label: 'Take it for me', className: 'pill' },
  ], 'autoCorner', configFrom(state.choices).autoCorner);

  $('deal').addEventListener('click', deal);
  refreshSetup();
}

function fill(host, options, key, fallback) {
  if (fallback !== undefined && !options.some((option) => option.value === state.choices[key])) {
    state.choices[key] = fallback;
  }
  host.replaceChildren();
  for (const option of options) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = option.className;
    button.append(Object.assign(document.createElement('span'), { textContent: option.label }));
    if (option.sub) {
      button.append(Object.assign(document.createElement('small'), { textContent: option.sub }));
    }
    button.addEventListener('click', () => {
      state.choices[key] = option.value;
      refreshSetup();
      // The bot count is the one thing not remembered, per §4.
      const { botCount, ...keep } = state.choices;
      savePrefs(keep);
    });
    host.append(button);
    option.node = button;
  }
  host.options = options;
  host.key = key;
}

function refreshSetup() {
  for (const host of [$('bots'), $('levels'), $('targets'), $('auto')]) {
    for (const option of host.options) {
      option.node.setAttribute('aria-pressed', String(state.choices[host.key] === option.value));
    }
  }
  const chosen = state.choices.botCount !== null && state.choices.botCount !== undefined;
  $('deal').disabled = !chosen;
  $('setup-note').textContent = chosen
    ? `${state.choices.botCount + 1} at the table.`
    : 'Tap how many bots sit down.';
}

/* -------------------------------------------------------------------- deal */

function deal() {
  const { seats, faces } = buildSeats({
    me: state.me,
    botCount: state.choices.botCount,
    botLevel: state.choices.botLevel,
    avatars: botAvatarPool(state.players),
  });

  // Read here, in the client, because `core/` may not touch either and this is
  // the file whose job it is to be impure.
  const seed = (Date.now() ^ Math.floor(Math.random() * 0xffffffff)) | 0;

  state.table = createTable($('table'), { faces, onTarget: tapped });
  state.room = createLocalRoom({ seats, config: configFrom(state.choices), seed });
  state.room.onView(onView);
  state.room.onEvent((event) => state.table.animate(event));
  state.room.onRefusal(({ reason }) => {
    state.ui = { ...state.ui, refusal: reason };
    paint();
  });

  $('quit').addEventListener('click', () => {
    // The client's own confirmation, not the rules module's: with one human at
    // the table `abandon` ends the session in one press.
    if (confirm('End the game? Nothing is saved either way.')) tapped({ kind: 'abandon' });
  });
  $('leave').addEventListener('click', () => state.room.leave());

  show('table');
  state.room.join(state.me.id);

  // Which C are in play is not known until the deal, so a <link rel=preload> in
  // the head cannot name them. Twelve kilobytes apiece makes the whole set
  // cheap enough not to need cleverness.
  for (const commodity of state.view.commodities) {
    new Image().src = `art/fruit/${commodity}.webp`;
  }

  addEventListener('pointerdown', interacted, { passive: true });
  addEventListener('scroll', interacted, { passive: true });
  // One repaint a second, so the reduced-motion countdown numerals move between
  // view pushes. The bars themselves are CSS and cost nothing per frame.
  state.repaint = setInterval(paint, 1000);
}

/* ------------------------------------------------------------- the loop */

function onView(next) {
  const previous = state.view;
  state.view = next;

  // The one moment of drama in the loop, and no event carries it: the client
  // learns what it just got by diffing its own hand. A deal is not a trade, so
  // a round boundary is skipped rather than reported as a receipt.
  // A view arriving means the board moved, which is answer enough to whatever
  // was refused a moment ago.
  state.ui = { ...state.ui, refusal: null };
  if (previous && previous.round === next.round && previous.phase === 'trading') {
    const receipt = receiptFor(previous.you.hand, next.you.hand);
    if (receipt) {
      state.ui = { ...state.ui, receipt };
      state.receiptAt = Date.now();
    }
  }
  paint();

  if (next.phase === 'over' || next.phase === 'abandoned') finish(next);
}

function paint() {
  if (!state.view || !state.table) return;
  const now = Date.now();
  if (state.ui.receipt && now - state.receiptAt > RECEIPT_MS) {
    state.ui = { ...state.ui, receipt: null };
  }
  const screen = present(state.view, state.ui, now);
  state.ui = screen.ui;
  state.table.paint(screen);
}

function tapped(target) {
  const { ui, action } = onTap(state.ui, state.view, target);
  state.ui = { ...ui, refusal: null };
  if (action) state.room.act(action);
  else paint();
}

function interacted() {
  if (!state.view) return;
  const { ui, action } = onInteraction(state.ui, state.view, Date.now());
  state.ui = ui;
  if (action) state.room.act(action);
}

function finish(view) {
  clearInterval(state.repaint);
  removeEventListener('pointerdown', interacted);
  removeEventListener('scroll', interacted);
  state.room.leave();

  // Session 4 owns the end-of-session screen and the `plays` row. This is the
  // smallest thing that does not leave a finished game on a dead board.
  $('ended-title').textContent = view.phase === 'abandoned' ? 'Game ended.' : 'That is the game.';
  const list = $('ended-scores');
  list.replaceChildren();
  for (const seat of [...view.seats].sort((a, b) => b.score - a.score)) {
    const row = document.createElement('li');
    row.textContent = `${seat.name} — ${seat.score}`;
    list.append(row);
  }
  show('ended');
}

start();
