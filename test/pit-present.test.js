// The table's decisions, asserted against real views.
//
// The views here come out of `core/rules.js` rather than out of a fixture: the
// point of `present.js` is that it reads a view and computes nothing, and a
// hand-written view is a place for the two to drift apart without CI noticing.
//
// `table.js` is not tested and cannot be — there is no jsdom, because there are
// no dependencies. Everything worth asserting is therefore here.

import test from 'node:test';
import assert from 'node:assert/strict';

import { HAND, MAX_OFFER, COMMODITIES } from '../public/pit/core/commodities.js';
import {
  init, apply, validate, view, tick, isComplete,
  minPlayers, maxPlayers, IDLE_TAKEOVER_MS, OFFER_TTL_MS,
} from '../public/pit/core/rules.js';
import {
  idle, onTap, onInteraction, present, receiptFor, endingFor, artFor, cardFor,
  PRESENT_THROTTLE_MS,
} from '../public/pit/ui/present.js';

const table = (n) => Array.from({ length: n }, (_, i) => ({ playerId: `p${i}`, name: `P${i}` }));

/** Every seat holding one commodity: a corner apiece, and no accept possible. */
function oneEach(state) {
  const hands = {};
  state.seats.forEach((seat, index) => { hands[seat.playerId] = { [state.commodities[index]]: HAND }; });
  return { ...state, hands, offers: [] };
}

/** A spread hand for p0, so several groups are non-empty at once. */
function spread(state) {
  const hands = {};
  const deck = [];
  for (const c of state.commodities) for (let i = 0; i < HAND; i++) deck.push(c);
  state.seats.forEach((seat, index) => {
    hands[seat.playerId] = {};
    for (let i = 0; i < HAND; i++) {
      const c = deck[(index + i * state.seats.length) % deck.length];
      hands[seat.playerId][c] = (hands[seat.playerId][c] ?? 0) + 1;
    }
  });
  return { ...state, hands, offers: [] };
}

const seeded = (state, now = 0) => tick(state, now).state;
const act = (state, actor, action, now) => {
  const check = validate(state, actor, action);
  assert.ok(check.ok, `${actor} ${action.type}: ${check.reason}`);
  return apply(state, actor, action, now).state;
};

const base = () => seeded(spread(init(table(4), {}, 'present')), 0);

/* ----------------------------------------------------------- mode machine */

test('a tap on a group composes, and the count row is 1..min(held, MAX_OFFER)', () => {
  const state = base();
  const v = view(state, 'p0');
  const commodity = v.commodities.find((c) => v.you.hand[c] >= 1);

  const composed = onTap(idle, v, { kind: 'group', commodity });
  assert.equal(composed.action, undefined);
  assert.deepEqual(composed.ui, { mode: 'compose', commodity });

  const screen = present(v, composed.ui, 0);
  assert.deepEqual(screen.counts, Array.from(
    { length: Math.min(v.you.hand[commodity], MAX_OFFER) }, (_, i) => i + 1,
  ));
  assert.equal(screen.line.kind, 'compose');
  assert.ok(screen.hand.find((slot) => slot.commodity === commodity).selected);
});

test('a group of zero never composes and never offers a count', () => {
  const state = base();
  const empty = { ...state, hands: { ...state.hands, p0: { [state.commodities[0]]: HAND } } };
  const v = view(empty, 'p0');
  const zero = v.commodities[1];
  assert.equal(v.you.hand[zero], undefined);

  const tapped = onTap(idle, v, { kind: 'group', commodity: zero });
  assert.equal(tapped.ui.mode, 'idle');
  assert.equal(tapped.action, undefined);
  assert.equal(present(v, idle, 0).hand.find((slot) => slot.commodity === zero).tappable, false);
});

test('a tap on a count sends the offer and drops back to idle', () => {
  const v = view(base(), 'p0');
  const commodity = v.commodities.find((c) => v.you.hand[c] >= 2);
  const composed = onTap(idle, v, { kind: 'group', commodity }).ui;

  const sent = onTap(composed, v, { kind: 'count', n: 2 });
  assert.deepEqual(sent.action, { type: 'offer', commodity, count: 2 });
  assert.equal(sent.ui.mode, 'idle');

  // Never more than the cap, whatever the screen asked for.
  assert.equal(onTap(composed, v, { kind: 'count', n: MAX_OFFER + 1 }).action, undefined);
  assert.equal(onTap(composed, v, { kind: 'count', n: 0 }).action, undefined);
});

test('a tap on an offer pays, and groups below its count grey out', () => {
  let state = base();
  const commodity = view(state, 'p1').commodities.find((c) => state.hands.p1[c] >= 3);
  state = act(state, 'p1', { type: 'offer', commodity, count: 3 }, 100);
  const v = view(state, 'p0');
  const offer = v.offers[0];

  const paying = onTap(idle, v, { kind: 'offer', id: offer.id });
  assert.equal(paying.action, undefined);
  assert.equal(paying.ui.mode, 'pay');

  const screen = present(v, paying.ui, 200);
  assert.equal(screen.line.kind, 'pay');
  for (const slot of screen.hand) assert.equal(slot.tappable, slot.count >= offer.count, slot.commodity);

  const payWith = screen.hand.find((slot) => slot.tappable).commodity;
  const sent = onTap(paying.ui, v, { kind: 'group', commodity: payWith });
  assert.deepEqual(sent.action, { type: 'accept', offerId: offer.id, commodity: payWith });
  assert.equal(sent.ui.mode, 'idle');

  // The same row again cancels, and sends nothing.
  const cancelled = onTap(paying.ui, v, { kind: 'offer', id: offer.id });
  assert.equal(cancelled.ui.mode, 'idle');
  assert.equal(cancelled.action, undefined);
});

test('your own offer carries Withdraw rather than being tappable', () => {
  let state = base();
  const commodity = view(state, 'p0').commodities.find((c) => state.hands.p0[c] >= 1);
  state = act(state, 'p0', { type: 'offer', commodity, count: 1 }, 100);
  const v = view(state, 'p0');

  const row = present(v, idle, 200).offers[0];
  assert.equal(row.mine, true);
  assert.equal(row.tappable, false);
  assert.equal(row.commodity, commodity, 'your own offer’s commodity is yours to see');

  assert.equal(onTap(idle, v, { kind: 'offer', id: row.id }).action, undefined);
  assert.deepEqual(onTap(idle, v, { kind: 'withdraw' }).action, { type: 'withdraw' });
  // And a second offer is not composable while one is live.
  assert.equal(onTap(idle, v, { kind: 'group', commodity }).ui.mode, 'idle');
});

/* -------------------------------------------------------- self-cancelling */

test('a pay whose offer is gone drops to idle and says so', () => {
  let state = base();
  const commodity = view(state, 'p1').commodities.find((c) => state.hands.p1[c] >= 1);
  state = act(state, 'p1', { type: 'offer', commodity, count: 1 }, 100);
  const before = view(state, 'p0');
  const paying = onTap(idle, before, { kind: 'offer', id: before.offers[0].id }).ui;

  const after = view(act(state, 'p1', { type: 'withdraw' }, 200), 'p0');
  const screen = present(after, paying, 300);
  assert.equal(screen.ui.mode, 'idle');
  assert.equal(screen.line.text, 'Gone');
  assert.equal(onTap(paying, after, { kind: 'group', commodity }).action, undefined);
});

test('a compose on a commodity the hand no longer holds drops to idle', () => {
  const state = base();
  const before = view(state, 'p0');
  const commodity = before.commodities.find((c) => before.you.hand[c] >= 1);
  const composed = onTap(idle, before, { kind: 'group', commodity }).ui;

  const emptied = { ...state, hands: { ...state.hands, p0: { [before.commodities.find((c) => c !== commodity)]: HAND } } };
  const screen = present(view(emptied, 'p0'), composed, 400);
  assert.equal(screen.ui.mode, 'idle');
  assert.equal(screen.line.text, 'Gone');
  assert.deepEqual(screen.counts, []);
});

/* ---------------------------------------------------- the greying matches */

test('every offer row’s tappability is the view’s matchable and nothing else', () => {
  for (let seats = minPlayers; seats <= maxPlayers; seats++) {
    for (let seed = 0; seed < 12; seed++) {
      let state = seeded(init(table(seats), {}, `grey-${seats}-${seed}`), 0);
      let now = 0;
      // Let the table trade itself into an assortment of hands and offers.
      for (let i = 0; i < 40; i++) {
        now += 400;
        const actor = state.seats[i % seats].playerId;
        const hand = state.hands[actor];
        const commodity = Object.keys(hand)[i % Math.max(1, Object.keys(hand).length)];
        const count = Math.min(hand[commodity] ?? 0, 1 + (i % MAX_OFFER));
        const action = i % 3 === 0
          ? { type: 'offer', commodity, count }
          : { type: 'accept', offerId: (state.offers[0] ?? {}).id, commodity };
        if (count > 0 && validate(state, actor, action).ok) state = apply(state, actor, action, now).state;
      }
      if (state.phase !== 'trading') continue;

      const v = view(state, 'p0');
      const screen = present(v, idle, now);
      screen.offers.forEach((row, index) => {
        const source = v.offers[index];
        assert.equal(row.tappable, !source.mine && source.matchable, `${seats}/${seed} row ${index}`);
        // Nothing tappable that the rules module would refuse.
        if (row.tappable) {
          const payWith = screen.hand.find((slot) => slot.count >= row.count).commodity;
          assert.ok(validate(state, 'p0', { type: 'accept', offerId: row.id, commodity: payWith }).ok);
        }
      });
    }
  }
});

/* ------------------------------------------------------------- the pause */

test('nothing under the scrim is tappable, and resume and abandon still are', () => {
  let state = base();
  const commodity = view(state, 'p1').commodities.find((c) => state.hands.p1[c] >= 1);
  state = act(state, 'p1', { type: 'offer', commodity, count: 1 }, 100);
  state = act(state, 'p0', { type: 'pause' }, 200);
  const v = view(state, 'p0');
  const screen = present(v, idle, 300);

  assert.equal(screen.paused, true);
  assert.ok(screen.hand.every((slot) => !slot.tappable));
  assert.ok(screen.offers.every((row) => !row.tappable));
  assert.equal(screen.harvest.enabled, false);

  for (const target of [
    { kind: 'group', commodity }, { kind: 'offer', id: v.offers[0].id },
    { kind: 'harvest' }, { kind: 'ready' }, { kind: 'count', n: 1 }, { kind: 'withdraw' },
  ]) {
    assert.equal(onTap(idle, v, target).action, undefined, target.kind);
  }
  assert.deepEqual(onTap(idle, v, { kind: 'resume' }).action, { type: 'resume' });
  assert.deepEqual(onTap(idle, v, { kind: 'abandon' }).action, { type: 'abandon' });
});

test('a pause drops a half-composed offer, so resuming does not resume into it', () => {
  let state = base();
  const before = view(state, 'p0');
  const commodity = before.commodities.find((c) => before.you.hand[c] >= 1);
  const composed = onTap(idle, before, { kind: 'group', commodity }).ui;

  const paused = view(act(state, 'p0', { type: 'pause' }, 200), 'p0');
  assert.equal(present(paused, composed, 300).ui.mode, 'idle');
});

/* -------------------------------------------------------------- the hand */

test('the hand is exactly view.commodities, in order, zeros included', () => {
  for (let seats = minPlayers; seats <= maxPlayers; seats++) {
    const state = seeded(oneEach(init(table(seats), {}, `hand-${seats}`)), 0);
    const v = view(state, 'p0');
    const screen = present(v, idle, 0);

    assert.deepEqual(screen.hand.map((slot) => slot.commodity), v.commodities);
    assert.equal(screen.hand.length, seats);
    assert.equal(screen.hand.filter((slot) => slot.count === 0).length, seats - 1);

    const ringed = screen.hand.filter((slot) => slot.ringed);
    assert.equal(ringed.length, 1);
    assert.equal(ringed[0].count, HAND);
    assert.equal(ringed[0].progress, `${HAND}/${HAND}`);
    for (const slot of screen.hand) {
      assert.equal(slot.tint, COMMODITIES[slot.commodity].tint);
      assert.equal(slot.art, artFor(slot.commodity));
    }
  }
});

test('the ring sits on the largest group and reads held over the hand size', () => {
  const v = view(base(), 'p0');
  const screen = present(v, idle, 0);
  const largest = screen.hand.reduce((best, slot) => (slot.count > best.count ? slot : best));
  assert.equal(screen.hand.find((slot) => slot.ringed).commodity, largest.commodity);
  assert.equal(largest.progress, `${largest.count}/${HAND}`);
});

/* ----------------------------------------------------------- the receipt */

test('the receipt is a diff of your own hand', () => {
  assert.equal(receiptFor({ a: 3, b: 2 }, { a: 3, b: 2 }), null);
  assert.deepEqual(receiptFor({ a: 3, b: 2 }, { a: 6, b: 2 }), {
    got: { commodity: 'a', count: 3 }, gave: null,
  });
  // An offer posted: cards left and none came back.
  assert.deepEqual(receiptFor({ a: 3, b: 2 }, { a: 1, b: 2 }), {
    got: null, gave: { commodity: 'a', count: 2 },
  });
  // A blind swap: three out, three in.
  assert.deepEqual(receiptFor({ a: 3, b: 4 }, { b: 4, c: 3 }), {
    got: { commodity: 'c', count: 3 }, gave: { commodity: 'a', count: 3 },
  });
});

test('an accepted trade produces the line a player reads it off', () => {
  let state = base();
  const offered = view(state, 'p1').commodities.find((c) => state.hands.p1[c] >= 2);
  state = act(state, 'p1', { type: 'offer', commodity: offered, count: 2 }, 100);
  const before = view(state, 'p0').you.hand;
  const paid = Object.keys(before).find((c) => before[c] >= 2 && c !== offered);

  state = act(state, 'p0', { type: 'accept', offerId: state.offers[0].id, commodity: paid }, 200);
  const after = view(state, 'p0');
  const receipt = receiptFor(before, after.you.hand);
  assert.deepEqual(receipt.got, { commodity: offered, count: 2 });
  assert.deepEqual(receipt.gave, { commodity: paid, count: 2 });

  const line = present(after, { ...idle, receipt }, 300).line;
  assert.equal(line.kind, 'receipt');
  assert.equal(line.text, `${COMMODITIES[offered].name} ×2 for ${COMMODITIES[paid].name} ×2`);
});

/* --------------------------------------------------------- the idle chip */

test('a chip says nothing before the halfway mark and counts down after it', () => {
  const state = base();
  const v = view(state, 'p0');
  const window = v.seats[0].takeoverAt - v.seats[0].idleSince;

  const quiet = present(v, idle, window * 0.5).seats[0];
  assert.equal(quiet.away, false);
  assert.equal(quiet.awaySeconds, null);

  const warned = present(v, idle, window * 0.5 + 1000).seats[0];
  assert.equal(warned.away, true);
  assert.equal(warned.awaySeconds, Math.ceil((window * 0.5 - 1000) / 1000));
});

test('a taken-over seat reads as a bot, dims its score, and asks for itself back', () => {
  const state = tick(base(), IDLE_TAKEOVER_MS).state;
  const v = view(state, 'p0');
  const screen = present(v, idle, IDLE_TAKEOVER_MS);

  const you = screen.seats.find((seat) => seat.you);
  assert.equal(you.takenOver, true);
  assert.equal(you.forfeited, true);
  assert.equal(you.away, false, 'a countdown that already ran out is not a countdown');
  assert.equal(screen.line.kind, 'reclaim');

  // And it outranks a receipt, which is the one line that does not clear itself.
  const withReceipt = present(v, { ...idle, receipt: { got: null, gave: { commodity: v.commodities[0], count: 1 } } }, IDLE_TAKEOVER_MS);
  assert.equal(withReceipt.line.kind, 'reclaim');
});

/* ---------------------------------------------------- the presence stamp */

test('the presence stamp is throttled and reads no clock of its own', () => {
  const v = view(base(), 'p0');
  const window = v.seats[0].takeoverAt - v.seats[0].idleSince;

  const early = onInteraction(idle, v, window / 6);
  assert.equal(early.action, undefined);
  assert.equal(early.ui.lastPresentAt, undefined);

  const late = onInteraction(idle, v, window * 0.67);
  assert.deepEqual(late.action, { type: 'present' });
  assert.equal(late.ui.lastPresentAt, window * 0.67);

  const again = onInteraction(late.ui, v, window * 0.67 + PRESENT_THROTTLE_MS - 1);
  assert.equal(again.action, undefined);
  const allowed = onInteraction(late.ui, v, window * 0.67 + PRESENT_THROTTLE_MS);
  assert.deepEqual(allowed.action, { type: 'present' });
});

test('every interaction on a taken-over seat is an attempt to reclaim it', () => {
  const state = tick(base(), IDLE_TAKEOVER_MS).state;
  const v = view(state, 'p0');
  assert.deepEqual(onInteraction(idle, v, IDLE_TAKEOVER_MS + 1).action, { type: 'present' });
});

/* ------------------------------------------------ harvest, and round end */

test('the harvest bar is dark until the view says it is legal', () => {
  const spreadOut = present(view(base(), 'p0'), idle, 0);
  assert.equal(spreadOut.harvest.enabled, false);
  assert.equal(onTap(idle, view(base(), 'p0'), { kind: 'harvest' }).action, undefined);

  const cornered = view(seeded(oneEach(init(table(4), {}, 'corner')), 0), 'p0');
  assert.equal(present(cornered, idle, 0).harvest.enabled, true);
  assert.deepEqual(onTap(idle, cornered, { kind: 'harvest' }).action, { type: 'harvest' });
});

test('the round-end panel says what was harvested, and why a zero is a zero', () => {
  const state = seeded(oneEach(init(table(4), {}, 'ending')), 0);
  const scored = view(act(state, 'p0', { type: 'harvest' }, 1000), 'p0');
  const panel = present(scored, idle, 1000).roundEnd;
  assert.equal(panel.yours, true);
  assert.equal(panel.forfeited, false);
  assert.equal(panel.note, `+${scored.values[panel.commodity]}`);
  assert.equal(panel.canReady, true);
  assert.deepEqual(onTap(idle, scored, { kind: 'ready' }).action, { type: 'ready' });

  const taken = tick(state, IDLE_TAKEOVER_MS).state;
  const forfeited = view(act(taken, 'p0', { type: 'harvest' }, IDLE_TAKEOVER_MS + 1), 'p0');
  const dry = present(forfeited, idle, IDLE_TAKEOVER_MS + 1).roundEnd;
  assert.equal(dry.forfeited, true);
  assert.equal(dry.value, 0);
  assert.equal(dry.note, 'no points — a bot was playing');
});

/* ---------------------------------------------------------- the reveal */

/** A corner for one seat, leaving everybody else's hand and the history alone. */
const stack = (state, playerId) => ({
  ...state,
  hands: { ...state.hands, [playerId]: { [state.commodities[0]]: HAND } },
  offers: [],
});

test('the reveal is every seat, in seat order, holding its own final hand', () => {
  const state = seeded(oneEach(init(table(4), {}, 'reveal')), 0);
  const done = act(state, 'p0', { type: 'harvest' }, 1000);
  const v = view(done, 'p2');
  const panel = present(v, idle, 1000).roundEnd;

  assert.deepEqual(panel.seats.map((seat) => seat.playerId), v.seats.map((seat) => seat.playerId));
  assert.equal(panel.card, cardFor(panel.commodity));
  assert.equal(panel.headline, 'P0 filled the basket');

  for (const seat of panel.seats) {
    assert.deepEqual(seat.hand.map((slot) => slot.commodity), v.commodities, 'not the hand’s order');
    assert.deepEqual(
      seat.hand.map((slot) => slot.count),
      v.commodities.map((c) => v.reveal[seat.playerId][c] ?? 0),
      'a block is not showing that seat’s hand',
    );
    // Zeros included and greyed rather than dropped: position is how a
    // pre-reader finds a thing.
    assert.ok(seat.hand.some((slot) => slot.count === 0), 'a zero was dropped');
    assert.deepEqual(seat.hand.map((slot) => slot.art), v.commodities.map(artFor));
    assert.equal(seat.score, v.seats.find((row) => row.playerId === seat.playerId).score);
  }

  assert.equal(panel.seats.find((seat) => seat.playerId === 'p2').you, true);
  assert.equal(panel.seats.filter((seat) => seat.you).length, 1);

  // The nine that ended the round, and nothing else, carries the ring.
  const ringed = panel.seats.flatMap(
    (seat) => seat.hand.filter((slot) => slot.ringed).map((slot) => [seat.playerId, slot.commodity]),
  );
  assert.deepEqual(ringed, [['p0', panel.commodity]]);
});

test('only the seat that ended the round has anything added to its score', () => {
  const state = seeded(oneEach(init(table(4), {}, 'plus')), 0);
  const v = view(act(state, 'p0', { type: 'harvest' }, 1000), 'p0');
  const panel = present(v, idle, 1000).roundEnd;

  const notes = panel.seats.map((seat) => [seat.playerId, seat.note, seat.harvester]);
  assert.deepEqual(notes, [
    ['p0', `+${v.values[panel.commodity]}`, true],
    ['p1', null, false],
    ['p2', null, false],
    ['p3', null, false],
  ]);
  assert.equal(panel.headline, 'You filled the basket');

  // A forfeited harvester keeps the sentence and gets no plus, on the header
  // and on its own block: a zero with no explanation is the bug report that
  // follows.
  const taken = tick(state, IDLE_TAKEOVER_MS).state;
  const dry = view(act(taken, 'p0', { type: 'harvest' }, IDLE_TAKEOVER_MS + 1), 'p0');
  const forfeited = present(dry, idle, IDLE_TAKEOVER_MS + 1).roundEnd;
  assert.equal(forfeited.note, 'no points — a bot was playing');
  assert.equal(forfeited.seats.find((seat) => seat.harvester).note, forfeited.note);
  assert.equal(forfeited.seats.find((seat) => seat.harvester).score, 0);
});

test('a seat’s counts are its offers this round, in order, and nothing else', () => {
  let state = base();
  const commodity = view(state, 'p1').commodities.find((c) => state.hands.p1[c] >= 3);
  let now = 0;
  const offer = (count) => {
    state = act(state, 'p1', { type: 'offer', commodity, count }, (now += 100));
    state = act(state, 'p1', { type: 'withdraw' }, (now += 100));
  };
  for (const count of [3, 3, 2]) offer(count);

  const v = view(act(stack(state, 'p0'), 'p0', { type: 'harvest' }, (now += 100)), 'p0');
  const panel = present(v, idle, now).roundEnd;
  const seat = (id) => panel.seats.find((row) => row.playerId === id);

  assert.deepEqual(seat('p1').counts, [3, 3, 2]);
  assert.equal(seat('p1').more, false);
  // A seat that offered nothing shows nothing rather than an empty label.
  assert.deepEqual(seat('p2').counts, []);
  assert.equal(seat('p2').more, false);
  // No commodity of anybody else's is anywhere in it: history carries counts
  // and player ids, permanently.
  assert.equal(JSON.stringify(panel.seats.map((row) => row.counts)).includes(commodity), false);
});

test('a busy seat’s counts stop at six and say there were more', () => {
  let state = base();
  const commodity = view(state, 'p1').commodities.find((c) => state.hands.p1[c] >= 1);
  let now = 0;
  for (let i = 0; i < 8; i++) {
    state = act(state, 'p1', { type: 'offer', commodity, count: 1 }, (now += 100));
    state = act(state, 'p1', { type: 'withdraw' }, (now += 100));
  }
  const v = view(act(stack(state, 'p0'), 'p0', { type: 'harvest' }, (now += 100)), 'p0');
  const seat = present(v, idle, now).roundEnd.seats.find((row) => row.playerId === 'p1');

  assert.deepEqual(seat.counts, [1, 1, 1, 1, 1, 1]);
  assert.equal(seat.more, true);
});

test('the counts are this round’s, so the next deal starts them again', () => {
  let state = base();
  const commodity = view(state, 'p1').commodities.find((c) => state.hands.p1[c] >= 2);
  state = act(state, 'p1', { type: 'offer', commodity, count: 2 }, 100);
  state = act(state, 'p1', { type: 'withdraw' }, 200);
  state = act(stack(state, 'p0'), 'p0', { type: 'harvest' }, 300);
  for (const seat of state.seats) state = apply(state, seat.playerId, { type: 'ready' }, 400).state;

  const v = view(act(stack(state, 'p0'), 'p0', { type: 'harvest' }, 500), 'p0');
  const panel = present(v, idle, 500).roundEnd;
  assert.equal(v.round, 2);
  assert.deepEqual(panel.seats.find((row) => row.playerId === 'p1').counts, []);
});

/* ---------------------------------------------------------- the ending */

/** A finished session, ranked by the rules module rather than by this file. */
function finished(scores, corners) {
  const state = init(table(4), {}, 'ending');
  return isComplete({ ...state, phase: 'over', scores, corners });
}

test('the ending names the winner, and names you when it is you', () => {
  const outcome = finished({ p0: 300, p1: 120, p2: 60, p3: 0 }, { p0: 3, p1: 1, p2: 0, p3: 0 });

  assert.equal(endingFor(outcome, 'saved', 'p0').headline, 'You won.');
  assert.equal(endingFor(outcome, 'saved', 'p2').headline, 'P0 won.');

  const rows = endingFor(outcome, 'saved', 'p2').rows;
  assert.deepEqual(rows.map((row) => row.playerId), ['p0', 'p1', 'p2', 'p3']);
  assert.deepEqual(rows.map((row) => row.rank), [1, 2, 3, 4]);
  assert.deepEqual(rows.map((row) => row.baskets), ['3 baskets', '1 basket', '', '']);
  assert.deepEqual(rows.map((row) => row.you), [false, false, true, false]);
  assert.deepEqual(rows.map((row) => row.score), [300, 120, 60, 0]);
});

test('a tie shares first place and both rows read as rank 1', () => {
  const outcome = finished({ p0: 300, p1: 300, p2: 120, p3: 0 }, { p0: 1, p1: 2, p2: 0, p3: 0 });
  const rows = endingFor(outcome, 'saved', 'p3').rows;

  assert.deepEqual(rows.filter((row) => row.rank === 1).map((row) => row.playerId), ['p0', 'p1']);
  assert.deepEqual(rows.map((row) => row.rank), [1, 1, 3, 4]);
  // Either of them is the winner, and being one of them is still winning.
  assert.equal(endingFor(outcome, 'saved', 'p1').headline, 'You won.');
  assert.equal(endingFor(outcome, 'saved', 'p3').headline, 'P0 won.');
});

test('an abandoned session has standings and no ranks', () => {
  // One seat proposes and another seconds it; at a table of bots the bots do
  // the seconding, which is why one press ends it in `app.js`.
  const proposed = act(base(), 'p1', { type: 'abandon' }, 500);
  const v = view(act(proposed, 'p0', { type: 'abandon' }, 600), 'p0');
  assert.equal(v.phase, 'abandoned');

  const ending = endingFor({ abandoned: true, seats: v.seats }, 'none', 'p0');
  assert.equal(ending.headline, 'Game ended.');
  assert.equal(ending.note, 'Nothing to save.');
  assert.deepEqual(ending.rows.map((row) => row.rank), [null, null, null, null]);
  assert.deepEqual(ending.rows.map((row) => row.baskets), ['', '', '', '']);
  assert.deepEqual(ending.rows.map((row) => row.name), ['P0', 'P1', 'P2', 'P3']);
});

test('each of the four record states says something, and none says the same thing', () => {
  const outcome = finished({ p0: 300, p1: 0, p2: 0, p3: 0 }, { p0: 1, p1: 0, p2: 0, p3: 0 });
  const notes = ['saving', 'saved', 'failed', 'none'].map(
    (record) => endingFor(outcome, record, 'p0').note,
  );
  assert.equal(new Set(notes).size, notes.length, 'two record states read the same');
  for (const note of notes) assert.ok(note.length > 0, 'a record state says nothing');
  // A record that fails silently is a record nobody can trust.
  assert.match(endingFor(outcome, 'failed', 'p0').note, /^Not saved/);
});

/* ------------------------------------------------------------- countdown */

test('an offer row carries the milliseconds left, so the countdown is CSS', () => {
  let state = base();
  const commodity = view(state, 'p1').commodities.find((c) => state.hands.p1[c] >= 1);
  state = act(state, 'p1', { type: 'offer', commodity, count: 1 }, 1000);
  const v = view(state, 'p0');

  assert.equal(present(v, idle, 1000).offers[0].msLeft, OFFER_TTL_MS);
  assert.equal(present(v, idle, 1000 + OFFER_TTL_MS / 2).offers[0].msLeft, OFFER_TTL_MS / 2);
  assert.equal(present(v, idle, 9e9).offers[0].msLeft, 0, 'never negative');
});

/* --------------------------------------------------------------- abandon */

test('the abandon banner is drawn from the view, never from the event', () => {
  const state = base();
  assert.equal(present(view(state, 'p0'), idle, 0).abandon, null);

  const proposed = act(state, 'p1', { type: 'abandon' }, 500);
  const banner = present(view(proposed, 'p0'), idle, 600).abandon;
  assert.deepEqual(banner, { by: 'p1', name: 'P1', yours: false });
});
