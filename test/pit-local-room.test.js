// The driver, from the outside only.
//
// Nothing here reaches into state. Everything asserted is asserted off a view,
// an event or a refusal, because that is all a client gets and all the socket
// in Phase 7 will give it. A test that read state would pass against a driver
// the real room could never replace.

import test from 'node:test';
import assert from 'node:assert/strict';

import { mulberry32 } from '../public/pit/core/rng.js';
import { HAND, COMMODITY_KEYS } from '../public/pit/core/commodities.js';
import { tickIntervalMs } from '../public/pit/core/rules.js';
import { createLocalRoom, botSeats } from '../public/pit/room/local.js';

const HUMAN = { playerId: 'me', name: 'Me' };
const NAME_LIMIT = 8;

/**
 * A clock that never advances on its own, so a session that takes six rounds of
 * game time takes a few milliseconds of test time.
 */
function fakeClock() {
  let now = 0;
  const timers = [];
  return {
    now: () => now,
    every: (ms, fn) => {
      const timer = { ms, fn, live: true };
      timers.push(timer);
      return () => { timer.live = false; };
    },
    /** One tick of game time for every timer still running. */
    step(ms = tickIntervalMs) {
      now += ms;
      for (const timer of timers) if (timer.live) timer.fn();
    },
    running: () => timers.filter((timer) => timer.live).length,
  };
}

/**
 * Every card in the game, counted from a public view alone: what each seat is
 * holding plus what is sitting in an offer. This is the conservation check the
 * driver's tests can make, and the reason it is the right one is that a client
 * could make it too.
 */
function census(view) {
  const inHands = view.seats.reduce((sum, seat) => sum + seat.cards, 0);
  const inEscrow = view.offers.reduce((sum, offer) => sum + offer.count, 0);
  return inHands + inEscrow;
}

/** Nothing anywhere inside an event may name a commodity. */
function assertNoCommodity(value, where) {
  if (typeof value === 'string') {
    assert.ok(!COMMODITY_KEYS.includes(value), `${where} carries the commodity ${value}`);
    return;
  }
  if (value === null || typeof value !== 'object') return;
  for (const [key, inner] of Object.entries(value)) {
    assert.ok(!COMMODITY_KEYS.includes(key), `${where} carries the commodity ${key} as a key`);
    assertNoCommodity(inner, `${where}.${key}`);
  }
}

/** The offer this hand can cover without breaking its largest pile. */
function safeAccept(view) {
  const hand = view.you.hand;
  const most = Math.max(...Object.values(hand));
  const spare = Object.keys(hand).filter((c) => hand[c] < most || Object.keys(hand).length === 1);
  for (const offer of view.offers) {
    if (offer.mine) continue;
    const paying = spare.find((c) => hand[c] >= offer.count);
    if (paying) return { type: 'accept', offerId: offer.id, commodity: paying };
  }
  return null;
}

test('a session plays from the deal to the last point through the six methods', () => {
  const clock = fakeClock();
  const seats = [HUMAN, ...botSeats(3, 'normal', mulberry32(11))];
  const room = createLocalRoom({ seats, config: {}, seed: 'a-whole-session', clock });

  let latest = null;
  let views = 0;
  const events = [];
  const refusals = [];

  room.onView((view) => {
    latest = view;
    views++;
    assert.equal(census(view), view.commodities.length * HAND, `cards went missing in round ${view.round}`);
  });
  room.onEvent((event) => {
    events.push(event);
    assertNoCommodity(event, `event ${event.kind}`);
  });
  room.onRefusal((refusal) => refusals.push(refusal));

  room.join(HUMAN);
  assert.equal(views, 1, 'joining did not push a view');

  // The human harvests its own corner and presses through the reveal. It also
  // takes the occasional trade: a seat that never trades freezes nine cards for
  // the round, and with four seats that alone makes a corner unreachable in
  // most deals — nobody can hold nine of a commodity somebody else is sitting
  // on. That is a real property of the game and not of the bots.
  const LIMIT = 20000;
  let ticks = 0;
  while (latest.phase !== 'over' && ticks < LIMIT) {
    if (latest.you.canHarvest) room.act({ type: 'harvest' });
    else if (latest.phase === 'roundEnd' && !latest.you.ready) room.act({ type: 'ready' });
    else if (latest.phase === 'trading' && ticks % 7 === 0) {
      const trade = safeAccept(latest);
      if (trade) room.act(trade);
    }
    clock.step();
    ticks++;
  }

  assert.equal(latest.phase, 'over', `the session did not finish inside ${LIMIT} ticks`);
  assert.deepEqual(refusals, [], 'a legal action was refused');
  assert.ok(latest.round > 1, 'the session finished in one round');
  assert.ok(Math.max(...latest.seats.map((seat) => seat.score)) >= latest.target);
  assert.ok(events.some((event) => event.kind === 'trade'), 'nobody traded');
  assert.ok(events.some((event) => event.kind === 'harvest'), 'nobody cornered');
  assert.ok(events.some((event) => event.kind === 'over'), 'no event announced the end');

  room.leave();
});

test('the room has exactly the six members the contract names', () => {
  const room = createLocalRoom({ seats: [HUMAN, ...botSeats(2)], clock: fakeClock() });
  assert.deepEqual(
    Object.keys(room).sort(),
    ['act', 'join', 'leave', 'onEvent', 'onRefusal', 'onView'],
  );
});

test('an action before join refuses and pushes nothing', () => {
  const room = createLocalRoom({ seats: [HUMAN, ...botSeats(2)], seed: 'early', clock: fakeClock() });
  let views = 0;
  const refusals = [];
  room.onView(() => views++);
  room.onRefusal((refusal) => refusals.push(refusal));

  room.act({ type: 'harvest' });
  assert.equal(views, 0);
  assert.deepEqual(refusals.map((r) => r.reason), ['not-joined']);
});

test('an illegal action comes back as a refusal and pushes no view', () => {
  const clock = fakeClock();
  const room = createLocalRoom({ seats: [HUMAN, ...botSeats(2)], seed: 'illegal', clock });
  let views = 0;
  const refusals = [];
  room.onView(() => views++);
  room.onRefusal((refusal) => refusals.push(refusal));

  room.join(HUMAN);
  const after = views;
  room.act({ type: 'accept', offerId: 'no-such-offer', commodity: COMMODITY_KEYS[0] });
  room.act({ type: 'harvest' });
  room.act({ type: 'ready' });

  assert.equal(views, after, 'a refusal pushed a view');
  assert.deepEqual(refusals.map((r) => r.reason), ['taken', 'no-corner', 'phase']);
  assert.deepEqual(refusals[0].action, { type: 'accept', offerId: 'no-such-offer', commodity: COMMODITY_KEYS[0] });
});

test('the view arrives before the events that explain it', () => {
  const clock = fakeClock();
  const room = createLocalRoom({ seats: [HUMAN, ...botSeats(2)], seed: 'ordering', clock });
  const log = [];
  let latest = null;
  room.onView((view) => { latest = view; log.push('view'); });
  room.onEvent(() => log.push('event'));

  room.join(HUMAN);
  const commodity = Object.keys(latest.you.hand)[0];
  log.length = 0;
  room.act({ type: 'offer', commodity, count: 1 });
  assert.deepEqual(log, ['view', 'event']);

  // And the same on a tick that changed something: bots act inside tick, and
  // the client animates from the events after the view it can trust.
  log.length = 0;
  for (let i = 0; i < 40 && !log.includes('event'); i++) clock.step();
  assert.equal(log[0], 'view');
  assert.ok(log.includes('event'), 'forty ticks with nothing from the bots');
});

test('leaving stops the clock and the callbacks', () => {
  const clock = fakeClock();
  const room = createLocalRoom({ seats: [HUMAN, ...botSeats(3)], seed: 'leaving', clock });
  let views = 0;
  let events = 0;
  room.onView(() => views++);
  room.onEvent(() => events++);

  room.join(HUMAN);
  for (let i = 0; i < 20; i++) clock.step();
  const before = { views, events };
  assert.ok(before.views > 1, 'the tick never pushed anything');

  room.leave();
  assert.equal(clock.running(), 0, 'the timer is still running');
  for (let i = 0; i < 20; i++) clock.step();
  room.act({ type: 'harvest' });
  assert.deepEqual({ views, events }, before);

  room.leave(); // idempotent
});

test('a second join replaces the viewer on one connection', () => {
  const clock = fakeClock();
  const seats = [HUMAN, ...botSeats(2, 'easy', mulberry32(3))];
  const room = createLocalRoom({ seats, seed: 'rejoin', clock });
  let latest = null;
  room.onView((view) => { latest = view; });

  room.join(HUMAN);
  assert.equal(latest.you.playerId, 'me');
  room.join(seats[1]);
  assert.equal(latest.you.playerId, seats[1].playerId);
  assert.equal(clock.running(), 1, 'joining twice started a second clock');
});

test('bot seats are named here, not by the rules', () => {
  const seated = botSeats(4, 'hard', mulberry32(5));
  assert.deepEqual(seated.map((seat) => seat.playerId), ['bot-1', 'bot-2', 'bot-3', 'bot-4']);
  assert.ok(seated.every((seat) => seat.isBot === true && seat.botLevel === 'hard'));

  const names = seated.map((seat) => seat.name);
  assert.equal(new Set(names).size, names.length, 'a name was drawn twice');
  for (const name of names) {
    assert.ok(name.length <= NAME_LIMIT, `${name} is too long for the seat strip`);
    assert.ok(!/bot/i.test(name), `${name} announces itself as a bot`);
  }

  assert.deepEqual(botSeats(0), []);
  assert.throws(() => botSeats(-1), RangeError);
  assert.throws(() => botSeats(99), RangeError);
});
