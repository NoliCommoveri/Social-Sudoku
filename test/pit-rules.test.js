// Deals, trades, corners and scoring.
//
// The invariants are worth more than the cases: a trading game's bugs are
// conservation bugs, and a blind swap that creates a card is invisible in any
// single hand. So most of this file is randomized play with an assertion after
// every applied action.

import test from 'node:test';
import assert from 'node:assert/strict';

import { mulberry32, shuffled } from '../public/pit/core/rng.js';
import { HAND, MAX_OFFER, BASE_VALUE } from '../public/pit/core/commodities.js';
import {
  init, validate, apply, view, tick, isComplete,
  minPlayers, maxPlayers, defaultConfig, held, handSize, cornered,
  OFFER_TTL_MS, REVEAL_BACKSTOP_MS, IDLE_TAKEOVER_MS,
} from '../public/pit/core/rules.js';

const SEAT_COUNTS = Array.from({ length: maxPlayers - minPlayers + 1 }, (_, i) => minPlayers + i);
const table = (n) => Array.from({ length: n }, (_, i) => ({ playerId: `p${i}`, name: `P${i}` }));

/** Every card in the game, wherever it is sitting. */
function census(state) {
  const total = {};
  for (const c of state.commodities) total[c] = 0;
  for (const hand of Object.values(state.hands)) {
    for (const [c, n] of Object.entries(hand)) total[c] += n;
  }
  for (const offer of state.offers) total[offer.commodity] += offer.count;
  return total;
}

function assertConserved(state, where) {
  const total = census(state);
  for (const c of state.commodities) {
    assert.equal(total[c], HAND, `${c} count is ${total[c]} after ${where}`);
  }
  for (const [playerId, hand] of Object.entries(state.hands)) {
    for (const [c, n] of Object.entries(hand)) {
      assert.ok(n > 0, `${playerId} holds a zero-count key for ${c} after ${where}`);
      assert.ok(state.commodities.includes(c), `${playerId} holds ${c}, which is not in play`);
    }
  }
}

/** Every action this viewer could legally take right now, built from the view. */
function legalActions(v) {
  const out = [];
  if (v.phase === 'roundEnd') {
    if (!v.you.ready) out.push({ type: 'ready' });
    return out;
  }
  if (v.phase !== 'trading') return out;
  const hand = v.you.hand;
  if (v.you.canHarvest) out.push({ type: 'harvest' });
  if (v.you.offer) out.push({ type: 'withdraw' });
  else {
    for (const [c, n] of Object.entries(hand)) {
      for (let count = 1; count <= Math.min(MAX_OFFER, n); count++) out.push({ type: 'offer', commodity: c, count });
    }
  }
  for (const offer of v.offers) {
    if (offer.mine) continue;
    for (const [c, n] of Object.entries(hand)) {
      if (n >= offer.count) out.push({ type: 'accept', offerId: offer.id, commodity: c });
    }
  }
  return out;
}

/* --------------------------------------------------------------- the deal */

test('a deal gives every seat a full hand out of a full deck', () => {
  for (const seats of SEAT_COUNTS) {
    const state = init(table(seats), {}, seats);
    assert.equal(state.round, 1);
    assert.equal(state.phase, 'trading');
    assert.equal(state.commodities.length, seats);
    for (const seat of state.seats) {
      assert.equal(handSize(state.hands[seat.playerId]), HAND, `${seat.playerId} at ${seats} seats`);
      assert.equal(state.scores[seat.playerId], 0);
    }
    assertConserved(state, 'the deal');
  }
});

test('init refuses a table the deck cannot cover, and duplicate players', () => {
  assert.throws(() => init(table(minPlayers - 1), {}, 1), RangeError);
  assert.throws(() => init(table(maxPlayers + 1), {}, 1), RangeError);
  assert.throws(() => init([{ playerId: 'a' }, { playerId: 'a' }, { playerId: 'b' }], {}, 1), RangeError);
});

test('config falls back to the defaults, and a string seed is accepted', () => {
  const state = init(table(4), {}, 'a room code');
  assert.equal(state.target, defaultConfig.target);
  assert.equal(state.autoCorner, defaultConfig.autoCorner);
  assert.equal(typeof state.seed, 'number');
  assert.deepEqual(init(table(4), {}, 'a room code').hands, state.hands);
});

/* --------------------------------------------------------- conservation */

test('cards are conserved over randomized legal play, at every seat count', () => {
  for (const seats of SEAT_COUNTS) {
    const rng = mulberry32(seats * 1013 + 7);
    let state = init(table(seats), { target: BASE_VALUE * 3 }, seats);
    let now = 0;
    for (let step = 0; step < 400 && isComplete(state) === null; step++) {
      const seat = state.seats[Math.floor(rng() * state.seats.length)].playerId;
      const options = legalActions(view(state, seat));
      if (options.length) {
        const action = options[Math.floor(rng() * options.length)];
        const check = validate(state, seat, action);
        assert.ok(check.ok, `${seats} seats: ${action.type} refused with ${check.reason}`);
        state = apply(state, seat, action, now).state;
        assertConserved(state, `${action.type} at ${seats} seats`);
      }
      now += 300;
      state = tick(state, now).state;
      assertConserved(state, `tick at ${seats} seats`);
    }
  }
});

// Phase 6 writes this into Durable Object storage between two actions, so a
// state that does not survive a round trip is a state that loses a hand.
test('state survives a JSON round trip at every point in a round', () => {
  const rng = mulberry32(909);
  let state = init(table(4), { target: BASE_VALUE * 2 }, 'storage');
  let now = 0;
  for (let step = 0; step < 300 && isComplete(state) === null; step++) {
    assert.deepEqual(JSON.parse(JSON.stringify(state)), state, `step ${step} in phase ${state.phase}`);
    const seat = state.seats[Math.floor(rng() * state.seats.length)].playerId;
    const options = legalActions(view(state, seat));
    if (options.length) state = apply(state, seat, options[Math.floor(rng() * options.length)], now).state;
    now += 600;
    state = tick(state, now).state;
  }
});

/* ---------------------------------------------------------- determinism */

test('the same seed and the same actions give a byte-identical state, twice', () => {
  const run = () => {
    const rng = mulberry32(4242);
    let state = init(table(5), {}, 'fixed');
    let now = 1000;
    for (let step = 0; step < 300; step++) {
      const seat = state.seats[Math.floor(rng() * state.seats.length)].playerId;
      const options = legalActions(view(state, seat));
      if (options.length) {
        const action = options[Math.floor(rng() * options.length)];
        state = apply(state, seat, action, now).state;
      }
      now += 400;
      state = tick(state, now).state;
    }
    return JSON.stringify(state);
  };
  const first = run();
  assert.equal(run(), first);
  assert.equal(run(), first);
});

/* --------------------------------------------------------------- offers */

test('an offer escrows its cards and one player may hold only one', () => {
  let state = init(table(4), {}, 3);
  const [c] = Object.keys(state.hands.p0);
  const count = Math.min(MAX_OFFER, held(state.hands.p0, c));
  const before = handSize(state.hands.p0);

  assert.ok(validate(state, 'p0', { type: 'offer', commodity: c, count }).ok);
  const posted = apply(state, 'p0', { type: 'offer', commodity: c, count }, 100);
  state = posted.state;

  assert.equal(handSize(state.hands.p0), before - count);
  assert.equal(state.offers.length, 1);
  assert.equal(state.offers[0].id, `1-1`);
  assert.equal(state.offers[0].expiresAt, 100 + OFFER_TTL_MS);
  assert.deepEqual(posted.events, [{ kind: 'offer', playerId: 'p0', count }]);

  assert.equal(validate(state, 'p0', { type: 'offer', commodity: c, count: 1 }).reason, 'live-offer');

  const back = apply(state, 'p0', { type: 'withdraw' }, 200).state;
  assert.equal(handSize(back.hands.p0), before);
  assert.equal(back.offers.length, 0);
  assertConserved(back, 'withdraw');
});

test('an offer is refused for a count, a commodity or cards it cannot have', () => {
  const state = init(table(4), {}, 5);
  const [c] = Object.keys(state.hands.p0);
  const absent = state.commodities.find((k) => held(state.hands.p0, k) === 0) ?? c;
  assert.equal(validate(state, 'p0', { type: 'offer', commodity: c, count: 0 }).reason, 'count');
  assert.equal(validate(state, 'p0', { type: 'offer', commodity: c, count: MAX_OFFER + 1 }).reason, 'count');
  assert.equal(validate(state, 'p0', { type: 'offer', commodity: c, count: 1.5 }).reason, 'count');
  assert.equal(validate(state, 'p0', { type: 'offer', commodity: 'wheat', count: 1 }).reason, 'commodity');
  assert.equal(validate(state, 'p0', { type: 'offer', commodity: absent, count: MAX_OFFER }).reason, 'cards');
  assert.equal(validate(state, 'nobody', { type: 'offer', commodity: c, count: 1 }).reason, 'no-seat');
  assert.equal(validate(state, 'p0', { type: 'nonsense' }).reason, 'unknown-action');
  assert.equal(validate(state, 'p0', { type: 'ready' }).reason, 'phase');
});

/* --------------------------------------------------------------- trades */

test('an accept moves exactly the count each way and leaves both totals alone', () => {
  let state = init(table(4), {}, 8);
  const offered = Object.keys(state.hands.p0)[0];
  const count = Math.min(MAX_OFFER, held(state.hands.p0, offered));
  state = apply(state, 'p0', { type: 'offer', commodity: offered, count }, 0).state;

  const taker = state.seats.map((s) => s.playerId)
    .find((id) => id !== 'p0' && Object.values(state.hands[id]).some((n) => n >= count));
  const given = Object.keys(state.hands[taker]).find((c) => held(state.hands[taker], c) >= count);

  const offererBefore = { ...state.hands.p0 };
  const takerBefore = { ...state.hands[taker] };
  const offerId = state.offers[0].id;

  const check = validate(state, taker, { type: 'accept', offerId, commodity: given });
  assert.ok(check.ok, check.reason);
  const done = apply(state, taker, { type: 'accept', offerId, commodity: given }, 10);
  const next = done.state;

  assert.equal(handSize(next.hands.p0), handSize(offererBefore) + count, 'offerer got the block back');
  assert.equal(handSize(next.hands[taker]), handSize(takerBefore), 'accepter total unchanged');
  assert.equal(held(next.hands[taker], offered), held(takerBefore, offered) + count);
  assert.equal(held(next.hands[taker], given), held(takerBefore, given) - count);
  assert.equal(held(next.hands.p0, given), held(offererBefore, given) + count);
  assert.equal(next.offers.length, 0);
  assert.deepEqual(done.events, [{ kind: 'trade', a: 'p0', b: taker, count }]);
  assertConserved(next, 'accept');
});

// The race: two accepts of the same offer arrive together, both validated
// against the state before either applied. The room validates immediately
// before applying in the same turn, so the loser's validate is the one that
// fails, and its cards are never consumed because apply never ran.
test('the second accept of one offer refuses with taken and changes nothing', () => {
  let state = init(table(4), {}, 12);
  const offered = Object.keys(state.hands.p0)[0];
  const count = 1;
  state = apply(state, 'p0', { type: 'offer', commodity: offered, count }, 0).state;
  const offerId = state.offers[0].id;

  const takers = state.seats.map((s) => s.playerId).filter((id) => id !== 'p0');
  const firstGives = Object.keys(state.hands[takers[0]])[0];
  const secondGives = Object.keys(state.hands[takers[1]])[0];

  assert.ok(validate(state, takers[0], { type: 'accept', offerId, commodity: firstGives }).ok);
  assert.ok(validate(state, takers[1], { type: 'accept', offerId, commodity: secondGives }).ok);

  const after = apply(state, takers[0], { type: 'accept', offerId, commodity: firstGives }, 5).state;
  const loser = { ...after.hands[takers[1]] };

  const refusal = validate(after, takers[1], { type: 'accept', offerId, commodity: secondGives });
  assert.deepEqual(refusal, { ok: false, reason: 'taken' });
  assert.deepEqual(after.hands[takers[1]], loser, "the loser's cards are untouched");
  assertConserved(after, 'a lost race');
});

test('an accept is refused for your own offer and for cards you do not hold', () => {
  let state = init(table(4), {}, 21);
  const offered = Object.keys(state.hands.p0).find((c) => held(state.hands.p0, c) >= 2);
  state = apply(state, 'p0', { type: 'offer', commodity: offered, count: 2 }, 0).state;
  const offerId = state.offers[0].id;
  assert.equal(validate(state, 'p0', { type: 'accept', offerId, commodity: offered }).reason, 'own-offer');
  const thin = state.commodities.find((c) => held(state.hands.p1, c) < 2);
  if (thin) assert.equal(validate(state, 'p1', { type: 'accept', offerId, commodity: thin }).reason, 'cards');
  assert.equal(validate(state, 'p1', { type: 'accept', offerId: 'no-such', commodity: offered }).reason, 'taken');
});

/* -------------------------------------------------------------- corners */

/** Deals a corner into a state by hand, for the cases randomized play reaches slowly. */
function stackTheDeck(state, playerId) {
  const commodity = state.commodities[0];
  const hands = {};
  const others = state.seats.map((s) => s.playerId).filter((id) => id !== playerId);
  hands[playerId] = { [commodity]: HAND };
  // Everything else spread over the remaining seats, so the census still holds.
  const rest = [];
  for (const c of state.commodities.slice(1)) for (let i = 0; i < HAND; i++) rest.push(c);
  // Round-robin rather than in blocks, or the deal hands somebody else a corner.
  for (const id of others) hands[id] = {};
  rest.forEach((c, index) => {
    const id = others[index % others.length];
    hands[id][c] = (hands[id][c] ?? 0) + 1;
  });
  return { ...state, hands, offers: [] };
}

test('canHarvest is true exactly when a hand is nine of one commodity', () => {
  const base = init(table(4), {}, 30);
  const state = stackTheDeck(base, 'p1');
  assert.equal(view(state, 'p1').you.canHarvest, true);
  assert.equal(view(state, 'p0').you.canHarvest, false);
  assert.equal(cornered(state.hands.p1), state.commodities[0]);
  assert.equal(cornered(state.hands.p0), null);
  assert.equal(cornered({ [state.commodities[0]]: HAND - 1 }), null);
  assert.equal(validate(state, 'p0', { type: 'harvest' }).reason, 'no-corner');
});

test('harvesting scores the value, ends the round, and returns every escrow', () => {
  let state = stackTheDeck(init(table(4), {}, 31), 'p1');
  const spare = Object.keys(state.hands.p2)[0];
  state = apply(state, 'p2', { type: 'offer', commodity: spare, count: 1 }, 0).state;
  const escrowed = handSize(state.hands.p2);

  const done = apply(state, 'p1', { type: 'harvest' }, 1000);
  const next = done.state;

  assert.equal(next.phase, 'roundEnd');
  assert.equal(next.scores.p1, next.values[next.commodities[0]]);
  assert.equal(next.scores.p1, BASE_VALUE, 'commodities[0] is the cheap one');
  assert.deepEqual(next.harvest, { playerId: 'p1', commodity: next.commodities[0], value: BASE_VALUE, forfeited: false });
  assert.equal(next.offers.length, 0);
  assert.equal(handSize(next.hands.p2), escrowed + 1, 'the escrow came home before the reveal');
  assert.deepEqual(done.events, [{ kind: 'harvest', playerId: 'p1' }]);
  assert.equal(next.roundEndsAt, 1000 + REVEAL_BACKSTOP_MS);
  assertConserved(next, 'harvest');

  // Everybody sees everybody at round end.
  const seen = view(next, 'p0');
  assert.deepEqual(Object.keys(seen.reveal).sort(), ['p0', 'p1', 'p2', 'p3']);
  assert.deepEqual(seen.reveal.p1, { [next.commodities[0]]: HAND });
});

test('the next round deals a fresh hand once every human is ready', () => {
  let state = apply(stackTheDeck(init(table(4), {}, 32), 'p0'), 'p0', { type: 'harvest' }, 0).state;
  const ids = state.seats.map((s) => s.playerId);
  for (const id of ids.slice(0, -1)) {
    state = apply(state, id, { type: 'ready' }, 0).state;
    assert.equal(state.phase, 'roundEnd', 'one seat short is still the reveal');
  }
  assert.equal(validate(state, ids[0], { type: 'ready' }).reason, 'ready');
  const done = apply(state, ids[ids.length - 1], { type: 'ready' }, 0);
  state = done.state;

  assert.equal(state.phase, 'trading');
  assert.equal(state.round, 2);
  assert.deepEqual(done.events, [{ kind: 'round', round: 2 }]);
  assert.deepEqual(state.history, []);
  assert.deepEqual(state.ready, []);
  assert.equal(state.harvest, undefined);
  assert.ok(!('harvest' in state), 'a stale harvest is deleted, not left undefined');
  for (const id of ids) assert.equal(handSize(state.hands[id]), HAND);
  assertConserved(state, 'the second deal');
});

test('bots do not hold up the reveal', () => {
  const seats = [{ playerId: 'p0' }, { playerId: 'p1', isBot: true }, { playerId: 'p2', isBot: true }, { playerId: 'p3', isBot: true }];
  let state = apply(stackTheDeck(init(seats, {}, 33), 'p0'), 'p0', { type: 'harvest' }, 0).state;
  state = apply(state, 'p0', { type: 'ready' }, 0).state;
  assert.equal(state.phase, 'trading');
  assert.equal(state.round, 2);
});

test('autoCorner harvests on the tick, and off it nothing happens', () => {
  const manual = stackTheDeck(init(table(4), {}, 34), 'p2');
  assert.equal(tick(manual, 9999).state.phase, 'trading');

  const auto = { ...manual, autoCorner: true };
  const done = tick(auto, 9999);
  assert.equal(done.state.phase, 'roundEnd');
  assert.equal(done.state.harvest.playerId, 'p2');
  assert.deepEqual(done.events, [{ kind: 'harvest', playerId: 'p2' }]);
});

/* ---------------------------------------------------------------- expiry */

test('an offer past its TTL is gone after a tick and the cards are back', () => {
  let state = init(table(4), {}, 40);
  const [c] = Object.keys(state.hands.p0);
  const before = handSize(state.hands.p0);
  state = apply(state, 'p0', { type: 'offer', commodity: c, count: 1 }, 0).state;

  const early = tick(state, OFFER_TTL_MS - 1);
  assert.equal(early.state.offers.length, 1);
  assert.deepEqual(early.events, []);

  const late = tick(state, OFFER_TTL_MS);
  assert.equal(late.state.offers.length, 0);
  assert.equal(handSize(late.state.hands.p0), before);
  assert.deepEqual(late.events, [{ kind: 'expired', playerId: 'p0', count: 1 }]);
  assert.deepEqual(late.state.history.at(-1), { kind: 'expired', playerId: 'p0', count: 1 });
  assertConserved(late.state, 'expiry');
});

test('a tick with nothing to do returns the state it got', () => {
  // The first tick of a session seeds the clocks the rules module is given no
  // `now` to set at init — the idle stamps here, and `botsReadyAt` at a table
  // with bots in it. From the second tick on, an idle table is silent, which is
  // what a driver relies on to stop pushing views.
  const seeded = tick(init(table(4), {}, 41), 500).state;
  const done = tick(seeded, 1000);
  assert.equal(done.state, seeded);
  assert.deepEqual(done.events, []);
});

test('the reveal ends on the backstop whether or not anybody pressed through', () => {
  const state = apply(stackTheDeck(init(table(4), {}, 42), 'p3'), 'p3', { type: 'harvest' }, 5000).state;
  assert.equal(tick(state, 5000 + REVEAL_BACKSTOP_MS - 1).state.phase, 'roundEnd');
  const done = tick(state, 5000 + REVEAL_BACKSTOP_MS);
  assert.equal(done.state.phase, 'trading');
  assert.equal(done.state.round, 2);
});

/* ---------------------------------------------------------- disconnect */

test('a disconnect withdraws the live offer and leaves the hand alone', () => {
  let state = init(table(4), {}, 50);
  const [c] = Object.keys(state.hands.p0);
  const before = { ...state.hands.p0 };
  state = apply(state, 'p0', { type: 'offer', commodity: c, count: 1 }, 0).state;
  const done = apply(state, 'p0', { type: 'disconnect' }, 10);
  assert.equal(done.state.offers.length, 0);
  assert.deepEqual(done.state.hands.p0, before);
  // A seat with nothing live is untouched, so the room can send this freely.
  assert.equal(apply(done.state, 'p1', { type: 'disconnect' }, 20).state, done.state);
});

/* ------------------------------------------------------------ the session */

// Acceptance criterion 2: a whole session through init, validate, apply, tick,
// view and isComplete, with nothing reaching into state.
function targetOf(hand) {
  let best = null;
  for (const [c, n] of Object.entries(hand)) if (best === null || n > hand[best]) best = c;
  return best;
}

function chooseAction(v, rng) {
  if (v.phase === 'over') return null;
  if (v.phase === 'roundEnd') return v.you.ready ? null : { type: 'ready' };
  if (v.you.canHarvest) return { type: 'harvest' };
  const hand = v.you.hand;
  const target = targetOf(hand);
  for (const offer of shuffled(rng, v.offers)) {
    if (offer.mine || !offer.matchable) continue;
    const spare = Object.keys(hand).filter((c) => c !== target && hand[c] >= offer.count);
    if (spare.length) {
      return { type: 'accept', offerId: offer.id, commodity: spare[Math.floor(rng() * spare.length)] };
    }
  }
  if (v.you.offer) return null;
  const spare = Object.keys(hand).filter((c) => c !== target);
  if (!spare.length) return null;
  const c = spare[Math.floor(rng() * spare.length)];
  const count = 1 + Math.floor(rng() * Math.min(MAX_OFFER, hand[c]));
  return { type: 'offer', commodity: c, count };
}

test('four seats play a whole session to the target through the public interface', () => {
  const rng = mulberry32(2718);
  let state = init(table(4), {}, 'a full session');
  let now = 0;
  let outcome = null;
  let harvests = 0;

  for (let step = 0; step < 4000 && outcome === null; step++) {
    for (const seat of shuffled(rng, state.seats)) {
      const action = chooseAction(view(state, seat.playerId), rng);
      if (!action) continue;
      if (!validate(state, seat.playerId, action).ok) continue;
      const done = apply(state, seat.playerId, action, now);
      state = done.state;
      harvests += done.events.filter((e) => e.kind === 'harvest').length;
    }
    now += 700;
    state = tick(state, now).state;
    outcome = isComplete(state);

    const scores = state.seats.map((s) => view(state, s.playerId).seats.find((x) => x.playerId === s.playerId).score);
    const top = Math.max(...scores);
    if (outcome === null) assert.ok(top < state.target || state.phase !== 'trading', 'trading resumed past the target');
  }

  assert.ok(outcome, 'the session did not finish');
  assert.equal(harvests, state.round, 'one harvest per round');
  assert.equal(outcome.game, 'pit');
  assert.equal(outcome.seats.length, 4);
  assert.ok(Math.max(...outcome.seats.map((s) => s.score)) >= outcome.target);
  assert.equal(outcome.seats[0].rank, 1);
  assert.ok(outcome.seats.every((s, i, all) => i === 0 || s.score <= all[i - 1].score), 'ranked by score');

  // The reveal survives into the finished session, and no further round deals.
  const final = view(state, 'p0');
  assert.equal(final.phase, 'over');
  assert.ok(final.reveal, 'the last hands stay visible');
  assert.equal(tick(state, now + REVEAL_BACKSTOP_MS).state.phase, 'over');
});

test('a session is not complete before a score reaches the target', () => {
  const state = init(table(4), {}, 60);
  assert.equal(isComplete(state), null);
  const scored = apply(stackTheDeck(state, 'p0'), 'p0', { type: 'harvest' }, 0).state;
  assert.equal(isComplete(scored), null, 'a corner is not the end of a session');
});

// `../docs/identity-and-stats.md` §4: *Pit shows points and corners.* Points
// are in the view; corners are a session total that only `isComplete` carries.
test('a corner is counted for the harvester, for nobody else, and not for a forfeit', () => {
  let state = stackTheDeck(init(table(4), {}, 62), 'p1');
  assert.deepEqual(state.corners, { p0: 0, p1: 0, p2: 0, p3: 0 });

  state = apply(state, 'p1', { type: 'harvest' }, 0).state;
  assert.deepEqual(state.corners, { p0: 0, p1: 1, p2: 0, p3: 0 });

  // Through the reveal and into the next round: a session total, not a round
  // one, so the deal does not reset it.
  for (const seat of state.seats) state = apply(state, seat.playerId, { type: 'ready' }, 0).state;
  assert.equal(state.round, 2);
  assert.deepEqual(state.corners, { p0: 0, p1: 1, p2: 0, p3: 0 });

  state = apply(stackTheDeck(state, 'p1'), 'p1', { type: 'harvest' }, 0).state;
  assert.equal(state.corners.p1, 2);

  // A bot playing an absent seat took that corner, and the seat that left gets
  // the same nothing from it that it gets in points.
  let left = stackTheDeck(init(table(4), {}, 63), 'p2');
  left = { ...left, forfeit: ['p2'] };
  const forfeited = apply(left, 'p2', { type: 'harvest' }, 0).state;
  assert.equal(forfeited.harvest.forfeited, true);
  assert.equal(forfeited.scores.p2, 0);
  assert.deepEqual(forfeited.corners, { p0: 0, p1: 0, p2: 0, p3: 0 });
  assertConserved(forfeited, 'a forfeited harvest');
});

test('isComplete ranks by score with ties sharing a rank', () => {
  const base = init(table(4), {}, 61);
  const state = {
    ...base,
    phase: 'over',
    scores: { p0: 120, p1: 300, p2: 300, p3: 60 },
  };
  const outcome = isComplete(state);
  const byId = Object.fromEntries(outcome.seats.map((s) => [s.playerId, s]));
  assert.equal(byId.p1.rank, 1);
  assert.equal(byId.p2.rank, 1);
  assert.equal(byId.p0.rank, 3, 'a shared first pushes the next rank to three');
  assert.equal(byId.p3.rank, 4);
  assert.equal(byId.p0.name, 'P0');

  // And the corners come with it, because the end screen and the record both
  // need them and the view carries neither.
  const baskets = isComplete({ ...state, corners: { p0: 1, p1: 3, p2: 0, p3: 0 } });
  assert.deepEqual(
    Object.fromEntries(baskets.seats.map((seat) => [seat.playerId, seat.corners])),
    { p0: 1, p1: 3, p2: 0, p3: 0 },
  );
});

// The stopped seat (`../docs/pit/design.md` §2.6) moves cards through paths the
// randomized play above never takes: a bot driving a seat it does not own, and
// a harvest that scores nothing. Neither may create or destroy a card.
test('conservation holds across a pause, a takeover and a forfeited harvest', () => {
  let state = init(table(4), {}, 'stopped');
  let now = 0;
  const step = (where) => { assertConserved(state, where); };

  state = tick(state, now).state;                       // seeds the idle clocks
  step('the seeding tick');

  const commodity = state.commodities.find((c) => state.hands.p0[c]);
  state = apply(state, 'p0', { type: 'offer', commodity, count: 1 }, 100).state;
  step('an offer left in escrow');

  state = apply(state, 'p0', { type: 'pause' }, 200).state;
  state = tick(state, 200 + IDLE_TAKEOVER_MS * 10).state;
  step('a long pause');
  state = apply(state, 'p1', { type: 'resume' }, 200 + IDLE_TAKEOVER_MS * 10).state;
  step('the resume');

  now = 200 + IDLE_TAKEOVER_MS * 11;
  for (let i = 0; i < 400 && state.phase === 'trading'; i++) {
    now += 500;
    state = tick(state, now).state;
    step(`caretaker tick ${i}`);
  }
  assert.ok(state.takenOver.length > 0, 'nobody was taken over');
  assert.equal(state.phase, 'roundEnd', 'the caretakers never finished a round');
  assert.equal(state.harvest.forfeited, true, 'a caretaker harvest is a forfeited one');
  assert.equal(state.harvest.value, 0);
  step('the forfeited harvest');
});
