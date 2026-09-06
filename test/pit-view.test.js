// The confidentiality boundary.
//
// view() is the one function in Pit that a bug in is fatal to the game: the
// count-only information channel is the whole thing, and the bots read exactly
// what a player reads. So this file does not test that view() returns the right
// fields — pit-rules.test.js does that — it tests that nothing else gets out.

import test from 'node:test';
import assert from 'node:assert/strict';

import { mulberry32 } from '../public/pit/core/rng.js';
import { HAND, MAX_OFFER, COMMODITY_KEYS } from '../public/pit/core/commodities.js';
import { init, apply, validate, view, tick, isComplete, handSize } from '../public/pit/core/rules.js';

const table = (n) => Array.from({ length: n }, (_, i) => ({ playerId: `p${i}`, name: `P${i}` }));

// No commodity key is a substring of another, so a text scan of the serialized
// view is exact. Asserted here rather than assumed, because the scan below is
// only as good as that.
test('no commodity key hides inside another', () => {
  for (const a of COMMODITY_KEYS) {
    for (const b of COMMODITY_KEYS) {
      if (a !== b) assert.ok(!b.includes(a), `${a} is a substring of ${b}`);
    }
  }
});

/**
 * The view with its public preamble removed. `commodities` and `values` name
 * every commodity in play by design — they are the price list, and everybody
 * has it — so the scan is over everything else: hands, offers, history, seats.
 */
function privatePart(v) {
  const copy = JSON.parse(JSON.stringify(v));
  delete copy.commodities;
  delete copy.values;
  return JSON.stringify(copy);
}

const mentioned = (text) => COMMODITY_KEYS.filter((c) => text.includes(c));

/** One seat, one commodity, so every hand at the table is distinguishable. */
function oneEach(state) {
  const hands = {};
  state.seats.forEach((seat, index) => { hands[seat.playerId] = { [state.commodities[index]]: HAND }; });
  return { ...state, hands };
}

test('no view during trading carries another player’s commodity', () => {
  let state = oneEach(init(table(4), {}, 'leak'));
  // p1 puts a block on the table, which is the case where a commodity is
  // sitting in shared state rather than in a hand.
  state = apply(state, 'p1', { type: 'offer', commodity: state.commodities[1], count: MAX_OFFER }, 0).state;

  state.seats.forEach((seat, index) => {
    const v = view(state, seat.playerId);
    const text = privatePart(v);
    const mine = state.commodities[index];

    assert.deepEqual(mentioned(text), [mine],
      `${seat.playerId} sees ${mentioned(text).join(', ')} and should see only ${mine}`);
    // And the test cannot pass by returning nothing.
    assert.equal(v.you.hand[mine], seat.playerId === 'p1' ? HAND - MAX_OFFER : HAND);
    assert.equal(v.commodities.length, 4, 'the price list is still public');
    assert.equal(v.offers.length, 1);
    assert.equal(v.offers[0].count, MAX_OFFER);
    assert.equal(v.offers[0].commodity, undefined, 'an offer is a count and a name');
    assert.equal(v.reveal, undefined, 'nothing is revealed mid-round');
    assert.equal(v.harvest, undefined);
  });

  // Your own offer is yours to see.
  assert.deepEqual(view(state, 'p1').you.offer,
    { id: state.offers[0].id, count: MAX_OFFER, commodity: state.commodities[1] });
});

// The general form of the same claim, over play rather than over one arranged
// position: a viewer's view names the commodities in that viewer's own hand and
// no others, in any state trading can reach.
test('a view names only the commodities its viewer is holding, over randomized play', () => {
  for (const seats of [3, 4, 6]) {
    const rng = mulberry32(seats * 31 + 5);
    let state = init(table(seats), {}, `leak-${seats}`);
    let now = 0;
    for (let step = 0; step < 300 && isComplete(state) === null; step++) {
      if (state.phase === 'trading') {
        for (const seat of state.seats) {
          const v = view(state, seat.playerId);
          const own = new Set(Object.keys(v.you.hand));
          if (v.you.offer) own.add(v.you.offer.commodity);
          for (const c of mentioned(privatePart(v))) {
            assert.ok(own.has(c), `${seat.playerId} sees ${c} without holding it (step ${step})`);
          }
        }
      }
      const actor = state.seats[Math.floor(rng() * state.seats.length)].playerId;
      const v = view(state, actor);
      const action = pickSomething(v, rng);
      if (action && validate(state, actor, action).ok) state = apply(state, actor, action, now).state;
      now += 500;
      state = tick(state, now).state;
    }
  }
});

function pickSomething(v, rng, acceptChance = 0.5) {
  if (v.phase === 'roundEnd') return v.you.ready ? null : { type: 'ready' };
  if (v.phase !== 'trading') return null;
  if (v.you.canHarvest) return { type: 'harvest' };
  const hand = v.you.hand;
  const keys = Object.keys(hand);
  const takeable = v.offers.filter((o) => !o.mine && o.matchable);
  if (takeable.length && rng() < acceptChance) {
    const offer = takeable[Math.floor(rng() * takeable.length)];
    const usable = keys.filter((c) => hand[c] >= offer.count);
    return { type: 'accept', offerId: offer.id, commodity: usable[Math.floor(rng() * usable.length)] };
  }
  if (v.you.offer) return rng() < 0.2 ? { type: 'withdraw' } : null;
  const c = keys[Math.floor(rng() * keys.length)];
  return { type: 'offer', commodity: c, count: 1 + Math.floor(rng() * Math.min(MAX_OFFER, hand[c])) };
}

test('the history is counts and names, never a commodity', () => {
  const rng = mulberry32(77);
  let state = init(table(4), {}, 'history');
  let now = 0;
  let kinds = new Set();
  for (let step = 0; step < 400; step++) {
    const actor = state.seats[Math.floor(rng() * state.seats.length)].playerId;
    // Trades rarely and moves the clock in big steps, so that offers expire as
    // well as being taken — all three event kinds have to occur for this to be
    // testing anything.
    const action = pickSomething(view(state, actor), rng, 0.15);
    if (action && validate(state, actor, action).ok) state = apply(state, actor, action, now).state;
    now += 3000;
    state = tick(state, now).state;
    for (const event of state.history) {
      kinds.add(event.kind);
      for (const value of Object.values(event)) {
        assert.ok(!COMMODITY_KEYS.includes(value), `a ${event.kind} event carries ${value}`);
      }
      assert.ok(['offer', 'trade', 'expired'].includes(event.kind), `unexpected event ${event.kind}`);
    }
  }
  assert.deepEqual([...kinds].sort(), ['expired', 'offer', 'trade'], 'all three kinds happened');
});

test('the round-end reveal is complete, and only then', () => {
  const state = oneEach(init(table(4), {}, 'reveal'));
  const trading = view(state, 'p0');
  assert.equal(trading.reveal, undefined);

  const ended = apply(state, 'p0', { type: 'harvest' }, 0).state;
  const seen = view(ended, 'p0');
  assert.deepEqual(Object.keys(seen.reveal).sort(), ['p0', 'p1', 'p2', 'p3']);
  ended.seats.forEach((seat, index) => {
    assert.deepEqual(seen.reveal[seat.playerId], { [ended.commodities[index]]: HAND });
  });
  assert.deepEqual(seen.harvest, { playerId: 'p0', commodity: ended.commodities[0], value: ended.values[ended.commodities[0]] });
});

test('a seat’s card count is public and excludes what it has offered away', () => {
  let state = oneEach(init(table(4), {}, 'counts'));
  state = apply(state, 'p2', { type: 'offer', commodity: state.commodities[2], count: 3 }, 0).state;
  const seats = view(state, 'p0').seats;
  const p2 = seats.find((s) => s.playerId === 'p2');
  assert.equal(p2.cards, HAND - 3, 'a player who has offered three away is visibly holding six');
  assert.equal(handSize(state.hands.p2), HAND - 3);
  assert.deepEqual(seats.map((s) => s.name), ['P0', 'P1', 'P2', 'P3']);
});

test('matchable is whether the viewer can cover the count', () => {
  let state = oneEach(init(table(4), {}, 'match'));
  // p1 keeps two, so a four-card offer is beyond them and a two-card one is not.
  state = { ...state, hands: { ...state.hands, p1: { [state.commodities[1]]: 2 } } };
  state = apply(state, 'p0', { type: 'offer', commodity: state.commodities[0], count: MAX_OFFER }, 0).state;
  assert.equal(view(state, 'p1').offers[0].matchable, false);
  assert.equal(view(state, 'p2').offers[0].matchable, true);
  assert.equal(view(state, 'p0').offers[0].mine, true);
  assert.equal(view(state, 'p1').offers[0].mine, false);
});

test('a viewer who is not at the table is shown nobody’s cards', () => {
  const state = oneEach(init(table(4), {}, 'stranger'));
  const v = view(state, 'nobody');
  assert.deepEqual(v.you.hand, {});
  assert.equal(v.you.canHarvest, false);
  assert.deepEqual(mentioned(privatePart(v)), []);
});
