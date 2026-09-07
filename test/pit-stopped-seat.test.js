// The seat whose player stopped: the idle clock, the bot that takes it over,
// the round it costs them, the pause that has to move four sets of clocks at
// once, and the two ways a session ends without a result.
//
// `../docs/pit/design.md` §2.6 is the argument for all of it; this file is the
// arithmetic. The pause test is the one the mechanism exists for — everything
// in State is an absolute timestamp, so a pause that only stopped `tick` would
// resume by expiring the whole board in one frame.

import test from 'node:test';
import assert from 'node:assert/strict';

import { HAND, MAX_OFFER } from '../public/pit/core/commodities.js';
import {
  init, validate, apply, view, tick, isComplete, handSize,
  OFFER_TTL_MS, REVEAL_BACKSTOP_MS, IDLE_TAKEOVER_MS, ABANDON_TTL_MS,
} from '../public/pit/core/rules.js';

/** All human, unless a count of bots is asked for. */
const table = (n, bots = 0) => Array.from({ length: n }, (_, i) => (
  i < n - bots
    ? { playerId: `p${i}`, name: `P${i}` }
    : { playerId: `p${i}`, name: `B${i}`, isBot: true, botLevel: 'normal' }
));

/** Every seat holding one commodity, so a corner is one trade away from anybody. */
function oneEach(state) {
  const hands = {};
  state.seats.forEach((seat, index) => { hands[seat.playerId] = { [state.commodities[index]]: HAND }; });
  return { ...state, hands, offers: [] };
}

/** One seat cornered, the rest holding what is left. */
function cornerFor(state, playerId) {
  const commodity = state.commodities[0];
  const others = state.seats.map((s) => s.playerId).filter((id) => id !== playerId);
  const hands = { [playerId]: { [commodity]: HAND } };
  for (const id of others) hands[id] = {};
  const rest = [];
  for (const c of state.commodities.slice(1)) for (let i = 0; i < HAND; i++) rest.push(c);
  rest.forEach((c, index) => {
    const id = others[index % others.length];
    hands[id][c] = (hands[id][c] ?? 0) + 1;
  });
  return { ...state, hands, offers: [] };
}

/** The first tick of a session is what seeds the clocks init has no `now` for. */
const seeded = (state, now = 0) => tick(state, now).state;

const act = (state, actor, action, now) => {
  const check = validate(state, actor, action);
  assert.ok(check.ok, `${actor} ${action.type} refused: ${check.reason}`);
  return apply(state, actor, action, now).state;
};

/* ------------------------------------------------------------------ clock */

test('the first tick stamps every seat, and the timer runs from there', () => {
  const state = seeded(init(table(4), {}, 'stamp'), 1000);
  for (const seat of state.seats) assert.equal(state.idleSince[seat.playerId], 1000);
  assert.deepEqual(tick(state, 1000 + IDLE_TAKEOVER_MS - 1).events, []);
});

test('every action stamps its actor and nobody else', () => {
  const base = seeded(oneEach(init(table(4), {}, 'stamps')), 0);
  const other = base.commodities[1];

  /** @type {[string, object][]} */
  const cases = [
    ['offer', { type: 'offer', commodity: base.commodities[0], count: 1 }],
    ['harvest', { type: 'harvest' }],
    ['pause', { type: 'pause' }],
    ['abandon', { type: 'abandon' }],
    ['present', { type: 'present' }],
  ];
  for (const [label, action] of cases) {
    const next = act(base, 'p0', action, 7000);
    assert.equal(next.idleSince.p0, 7000, label);
    for (const id of ['p1', 'p2', 'p3']) assert.equal(next.idleSince[id], 0, `${label} moved ${id}`);
  }

  // The three that need a board in a particular shape first.
  const posted = act(base, 'p0', { type: 'offer', commodity: base.commodities[0], count: 2 }, 100);
  assert.equal(act(posted, 'p0', { type: 'withdraw' }, 7000).idleSince.p0, 7000);
  const taker = act(posted, 'p1', { type: 'accept', offerId: posted.offers[0].id, commodity: other }, 7000);
  assert.equal(taker.idleSince.p1, 7000);
  assert.equal(taker.idleSince.p0, 100, 'the offerer is not made present by somebody else’s accept');

  const paused = act(base, 'p0', { type: 'pause' }, 100);
  assert.equal(act(paused, 'p1', { type: 'resume' }, 7000).idleSince.p1, 7000);

  const ended = act(cornerFor(base, 'p2'), 'p2', { type: 'harvest' }, 100);
  assert.equal(act(ended, 'p1', { type: 'ready' }, 7000).idleSince.p1, 7000);
});

test('disconnect stamps nobody — a socket that is gone is not a player who is there', () => {
  const base = seeded(oneEach(init(table(4), {}, 'gone')), 0);
  const posted = act(base, 'p0', { type: 'offer', commodity: base.commodities[0], count: 1 }, 100);
  const next = apply(posted, 'p0', { type: 'disconnect' }, 7000).state;
  assert.equal(next.idleSince.p0, 100, 'the disconnect moved the stamp its own offer set');
  assert.equal(next.offers.length, 0, 'the escrow still came home');
});

/* --------------------------------------------------------------- takeover */

test('takeover fires at exactly IDLE_TAKEOVER_MS and not a millisecond before', () => {
  const base = seeded(oneEach(init(table(4), {}, 'takeover')), 0);

  const early = tick(base, IDLE_TAKEOVER_MS - 1);
  assert.deepEqual(early.state.takenOver, []);
  assert.deepEqual(early.events, []);

  const late = tick(base, IDLE_TAKEOVER_MS);
  assert.deepEqual(late.state.takenOver, ['p0', 'p1', 'p2', 'p3']);
  assert.deepEqual(late.state.forfeit, ['p0', 'p1', 'p2', 'p3']);
  assert.deepEqual(late.events, base.seats.map((seat) => ({ kind: 'takeover', playerId: seat.playerId })));
});

test('a bot seat is never taken over', () => {
  const base = seeded(oneEach(init(table(4, 3), {}, 'botseats')), 0);
  const late = tick(base, IDLE_TAKEOVER_MS * 10).state;
  assert.deepEqual(late.takenOver, ['p0']);
});

test('a taken-over seat’s cards move, which is the bot actually driving it', () => {
  let state = seeded(init(table(4), {}, 'caretaker'), 0);
  const before = JSON.stringify(state.hands);
  let now = IDLE_TAKEOVER_MS;
  state = tick(state, now).state;
  assert.equal(state.takenOver.length, 4);

  // Long enough for the gates to open and a few actions to land.
  for (let i = 0; i < 200 && JSON.stringify(state.hands) === before; i++) {
    now += 500;
    state = tick(state, now).state;
  }
  assert.notEqual(JSON.stringify(state.hands), before, 'nobody played the abandoned seats');
});

test('any valid action reclaims the seat and leaves the forfeit standing', () => {
  const base = seeded(oneEach(init(table(4), {}, 'reclaim')), 0);
  const taken = tick(base, IDLE_TAKEOVER_MS).state;

  const done = apply(taken, 'p0', { type: 'present' }, IDLE_TAKEOVER_MS + 1);
  assert.deepEqual(done.state.takenOver, ['p1', 'p2', 'p3']);
  assert.ok(done.state.forfeit.includes('p0'), 'the round is still forfeited');
  assert.deepEqual(done.events, [{ kind: 'reclaim', playerId: 'p0' }]);
  assert.equal(done.state.idleSince.p0, IDLE_TAKEOVER_MS + 1);
});

test('the reveal does not wait on a taken-over seat', () => {
  const base = seeded(oneEach(init(table(4), {}, 'nowait')), 0);
  const taken = tick(base, IDLE_TAKEOVER_MS).state;
  // p0, p1 and p2 are back; p3 is still in a pocket.
  let state = taken;
  for (const id of ['p0', 'p1', 'p2']) state = act(state, id, { type: 'present' }, IDLE_TAKEOVER_MS + 1);
  assert.deepEqual(state.takenOver, ['p3']);

  state = act(cornerFor(state, 'p0'), 'p0', { type: 'harvest' }, IDLE_TAKEOVER_MS + 2);
  assert.equal(state.phase, 'roundEnd');
  for (const id of ['p0', 'p1', 'p2']) state = act(state, id, { type: 'ready' }, IDLE_TAKEOVER_MS + 3);
  assert.equal(state.phase, 'trading', 'p3 held the reveal open');
  assert.equal(state.round, 2);
});

/* ---------------------------------------------------------------- forfeit */

test('a forfeited corner scores nothing, ends the round, and moves nobody else', () => {
  const base = seeded(oneEach(init(table(4), {}, 'forfeit')), 0);
  const taken = tick(base, IDLE_TAKEOVER_MS).state;
  const done = apply(cornerFor(taken, 'p0'), 'p0', { type: 'harvest' }, IDLE_TAKEOVER_MS + 1);

  assert.equal(done.state.phase, 'roundEnd');
  assert.equal(done.state.harvest.forfeited, true);
  assert.equal(done.state.harvest.value, 0);
  for (const seat of done.state.seats) assert.equal(done.state.scores[seat.playerId], 0);
  assert.deepEqual(done.state.reveal, undefined);
  assert.deepEqual(view(done.state, 'p0').harvest.forfeited, true);
});

test('autoCorner takes the same path, so the penalty needs no second branch', () => {
  const base = seeded(init(table(4), { autoCorner: true }, 'auto'), 0);
  const taken = tick(base, IDLE_TAKEOVER_MS).state;
  const done = tick(cornerFor(taken, 'p0'), IDLE_TAKEOVER_MS + 1);

  assert.equal(done.state.phase, 'roundEnd');
  assert.equal(done.state.harvest.playerId, 'p0');
  assert.equal(done.state.harvest.value, 0);
  assert.equal(done.state.scores.p0, 0);
});

test('the deal clears the forfeit and the same seat scores normally after it', () => {
  const base = seeded(init(table(4), {}, 'nextround'), 0);
  let state = tick(base, IDLE_TAKEOVER_MS).state;
  // Everybody comes back before the round ends, so the reveal waits on all four
  // and the only thing left over from the takeover is the forfeit.
  for (const seat of state.seats) state = act(state, seat.playerId, { type: 'present' }, IDLE_TAKEOVER_MS + 1);
  assert.deepEqual(state.takenOver, []);

  state = act(cornerFor(state, 'p0'), 'p0', { type: 'harvest' }, IDLE_TAKEOVER_MS + 2);
  assert.equal(state.harvest.forfeited, true);
  for (const seat of state.seats) state = act(state, seat.playerId, { type: 'ready' }, IDLE_TAKEOVER_MS + 3);

  assert.equal(state.round, 2);
  assert.deepEqual(state.forfeit, []);

  const scored = act(cornerFor(state, 'p0'), 'p0', { type: 'harvest' }, IDLE_TAKEOVER_MS + 4);
  assert.equal(scored.harvest.forfeited, false);
  assert.equal(scored.scores.p0, scored.values[scored.commodities[0]]);
});

/* ------------------------------------------------------------------ pause */

test('a pause of any length resumes with every clock carrying the time it had', () => {
  const HOLD = 600000;
  let state = seeded(init(table(4, 2), {}, 'pauseclock'), 0);
  const [a, b] = [state.commodities.find((c) => state.hands.p0[c]), state.commodities.find((c) => state.hands.p1[c])];
  // Inside the shortest bot delay, so both gates are still shut when the pause
  // lands: the point of the assertion below is that the resume does not open
  // them, not that a bot which was already overdue stays quiet.
  state = act(state, 'p0', { type: 'offer', commodity: a, count: 1 }, 100);
  state = act(state, 'p1', { type: 'offer', commodity: b, count: 1 }, 200);
  // No further tick: the seeding one already set both bot gates, and another
  // would let a bot take one of the two offers off the board.
  const before = state;
  assert.equal(before.offers.length, 2);
  assert.equal(Object.keys(before.botsReadyAt).length, 2);

  const paused = act(before, 'p1', { type: 'pause' }, 300);
  assert.equal(tick(paused, 300 + HOLD).state, paused, 'a paused tick is a tick that did nothing');

  const resumed = act(paused, 'p2', { type: 'resume' }, 300 + HOLD);
  assert.equal(resumed.pausedAt, null);
  resumed.offers.forEach((offer, index) => {
    assert.equal(offer.expiresAt, before.offers[index].expiresAt + HOLD, `offer ${index}`);
  });
  for (const id of Object.keys(before.idleSince)) {
    // p1 paused and p2 resumed, so both carry the stamp of their own action.
    if (id === 'p1' || id === 'p2') continue;
    assert.equal(resumed.idleSince[id], before.idleSince[id] + HOLD, `idleSince ${id}`);
  }
  for (const id of Object.keys(before.botsReadyAt)) {
    assert.equal(resumed.botsReadyAt[id], before.botsReadyAt[id] + HOLD, `botsReadyAt ${id}`);
  }

  const first = tick(resumed, 300 + HOLD);
  assert.deepEqual(first.events, [], 'the first live tick expired, harvested or took over something');
  assert.equal(first.state.offers.length, 2, 'nothing expired on the frame after the resume');

});

test('an offer paused through resumes with the TTL it had left, to the millisecond', () => {
  const HOLD = 600000;
  // No bots: the point here is the expiry boundary, and a bot would take the
  // offer off the board before it got there.
  let state = seeded(init(table(4), {}, 'pausettl'), 0);
  const commodity = state.commodities.find((c) => state.hands.p0[c]);
  state = act(state, 'p0', { type: 'offer', commodity, count: 1 }, 100);
  state = act(state, 'p0', { type: 'pause' }, 5000);
  const resumed = act(state, 'p0', { type: 'resume' }, 5000 + HOLD);

  assert.equal(tick(resumed, 100 + HOLD + OFFER_TTL_MS - 1).state.offers.length, 1);
  const expired = tick(resumed, 100 + HOLD + OFFER_TTL_MS);
  assert.deepEqual(expired.events, [{ kind: 'expired', playerId: 'p0', count: 1 }]);
});

test('a pause during the reveal moves the backstop with it', () => {
  const HOLD = 600000;
  const base = seeded(init(table(4), {}, 'pausereveal'), 0);
  const before = act(cornerFor(base, 'p0'), 'p0', { type: 'harvest' }, 2000);
  assert.equal(before.roundEndsAt, 2000 + REVEAL_BACKSTOP_MS);

  const paused = act(before, 'p0', { type: 'pause' }, 3000);
  const resumed = act(paused, 'p0', { type: 'resume' }, 3000 + HOLD);
  assert.equal(resumed.roundEndsAt, before.roundEndsAt + HOLD);
  assert.equal(tick(resumed, resumed.roundEndsAt - 1).state.phase, 'roundEnd');
  assert.equal(tick(resumed, resumed.roundEndsAt).state.phase, 'trading');
});

test('a pause refuses everything but resume, abandon and present', () => {
  let state = seeded(oneEach(init(table(4), {}, 'refusals')), 0);
  const commodity = state.commodities[0];
  state = act(state, 'p1', { type: 'offer', commodity: state.commodities[1], count: 1 }, 100);
  const offerId = state.offers[0].id;
  state = cornerFor(state, 'p0');
  state = { ...state, offers: [{ ...state.offers[0] ?? {} }].filter((o) => o.id) };
  const paused = act({ ...state, offers: [] }, 'p0', { type: 'pause' }, 1000);

  for (const action of [
    { type: 'offer', commodity, count: 1 },
    { type: 'accept', offerId, commodity },
    { type: 'withdraw' },
    { type: 'harvest' },
    { type: 'ready' },
    { type: 'pause' },
  ]) {
    assert.deepEqual(validate(paused, 'p0', action), { ok: false, reason: 'paused' }, action.type);
  }
  for (const action of [{ type: 'resume' }, { type: 'abandon' }, { type: 'present' }]) {
    assert.deepEqual(validate(paused, 'p0', action), { ok: true }, action.type);
  }
  assert.deepEqual(validate(state, 'p0', { type: 'resume' }), { ok: false, reason: 'not-paused' });
});

test('pause, resume and abandon are refused once the session is over', () => {
  const over = { ...seeded(init(table(4), {}, 'done'), 0), phase: 'over' };
  for (const action of [{ type: 'pause' }, { type: 'resume' }, { type: 'abandon' }, { type: 'present' }]) {
    assert.deepEqual(validate(over, 'p0', action), { ok: false, reason: 'phase' }, action.type);
  }
});

/* ---------------------------------------------------------------- abandon */

test('one human at the table abandons in one press', () => {
  const state = seeded(init(table(4, 3), {}, 'alone'), 0);
  const done = apply(state, 'p0', { type: 'abandon' }, 1000);
  assert.equal(done.state.phase, 'abandoned');
  assert.deepEqual(done.events, [{ kind: 'abandoned' }]);
  assert.equal(isComplete(done.state), null, 'an abandoned session is not a result');
});

test('two humans: one proposes, the same seat cancels, a different seat ends it', () => {
  const base = seeded(init(table(4, 2), {}, 'two'), 0);

  const proposed = apply(base, 'p0', { type: 'abandon' }, 1000);
  assert.equal(proposed.state.phase, 'trading');
  assert.deepEqual(proposed.state.abandon, { by: 'p0', at: 1000 });
  assert.deepEqual(proposed.events, [{ kind: 'abandon-proposed', playerId: 'p0' }]);

  const cancelled = apply(proposed.state, 'p0', { type: 'abandon' }, 1100);
  assert.equal(cancelled.state.abandon, null);
  assert.equal(cancelled.state.phase, 'trading');

  const seconded = apply(proposed.state, 'p1', { type: 'abandon' }, 1200);
  assert.equal(seconded.state.phase, 'abandoned');
  assert.deepEqual(seconded.events, [{ kind: 'abandoned' }]);
});

test('a proposal nobody seconds clears itself', () => {
  const base = seeded(init(table(4, 2), {}, 'ttl'), 0);
  const proposed = apply(base, 'p0', { type: 'abandon' }, 1000).state;
  assert.notEqual(tick(proposed, 1000 + ABANDON_TTL_MS - 1).state.abandon, null);
  assert.equal(tick(proposed, 1000 + ABANDON_TTL_MS).state.abandon, null);
});

test('an abandoned session accepts nothing and emits no over', () => {
  const state = apply(seeded(init(table(4, 3), {}, 'closed'), 0), 'p0', { type: 'abandon' }, 1000).state;
  assert.equal(isComplete(state), null);
  for (const action of [{ type: 'offer', commodity: state.commodities[0], count: 1 }, { type: 'pause' }]) {
    assert.equal(validate(state, 'p0', action).ok, false, action.type);
  }
  assert.deepEqual(tick(state, 99999).events, []);
});
