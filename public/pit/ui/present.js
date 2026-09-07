// Everything the table decides, as pure functions over a View and one small
// object of local intent.
//
// `table.js` cannot be tested — there is no jsdom, because there are no
// dependencies — so the size of `table.js` is the size of what CI cannot check,
// and the split is drawn to keep it boring. Which groups are tappable, what a
// tap means, when a mode cancels itself, what the line says: all of it is here,
// against a plain object, asserted in `../../../test/pit-present.test.js`.
//
// Nothing in this file names `document`, `window`, `localStorage`, `Date.now`
// or `Math.random`, and a grep in `../../../test/pit-core-purity.test.js` keeps
// it that way. It is the file CI can reach and it is only worth reaching while
// that is true.
//
// It does not import `../core/rules.js` either. The client renders a view and
// sends an action; it never computes the game.

import { COMMODITIES, HAND, MAX_OFFER } from '../core/commodities.js';

/** The intent nothing is selected in. */
export const idle = Object.freeze({ mode: 'idle' });

/**
 * How often at most a presence stamp is sent. Under this the seat is plainly
 * active and the stamp buys nothing; sent on every tap and scroll it would be a
 * full view push per scroll event.
 */
export const PRESENT_THROTTLE_MS = 5000;

/** A beat, and then the receipt clears itself. */
export const RECEIPT_MS = 3200;

/**
 * The chip warns at the halfway mark of whatever the takeover window is. Half
 * rather than a number of seconds, because the window is the rules module's to
 * choose and little-kid mode is expected to change it — earlier than this is
 * noise on a table where a median round is seventeen seconds, later is not a
 * warning. `../../../docs/pit/specs/session-3-the-table.md` §5.8.
 */
const WARN_FRACTION = 0.5;

const nameOf = (commodity) => COMMODITIES[commodity].name;

/** `art/fruit/<key>.webp` resolves from `/pit/` with no mapping table. */
export const artFor = (commodity) => `art/fruit/${commodity}.webp`;

/**
 * The full illustration. `../../../docs/pit/design.md` §4 allows it in exactly
 * three places and this is one of them: the card at the top of the reveal. Live
 * play stays on `art/fruit/`, which is why the crop and the card are two
 * functions rather than one with a flag.
 */
export const cardFor = (commodity) => `art/cards/${commodity}.webp`;

/**
 * How many of a seat's offers the reveal lists before it trails off. Six is
 * what fits on one line at 360px; the rest of the round is not worth a second
 * line of numerals under every seat.
 */
const COUNTS_SHOWN = 6;

const seatOf = (view, playerId) => view.seats.find((seat) => seat.playerId === playerId) ?? null;
const offerOf = (view, id) => view.offers.find((offer) => offer.id === id) ?? null;
const holds = (view, commodity) => view.you.hand[commodity] || 0;

const isLive = (view) => view.phase === 'trading' && view.pausedAt === null;

/* --------------------------------------------------------------- the mode */

/**
 * A mode that loses its subject cancels itself.
 *
 * This runs on every view rather than in a tap handler, which is why the whole
 * shape is `present(view, ui)` returning a corrected `ui`: an intent that could
 * survive a view it no longer matches is the bug class this removes. Losing a
 * race for an offer is normal play, not an error, and a pause drops any mode so
 * that resuming does not resume into a half-composed offer against a board that
 * has moved.
 *
 * @returns {{ ui: object, lost: null | 'offer' | 'cards' }}
 */
function reconcile(view, ui) {
  const dropped = (lost) => ({ ui: { ...idle, lastPresentAt: ui.lastPresentAt }, lost });

  if (ui.mode === 'idle') return { ui, lost: null };
  if (!isLive(view)) return dropped(null);

  if (ui.mode === 'pay') {
    const offer = offerOf(view, ui.offerId);
    if (!offer || offer.mine) return dropped('offer');
    return { ui, lost: null };
  }
  if (ui.mode === 'compose') {
    // The trade you accepted can empty the group you were about to offer from,
    // and posting an offer means you may not post another.
    if (holds(view, ui.commodity) < 1 || view.you.offer) return dropped('cards');
    return { ui, lost: null };
  }
  return dropped(null);
}

/* ---------------------------------------------------------------- the tap */

/**
 * A tap, resolved against the current view: the next intent, and what to send.
 *
 * `target` is the vocabulary of things on the screen, not a DOM event —
 * `{ kind: 'group', commodity }`, `{ kind: 'count', n }`, `{ kind: 'offer', id }`,
 * `{ kind: 'withdraw' }`, `{ kind: 'harvest' }`, `{ kind: 'ready' }`,
 * `{ kind: 'menu' }`, `{ kind: 'pause' }`, `{ kind: 'resume' }`,
 * `{ kind: 'abandon' }`.
 *
 * @param {object} ui
 * @param {object} view
 * @param {{ kind: string, commodity?: string, n?: number, id?: string }} target
 * @returns {{ ui: object, action?: object }}
 */
export function onTap(ui, view, target) {
  const now = reconcile(view, ui).ui;
  const stay = { ui: now };
  const back = (action) => ({ ui: { ...idle, lastPresentAt: now.lastPresentAt }, action });

  // The three that work through a pause. Everything else on the screen is
  // untappable while `pausedAt` is set, so a tap does not travel to the rules
  // module to be told no.
  switch (target.kind) {
    case 'menu': return { ui: { ...now, menu: !now.menu } };
    case 'resume': return view.pausedAt === null ? stay : back({ type: 'resume' });
    case 'abandon': return back({ type: 'abandon' });
    case 'pause': return view.pausedAt !== null ? stay : back({ type: 'pause' });
    default: break;
  }

  if (view.pausedAt !== null) return stay;

  if (target.kind === 'ready') {
    if (view.phase !== 'roundEnd' || view.you.ready) return stay;
    return back({ type: 'ready' });
  }

  if (!isLive(view)) return stay;

  switch (target.kind) {
    case 'group': {
      const commodity = target.commodity;
      if (now.mode === 'pay') {
        const offer = offerOf(view, now.offerId);
        if (!offer || holds(view, commodity) < offer.count) return stay;
        return back({ type: 'accept', offerId: offer.id, commodity });
      }
      // Composing: the same group again, or a different one, both move the
      // selection there. There is no cancel button to find.
      if (view.you.offer || holds(view, commodity) < 1) return stay;
      return { ui: { ...now, mode: 'compose', commodity } };
    }
    case 'count': {
      if (now.mode !== 'compose') return stay;
      if (!Number.isInteger(target.n) || target.n < 1 || target.n > offerCap(view, now.commodity)) return stay;
      return back({ type: 'offer', commodity: now.commodity, count: target.n });
    }
    case 'offer': {
      const offer = offerOf(view, target.id);
      if (!offer || offer.mine) return stay;
      // Tapping the lifted row again is how a pay cancels.
      if (now.mode === 'pay' && now.offerId === offer.id) {
        return { ui: { ...idle, lastPresentAt: now.lastPresentAt } };
      }
      if (!offer.matchable) return stay;
      return { ui: { ...idle, lastPresentAt: now.lastPresentAt, mode: 'pay', offerId: offer.id } };
    }
    case 'withdraw': {
      if (!view.you.offer) return stay;
      return back({ type: 'withdraw' });
    }
    case 'harvest': {
      if (!view.you.canHarvest) return stay;
      return back({ type: 'harvest' });
    }
    default: return stay;
  }
}

/** `1..min(held, MAX_OFFER)` — the count row, and never one for an empty group. */
const offerCap = (view, commodity) => Math.min(holds(view, commodity), MAX_OFFER);

/* -------------------------------------------------------------- presence */

/**
 * The throttled presence stamp of `../../../docs/pit/design.md` §2.6: a player
 * deliberating with a thumb on the screen must be distinguishable from one
 * whose phone is in a pocket.
 *
 * It reads no clock — `now` is an argument and `lastPresentAt` comes back in
 * `ui` — so `app.js` calls it from a pointerdown and a scroll listener and does
 * no arithmetic of its own.
 *
 * @returns {{ ui: object, action?: object }}
 */
export function onInteraction(ui, view, now) {
  const you = seatOf(view, view.you.playerId);
  if (!you || you.takeoverAt === null) return { ui };

  // Below the halfway mark the seat is plainly active and a stamp buys nothing.
  // Once a bot has it, every interaction is an attempt to take it back.
  const span = you.takeoverAt - you.idleSince;
  if (!you.takenOver && now - you.idleSince <= span * WARN_FRACTION) return { ui };
  if (ui.lastPresentAt !== undefined && now - ui.lastPresentAt < PRESENT_THROTTLE_MS) return { ui };
  return { ui: { ...ui, lastPresentAt: now }, action: { type: 'present' } };
}

/* -------------------------------------------------------------- the diff */

/**
 * What changed in your own hand between two views.
 *
 * No event carries this — events are counts only, permanently — so the one
 * moment of drama in the loop is learned the way the client learns everything
 * else: by diffing. The driver applies one action per push, so a diff is one
 * trade and is unambiguous. This is also the concrete argument for pushing
 * whole views rather than deltas.
 *
 * @param {{ [c: string]: number }} previousHand
 * @param {{ [c: string]: number }} nextHand
 * @returns {{ got: { commodity: string, count: number } | null, gave: { commodity: string, count: number } | null } | null}
 */
export function receiptFor(previousHand, nextHand) {
  let got = null;
  let gave = null;
  for (const commodity of new Set([...Object.keys(previousHand), ...Object.keys(nextHand)])) {
    const delta = (nextHand[commodity] || 0) - (previousHand[commodity] || 0);
    if (delta > 0 && (got === null || delta > got.count)) got = { commodity, count: delta };
    if (delta < 0 && (gave === null || -delta > gave.count)) gave = { commodity, count: -delta };
  }
  if (got === null && gave === null) return null;
  return { got, gave };
}

/* ------------------------------------------------------------- the screen */

/** What a refusal from the rules module says out loud. */
const REFUSALS = {
  taken: 'Somebody got there first.',
  cards: 'Not enough of those.',
  'live-offer': 'You already have one on the table.',
  'own-offer': 'That one is yours.',
  'no-corner': 'Not nine of a kind yet.',
  paused: 'The game is paused.',
  phase: 'Not right now.',
};

/**
 * Everything `table.js` paints, resolved. No field on it needs interpreting and
 * no decision is left in it.
 *
 * @param {object} view
 * @param {object} ui
 * @param {number} now
 * @returns {object} Screen
 */
export function present(view, ui, now) {
  const settled = reconcile(view, ui);
  const mode = settled.ui;
  const paused = view.pausedAt !== null;
  const live = isLive(view);
  const you = seatOf(view, view.you.playerId);
  const yours = you !== null && you.takenOver;

  const largest = view.commodities.reduce(
    (best, c) => (holds(view, c) > holds(view, best) ? c : best),
    view.commodities[0],
  );

  const hand = view.commodities.map((commodity) => {
    const count = holds(view, commodity);
    const payable = mode.mode === 'pay' && count >= (offerOf(view, mode.offerId)?.count ?? Infinity);
    return {
      commodity,
      name: nameOf(commodity),
      tint: COMMODITIES[commodity].tint,
      art: artFor(commodity),
      value: view.values[commodity],
      count,
      selected: mode.mode === 'compose' && mode.commodity === commodity,
      tappable: live && (mode.mode === 'pay' ? payable : count > 0 && !view.you.offer),
      // The hand is the target tracker: the largest group carries the ring and
      // its readout, so there is no second widget duplicating a number that is
      // already on the screen.
      ringed: commodity === largest && count > 0,
      progress: commodity === largest && count > 0 ? `${count}/${HAND}` : null,
    };
  });

  const offers = view.offers.map((offer) => {
    const seat = seatOf(view, offer.playerId);
    return {
      id: offer.id,
      playerId: offer.playerId,
      name: seat ? seat.name : offer.playerId,
      count: offer.count,
      mine: offer.mine,
      // Your own offer's commodity is yours to see, and only yours.
      commodity: offer.mine && view.you.offer ? view.you.offer.commodity : null,
      commodityName: offer.mine && view.you.offer ? nameOf(view.you.offer.commodity) : null,
      expiresAt: offer.expiresAt,
      msLeft: Math.max(0, offer.expiresAt - now),
      // Read from the view, never recomputed: the rule lives on the far side of
      // the confidentiality boundary and this side only reports it.
      greyed: !offer.matchable && !offer.mine,
      tappable: live && !offer.mine && offer.matchable,
      selected: mode.mode === 'pay' && mode.offerId === offer.id,
    };
  });

  const seats = view.seats.map((seat) => {
    const span = seat.takeoverAt === null ? 0 : seat.takeoverAt - seat.idleSince;
    const away = seat.takeoverAt !== null && !seat.takenOver && !paused
      && now - seat.idleSince > span * WARN_FRACTION;
    return {
      playerId: seat.playerId,
      name: seat.name,
      isBot: seat.isBot,
      you: seat.playerId === view.you.playerId,
      cards: seat.cards,
      score: seat.score,
      ready: seat.ready,
      takenOver: seat.takenOver,
      // Dimmed for the rest of the round, which is how a zero at the reveal has
      // an explanation attached to it.
      forfeited: seat.forfeited,
      away,
      awaySeconds: away ? Math.max(0, Math.ceil((seat.takeoverAt - now) / 1000)) : null,
      takeoverAt: seat.takeoverAt,
    };
  });

  return {
    ui: mode,
    round: view.round,
    phase: view.phase,
    target: view.target,
    paused,
    // Drawn from `view.abandon`, never from the event: a client that joined
    // mid-proposal never saw one.
    abandon: view.abandon === null ? null : {
      by: view.abandon.by,
      name: (seatOf(view, view.abandon.by) ?? { name: view.abandon.by }).name,
      yours: view.abandon.by === view.you.playerId,
    },
    menu: mode.menu === true,
    seats,
    offers,
    hand,
    counts: mode.mode === 'compose'
      ? Array.from({ length: offerCap(view, mode.commodity) }, (_, i) => i + 1)
      : [],
    harvest: { enabled: live && view.you.canHarvest, label: 'Harvest!' },
    line: lineFor(view, mode, settled.lost, yours, ui),
    roundEnd: view.phase === 'roundEnd' && view.harvest ? roundEndFor(view) : null,
    over: view.phase === 'over' || view.phase === 'abandoned',
  };
}

/**
 * The line holds its height when it is empty and never grows: a live board that
 * reflows under a finger produces mis-taps, and a mis-tap here is a trade.
 */
function lineFor(view, mode, lost, yours, ui) {
  // The one line on this screen that is not a receipt and does not clear
  // itself. It outranks everything, because nothing else on the screen explains
  // why your cards are moving without you.
  if (yours) return { kind: 'reclaim', text: 'A bot is playing your seat — tap anything to take it back' };
  if (view.pausedAt !== null) return { kind: 'paused', text: '' };
  if (view.phase === 'abandoned') return { kind: 'over', text: 'Game ended.' };
  if (view.phase === 'over') return { kind: 'over', text: 'That is the game.' };
  if (lost === 'offer') return { kind: 'gone', text: 'Gone' };
  if (lost === 'cards') return { kind: 'gone', text: 'Gone' };

  if (mode.mode === 'compose') return { kind: 'compose', text: `How many ${nameOf(mode.commodity)} cards?` };
  if (mode.mode === 'pay') return { kind: 'pay', text: "Tap what you'll trade" };

  if (ui.refusal && REFUSALS[ui.refusal]) return { kind: 'refusal', text: REFUSALS[ui.refusal] };

  if (ui.receipt) {
    const { got, gave } = ui.receipt;
    if (got && gave) return { kind: 'receipt', text: `${nameOf(got.commodity)} ×${got.count} for ${nameOf(gave.commodity)} ×${gave.count}` };
    if (got) return { kind: 'receipt', text: `${nameOf(got.commodity)} ×${got.count}` };
    if (gave) return { kind: 'receipt', text: `Offered ${nameOf(gave.commodity)} ×${gave.count}` };
  }

  if (view.phase === 'roundEnd') return { kind: 'idle', text: '' };
  if (view.you.offer) return { kind: 'idle', text: 'On the table — tap it to take it back' };
  return { kind: 'idle', text: 'Tap a card to offer it' };
}

/* -------------------------------------------------------------- the reveal */

/**
 * The round-end reveal: the card, who filled the basket, and every seat's final
 * hand with the counts it offered.
 *
 * `../design.md` §4 — *this is where the count history retroactively becomes
 * readable and is a large part of the fun*. Everything on it is already in the
 * view: `reveal` carries every hand outside `trading`, `history` carries the
 * round's public events, and the rules module is not touched for any of it.
 */
function roundEndFor(view) {
  const { playerId, commodity, value, forfeited } = view.harvest;
  const seat = seatOf(view, playerId);
  const name = seat ? seat.name : playerId;
  const yours = playerId === view.you.playerId;
  // A zero with no explanation is the bug report that follows.
  const note = forfeited ? 'no points — a bot was playing' : `+${value}`;

  return {
    playerId,
    name,
    yours,
    commodity,
    commodityName: nameOf(commodity),
    card: cardFor(commodity),
    tint: COMMODITIES[commodity].tint,
    value,
    forfeited,
    // Your win looks different from theirs, and it needs no second asset.
    headline: yours ? 'You filled the basket' : `${name} filled the basket`,
    note,
    // Seat order, not score order: the order the strip uses and the one a
    // pre-reader navigates by position in.
    seats: view.seats.map((row) => revealSeat(view, row, note)),
    canReady: !view.you.ready,
    ready: view.you.ready,
  };
}

/** One seat's block: its score after the harvest, its final hand, its counts. */
function revealSeat(view, seat, note) {
  const harvester = seat.playerId === view.harvest.playerId;
  const hand = view.reveal?.[seat.playerId] ?? {};

  return {
    playerId: seat.playerId,
    name: seat.name,
    you: seat.playerId === view.you.playerId,
    harvester,
    // After the harvest, because that is what `view.seats` already carries.
    score: seat.score,
    // Only the seat that ended the round has anything to add to its score, so
    // only that seat carries the sentence explaining a zero.
    note: harvester ? note : null,
    // The same slots, the same order and the same art as the hand at the bottom
    // of the table: the panel is where a player checks their own reading of the
    // board, and a second layout for the same information is a second thing to
    // learn.
    hand: view.commodities.map((commodity) => ({
      commodity,
      name: nameOf(commodity),
      art: artFor(commodity),
      tint: COMMODITIES[commodity].tint,
      count: hand[commodity] ?? 0,
      // The nine that ended it, visible rather than counted.
      ringed: harvester && commodity === view.harvest.commodity,
    })),
    ...countsOffered(view, seat.playerId),
  };
}

/**
 * What this seat offered this round, in order.
 *
 * `Bo: 3` three times is information nobody can use while it is happening;
 * against Bo's final hand of eight kiwis it says what Bo was doing all round.
 * `offer` events only — withdrawals and expiries are noise at this width — and
 * no commodity of anybody else's is in `history` to leak.
 */
function countsOffered(view, playerId) {
  const all = view.history
    .filter((event) => event.kind === 'offer' && event.playerId === playerId)
    .map((event) => event.count);
  return { counts: all.slice(0, COUNTS_SHOWN), more: all.length > COUNTS_SHOWN };
}

/* -------------------------------------------------------------- the ending */

/** *2 baskets*, and nothing at all for a seat that cornered none. */
function basketsLabel(corners) {
  if (!corners) return '';
  return corners === 1 ? '1 basket' : `${corners} baskets`;
}

/** What the record's sentence says, as a value rather than a string in `app.js`. */
const RECORD_NOTES = {
  saving: 'Saving…',
  saved: 'Saved to the gameroom.',
  failed: 'Not saved — no answer from the gameroom.',
  none: 'Nothing to save.',
};

/**
 * The end of a session: the headline, the standings, and whether it was written
 * down.
 *
 * `outcome` is what the driver's `onComplete` carried — `isComplete`'s object,
 * whose seats are already ordered and already ranked, ties sharing a rank. The
 * client does not recompute either. An abandoned session reaches `isComplete`
 * as null and arrives here as `{ abandoned: true, seats }` off the view, which
 * is a session with standings and no ranks, because there were none.
 *
 * @param {{ abandoned?: boolean, seats: object[] }} outcome
 * @param {'saving' | 'saved' | 'failed' | 'none'} record
 * @param {string} you the viewer's playerId
 * @returns {{ headline: string, rows: object[], note: string }}
 */
export function endingFor(outcome, record, you) {
  const rows = (outcome?.seats ?? []).map((seat) => ({
    playerId: seat.playerId,
    name: seat.name,
    you: seat.playerId === you,
    rank: seat.rank ?? null,
    score: seat.score,
    corners: seat.corners ?? 0,
    baskets: basketsLabel(seat.corners ?? 0),
  }));

  const winners = rows.filter((row) => row.rank === 1);
  const abandoned = outcome === null || outcome.abandoned === true;
  const headline = abandoned ? 'Game ended.'
    : winners.some((row) => row.you) ? 'You won.'
      : winners.length ? `${winners[0].name} won.`
        : 'That is the game.';

  return { headline, rows, note: RECORD_NOTES[record] ?? RECORD_NOTES.none };
}
