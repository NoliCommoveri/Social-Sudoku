// The wiring: who you are, the setup screen, the room, and the four callbacks.
//
// It is the impure file by design — identity, the clock, `Math.random`, the
// store and the DOM all live here — and it makes no decisions about the table.
// A view arrives, `present.js` turns it into a Screen, `table.js` paints it; a
// tap arrives as a target, `present.js` says what it means, the room is sent
// the action. Nothing in between recomputes the game.

import { getPlayers, startPlay, endPlay } from '../../shared/api.js';
import { avatarSvg } from '../../shared/avatars.js';
import { HAND, MAX_OFFER } from '../core/commodities.js';
import { createLocalRoom, seatLimits } from '../room/local.js';
import { loadPrefs, savePrefs } from '../store/local.js';
import { buildSeats, botAvatarPool, configFrom, botRange, TARGETS } from './setup.js';
import { createTable } from './table.js';
import {
  idle, onTap, onInteraction, present, receiptFor, endingFor, cardFor, RECEIPT_MS,
} from './present.js';

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
  faces: {},
  view: null,
  ui: { ...idle },
  hand: null,        // the previous hand, for the receipt
  receiptAt: 0,
  repaint: 0,
  opening: null,     // the `plays` row being opened, in flight
  playId: null,      // and its id, once there is one
  levels: {},        // which level a bot seat is playing at, for the record
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
  const config = configFrom(state.choices);
  const { seats, faces } = buildSeats({
    me: state.me,
    botCount: state.choices.botCount,
    botLevel: state.choices.botLevel,
    avatars: botAvatarPool(state.players),
  });

  // Read here, in the client, because `core/` may not touch either and this is
  // the file whose job it is to be impure.
  const seed = (Date.now() ^ Math.floor(Math.random() * 0xffffffff)) | 0;

  state.faces = faces;
  state.table = createTable($('table'), { faces, onTarget: tapped });
  state.room = createLocalRoom({ seats, config, seed });
  state.room.onView(onView);
  state.room.onEvent((event) => state.table.animate(event));
  state.room.onRefusal(({ reason }) => {
    state.ui = { ...state.ui, refusal: reason };
    paint();
  });
  // Ranks with ties are the rules module's to state and the client may not
  // import it, so the ending arrives here rather than being worked out from the
  // last view. An abandoned session fires nothing and is drawn in `onView`.
  state.room.onComplete(finish);

  $('quit').addEventListener('click', () => {
    // The client's own confirmation, not the rules module's: with one human at
    // the table `abandon` ends the session in one press.
    if (confirm('End the game? No score is saved.')) tapped({ kind: 'abandon' });
  });
  $('leave').addEventListener('click', () => state.room.leave());

  show('table');
  state.room.join(state.me.id);

  // The row opens here rather than at the end, so a phone that gets locked
  // mid-game leaves a play with no ending instead of leaving nothing at all
  // (docs/identity-and-stats.md §4.1). It is not awaited and nothing waits on
  // it: a failure leaves `playId` null, the end call is skipped, and the ending
  // screen says so. The game does not stop for the record.
  //
  // The commodities and their values go in because they are what makes a row
  // readable a year later — *that was the game where kiwi was worth 55* — and
  // they are known by the time the first view lands, which is now.
  state.levels = Object.fromEntries(seats.map((seat) => [seat.playerId, seat.botLevel ?? null]));
  state.opening = startPlay({
    game: 'pit',
    mode: 'bots',
    config: {
      seats: seats.map((seat) => ({
        name: seat.name,
        isBot: seat.isBot === true,
        botLevel: seat.botLevel ?? null,
      })),
      target: config.target,
      autoCorner: config.autoCorner,
      botLevel: state.choices.botLevel,
      commodities: [...state.view.commodities],
      values: { ...state.view.values },
    },
  })
    .then((play) => { state.playId = play.id; })
    .catch(() => { state.playId = null; });

  // Which C are in play is not known until the deal, so a <link rel=preload> in
  // the head cannot name them. Twelve kilobytes apiece makes the whole set
  // cheap enough not to need cleverness.
  //
  // The cards follow the crops, and are the reason this loop is worth having at
  // all: which commodity gets cornered is not known until somebody corners one,
  // and fetching the card when the panel opens would put a blank frame in the
  // middle of the one moment the panel exists for. Only C of the nine can ever
  // be needed, over a round that lasts at least seventeen seconds.
  for (const commodity of state.view.commodities) {
    new Image().src = `art/fruit/${commodity}.webp`;
    new Image().src = cardFor(commodity);
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

  // `over` comes through `onComplete`, which carries the ranks. An abandon
  // reaches `isComplete` as null and fires nothing, so it is drawn from the
  // view: standings with no ranks, because there were none.
  if (next.phase === 'abandoned') finish({ abandoned: true, seats: next.seats });
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

/**
 * The end of a session. `outcome` is what the driver's `onComplete` carried, or
 * `{ abandoned: true, seats }` off the view.
 */
function finish(outcome) {
  clearInterval(state.repaint);
  removeEventListener('pointerdown', interacted);
  removeEventListener('scroll', interacted);
  state.room.leave();

  // Drawn twice: once with the sentence that is true while the call is in
  // flight, once with the answer. An abandoned session has nothing to save and
  // says so in both.
  const abandoned = outcome.abandoned === true;
  drawEnding(outcome, abandoned ? 'none' : 'saving');
  show('ended');
  writeRecord(outcome, abandoned).then((record) => drawEnding(outcome, record));
}

/**
 * Closing the row, and what the ending screen gets to say about it.
 *
 * An abandoned session still closes its row — with no result, which is what an
 * abandoned game looks like in the record — and still reads as *Nothing to
 * save*, because there was no result to save.
 *
 * There is no retry and no queue. A trading game against bots is not worth an
 * offline outbox, and pretending otherwise would be a mechanism nobody could
 * test.
 *
 * @param {object} outcome
 * @param {boolean} abandoned
 * @returns {Promise<'saved' | 'failed' | 'none'>}
 */
async function writeRecord(outcome, abandoned) {
  await state.opening;
  if (state.playId === null) return abandoned ? 'none' : 'failed';
  // Phase 7: the room writes every seat's result itself, and this client's post
  // would be a second row for the same play.
  if (outcome.recorded === true) return 'saved';

  const result = abandoned ? null : resultFor(outcome);
  try {
    await endPlay(state.playId, result);
    return result === null ? 'none' : 'saved';
  } catch {
    return abandoned ? 'none' : 'failed';
  }
}

/**
 * The human seat's row. Only one is written: `play_results.player_id` references
 * a profile and a bot is not one, so the bots' final scores travel in the
 * detail, which is where the table as it came out belongs anyway.
 *
 * `outcome` is `'won'` at rank 1, ties included, and `'lost'` otherwise — losing
 * to a bot is a true thing to have written down.
 *
 * @param {object} outcome
 */
function resultFor(outcome) {
  const seats = outcome.seats ?? [];
  const mine = seats.find((seat) => seat.playerId === state.me.id);
  if (!mine) return null;

  return {
    rank: mine.rank ?? null,
    outcome: mine.rank === 1 ? 'won' : 'lost',
    value: mine.score,
    unit: 'points',
    detail: {
      corners: mine.corners ?? 0,
      rankOf: seats.length,
      seats: seats.map((seat) => ({
        name: seat.name,
        isBot: seat.isBot === true,
        botLevel: state.levels[seat.playerId] ?? null,
        score: seat.score,
        corners: seat.corners ?? 0,
        rank: seat.rank ?? null,
      })),
    },
  };
}

function drawEnding(outcome, record) {
  const ending = endingFor(outcome, record, state.me.id);
  $('ended-title').textContent = ending.headline;
  $('ended-note').textContent = ending.note;

  const list = $('ended-scores');
  list.replaceChildren();
  for (const row of ending.rows) {
    const item = document.createElement('li');
    item.classList.toggle('is-you', row.you);
    const rank = Object.assign(document.createElement('span'), {
      className: 'stand-rank',
      textContent: row.rank === null ? '' : String(row.rank),
    });
    const face = Object.assign(document.createElement('span'), { className: 'stand-face' });
    face.innerHTML = avatarSvg(state.faces[row.playerId] ?? '', { size: 40 });
    item.append(
      rank,
      face,
      Object.assign(document.createElement('span'), { className: 'stand-name', textContent: row.name }),
      Object.assign(document.createElement('span'), { className: 'stand-baskets', textContent: row.baskets }),
      Object.assign(document.createElement('span'), { className: 'stand-score', textContent: String(row.score) }),
    );
    list.append(item);
  }
}

start();
