// What a bot is allowed to do, and the one thing it must never do.
//
// Most of a bot is taste and is not tested here. Two things are not taste: an
// action it returns has to validate, and it must never pay out a card of the
// commodity it is chasing. Both are asserted over seeded sessions at every
// level and every seat count, including the noisy levels, because noise is
// where an invariant breaks.

import test from 'node:test';
import assert from 'node:assert/strict';

import { mulberry32 } from '../public/pit/core/rng.js';
import { HAND, COMMODITY_KEYS, valuesFor } from '../public/pit/core/commodities.js';
import { botAction, botDelay, botNotice, targetOf, BOT_LEVELS, DEFAULT_LEVEL } from '../public/pit/core/bot.js';
import {
  init, validate, view, tick, tickIntervalMs, minPlayers, maxPlayers, held,
} from '../public/pit/core/rules.js';

const SEAT_COUNTS = Array.from({ length: maxPlayers - minPlayers + 1 }, (_, i) => minPlayers + i);
const bots = (n, level) => Array.from(
  { length: n },
  (_, i) => ({ playerId: `b${i}`, name: `B${i}`, isBot: true, botLevel: level }),
);

/**
 * Steps a table of bots on a fake clock, handing every state it passes through
 * to `visit`. Everything below plays through tick rather than calling botAction
 * in a loop, because the states a bot actually meets are the ones worth
 * probing — a hand mid-escrow, a board with three live offers on it.
 */
function playThrough(seats, seed, ticks, visit) {
  let state = init(seats, {}, seed);
  let now = 0;
  for (let i = 0; i < ticks && state.phase !== 'over'; i++) {
    visit(state, now);
    now += tickIntervalMs;
    state = tick(state, now).state;
  }
  return state;
}

/** What an action pays out of the actor's hand, or null when it pays nothing. */
function paidBy(action) {
  if (!action) return null;
  return action.type === 'offer' || action.type === 'accept' ? action.commodity : null;
}

test('every action a bot returns is legal', () => {
  let sampled = 0;
  let acted = 0;
  for (const level of BOT_LEVELS) {
    for (const count of SEAT_COUNTS) {
      const seats = bots(count, level);
      playThrough(seats, `legal-${level}-${count}`, 400, (state) => {
        const rng = mulberry32(state.round * 1000 + sampled);
        for (const seat of seats) {
          const action = botAction(view(state, seat.playerId), level, rng);
          sampled++;
          if (action === null) continue;
          acted++;
          const check = validate(state, seat.playerId, action);
          assert.ok(check.ok, `${level} ${seat.playerId} returned ${JSON.stringify(action)}: ${check.reason}`);
        }
      });
    }
  }
  assert.ok(acted > sampled / 10, `bots barely acted: ${acted} of ${sampled}`);
});

// The invariant, and it is the only one. The commodity paid out is read off the
// action rather than out of the bot, and the target is read off the view — a
// test that recomputed the bot's preferences would only be testing that the
// same code says the same thing twice.
test('a bot never gives away a card of its target', () => {
  for (const level of BOT_LEVELS) {
    for (const count of SEAT_COUNTS) {
      const seats = bots(count, level);
      let seq = 0;
      playThrough(seats, `target-${level}-${count}`, 400, (state) => {
        for (const seat of seats) {
          const seen = view(state, seat.playerId);
          const target = targetOf(seen);
          // Several draws per state, so the noisy branch is exercised at every
          // board rather than only where the session happened to land on it.
          for (let draw = 0; draw < 8; draw++) {
            const action = botAction(seen, level, mulberry32(++seq));
            const paid = paidBy(action);
            assert.notEqual(paid, target, `${level} ${seat.playerId} paid out its target ${target}`);
          }
        }
      });
    }
  }
});

test('the target is the biggest pile, or a contrarian’s valuable one', () => {
  for (const count of SEAT_COUNTS) {
    const seats = bots(count, DEFAULT_LEVEL);
    playThrough(seats, `pick-${count}`, 200, (state) => {
      for (const seat of seats) {
        const seen = view(state, seat.playerId);
        const hand = seen.you.hand;
        const target = targetOf(seen);
        assert.ok(held(hand, target) > 0, `${seat.playerId} targets a commodity it does not hold`);

        const most = Math.max(...Object.values(hand));
        if (hand[target] === most) continue;
        // The other legal answer: the highest-value commodity it holds at
        // least two of, held whatever overtakes it.
        const rich = Object.keys(hand).filter((c) => hand[c] >= 2);
        const best = Math.max(...rich.map((c) => seen.values[c]));
        assert.equal(seen.values[target], best, `${seat.playerId} targets neither its biggest nor its richest pile`);
      }
    });
  }
});

// A bot has nowhere to remember what it chose last time, so the only thing
// keeping the target still is that nothing outside the hand goes into it.
test('the target does not move when only the board moves', () => {
  const seats = bots(4, 'hard');
  playThrough(seats, 'still', 200, (state) => {
    for (const seat of seats) {
      const seen = view(state, seat.playerId);
      const shuffledBoard = { ...seen, offers: [...seen.offers].reverse(), history: [] };
      assert.equal(targetOf(shuffledBoard), targetOf(seen));
    }
  });
});

// One in ten, held for the round. Detected through targetOf on a hand where the
// two rules disagree: five of the cheapest commodity against two of the dearest.
test('about one bot in ten plays against its own hand', () => {
  const [cheap, dear] = [COMMODITY_KEYS[0], COMMODITY_KEYS[1]];
  const values = valuesFor([cheap, dear]);
  const seen = (playerId, round) => ({
    round,
    values,
    you: { playerId, hand: { [cheap]: 5, [dear]: 2 } },
  });

  let contrarian = 0;
  let total = 0;
  for (let round = 1; round <= 20; round++) {
    for (let i = 0; i < 100; i++) {
      total++;
      if (targetOf(seen(`p${i}`, round)) === dear) contrarian++;
    }
  }
  const share = contrarian / total;
  assert.ok(share > 0.02 && share < 0.2, `contrarian share is ${share}`);
});

test('the same view and the same seed produce the same action', () => {
  const seats = bots(5, 'normal');
  let seq = 0;
  playThrough(seats, 'determinism', 200, (state) => {
    for (const seat of seats) {
      const seen = view(state, seat.playerId);
      const seed = ++seq;
      const first = botAction(seen, 'normal', mulberry32(seed));
      const second = botAction(seen, 'normal', mulberry32(seed));
      assert.deepEqual(first, second);
    }
  });
});

test('the same session seed and tick times replay exactly', () => {
  const seats = bots(4, 'normal');
  const once = playThrough(seats, 'replay', 600, () => {});
  const twice = playThrough(seats, 'replay', 600, () => {});
  assert.equal(JSON.stringify(once), JSON.stringify(twice));
});

test('latency lands in the level’s range, and the levels are ordered', () => {
  const RANGES = { easy: [1600, 3200], normal: [1000, 2200], hard: [800, 1600] };
  const means = {};
  for (const level of BOT_LEVELS) {
    const [low, high] = RANGES[level];
    const rng = mulberry32(7);
    let sum = 0;
    for (let i = 0; i < 2000; i++) {
      const delay = botDelay(level, rng);
      assert.ok(delay >= low && delay <= high, `${level} sampled ${delay}`);
      sum += delay;
    }
    means[level] = sum / 2000;
  }
  assert.ok(means.easy > means.normal, `easy ${means.easy} not slower than normal ${means.normal}`);
  assert.ok(means.normal > means.hard, `normal ${means.normal} not slower than hard ${means.hard}`);
});

test('the table keeps its cadence as bots are added to it', () => {
  // The bug this is here for: without the divisor the level names a per-seat
  // rate, so every bot added speeds the board up, and past four seats every
  // level collapses onto tickIntervalMs and the knob stops meaning anything.
  const perTurn = (level, seats) => {
    const rng = mulberry32(11);
    let sum = 0;
    for (let i = 0; i < 2000; i++) sum += botDelay(level, rng, seats);
    return sum / 2000 / seats;
  };
  for (const level of BOT_LEVELS) {
    const solo = perTurn(level, 1);
    for (let seats = 2; seats <= maxPlayers; seats++) {
      const ratio = perTurn(level, seats) / solo;
      assert.ok(ratio > 0.9 && ratio < 1.1, `${level} at ${seats} seats runs ${ratio.toFixed(2)}x the solo table`);
    }
  }

  // And that tick passes the seat count rather than leaving the divisor to a
  // default. Asserted on the gates the first tick seeds rather than on how many
  // turns a table gets through, because the one-per-tick rule caps throughput at
  // two a second: an unscaled nine-seat table saturates that cap and so looks
  // barely faster than a three-seat one right up until the level stops
  // mattering, which is the failure this is here to see.
  const gap = (count) => {
    const state = tick(init(bots(count, 'normal'), {}, `cadence-${count}`), tickIntervalMs).state;
    const waits = Object.values(state.botsReadyAt).map((at) => at - tickIntervalMs);
    return (waits.reduce((sum, wait) => sum + wait, 0) / waits.length) / count;
  };
  const small = gap(minPlayers);
  const full = gap(maxPlayers);
  assert.ok(
    full > small * 0.6 && full < small * 1.6,
    `a seat at a ${maxPlayers}-bot table waits ${(full / small).toFixed(2)}x its share of what one at a ${minPlayers}-bot table waits`,
  );
});

test('nobody takes a block before the table has had time to look at it', () => {
  // The whole of "I cannot claim a trade": a bot decides on the next tick, so
  // without the window an offer can be gone 500ms after it lands, which is less
  // than the time it takes a person to find a matching block and press it.
  for (const level of BOT_LEVELS) {
    const window = botNotice(level);
    assert.ok(window > tickIntervalMs, `${level} gives no more warning than one tick`);
    for (const count of SEAT_COUNTS) {
      const seats = bots(count, level);
      let state = init(seats, {}, `notice-${level}-${count}`);
      let now = 0;
      let traded = 0;
      for (let i = 0; i < 600 && state.phase !== 'over'; i++) {
        const before = new Map(state.offers.map((offer) => [offer.id, offer]));
        now += tickIntervalMs;
        const done = tick(state, now);
        if (done.events.some((event) => event.kind === 'trade')) {
          for (const [id, offer] of before) {
            if (done.state.offers.some((live) => live.id === id)) continue;
            traded++;
            assert.ok(
              now - offer.postedAt >= window,
              `${level} took a ${now - offer.postedAt}ms-old block, window ${window}ms`,
            );
          }
        }
        state = done.state;
      }
      assert.ok(traded > 0, `no ${level} bot traded at ${count} seats`);
    }
  }
});

test('an unrecognised level plays as normal rather than crashing', () => {
  const rng = () => 0.5;
  assert.equal(botDelay('cheating', rng), botDelay(DEFAULT_LEVEL, () => 0.5));
  assert.equal(botDelay(undefined, () => 0.5), botDelay(DEFAULT_LEVEL, () => 0.5));

  const state = init(bots(3, 'cheating'), {}, 'typo');
  const seen = view(state, 'b0');
  assert.deepEqual(botAction(seen, 'cheating', mulberry32(1)), botAction(seen, DEFAULT_LEVEL, mulberry32(1)));
});

test('a bot harvests its own corner before anything else', () => {
  const state = init(bots(3, 'easy'), {}, 'corner');
  const commodity = state.commodities[0];
  const cornered = { ...state, hands: { ...state.hands, b0: { [commodity]: HAND } } };
  const seen = view(cornered, 'b0');
  // Every draw, at the noisiest level: the harvest is exempt from noise.
  for (let seed = 1; seed <= 200; seed++) {
    assert.deepEqual(botAction(seen, 'easy', mulberry32(seed)), { type: 'harvest' });
  }
});

test('a bot holding nothing but its target sits still', () => {
  const state = init(bots(3, 'hard'), {}, 'still-hand');
  const commodity = state.commodities[0];
  // One short of a corner and nothing else to trade with.
  const waiting = { ...state, hands: { ...state.hands, b0: { [commodity]: HAND - 1 } }, offers: [] };
  const seen = view(waiting, 'b0');
  let idle = 0;
  for (let seed = 1; seed <= 100; seed++) {
    if (botAction(seen, 'hard', mulberry32(seed)) === null) idle++;
  }
  assert.equal(idle, 100);
});

test('bots never send ready, and do nothing outside trading', () => {
  const seats = bots(4, 'normal');
  let seen = 0;
  playThrough(seats, 'reveal', 2000, (state) => {
    if (state.phase === 'trading') return;
    seen++;
    for (const seat of seats) {
      assert.equal(botAction(view(state, seat.playerId), 'normal', mulberry32(seen)), null);
    }
  });
  assert.ok(seen > 0, 'the session never reached a reveal');
});

test('one bot acts per tick, and none before its gate opens', () => {
  const seats = bots(4, 'hard');
  let state = init(seats, {}, 'gate');
  let now = 0;

  // The first tick seeds the gates and nobody acts: an absent gate is not an
  // open one, or a round would open with a flurry.
  const first = tick(state, (now += tickIntervalMs));
  assert.deepEqual(first.events, []);
  assert.equal(Object.keys(first.state.botsReadyAt).length, seats.length);
  state = first.state;

  // Expiry can return cards to several hands at once, so the count that means
  // "one bot acted" is the events only a bot could have caused.
  const BY_A_BOT = new Set(['offer', 'trade', 'withdraw', 'harvest']);
  let actions = 0;
  for (let i = 0; i < 400 && state.phase === 'trading'; i++) {
    const done = tick(state, (now += tickIntervalMs));
    const theirs = done.events.filter((event) => BY_A_BOT.has(event.kind));
    assert.ok(theirs.length <= 1, `${theirs.length} bot actions in one tick`);
    actions += theirs.length;
    state = done.state;
  }
  assert.ok(actions > 0, 'no bot acted in four hundred ticks');
});

test('the bot counter is session-long and survives a deal', () => {
  const seats = bots(4, 'normal');
  let state = init(seats, {}, 'counter');
  assert.equal(state.botSeq, 0);
  let now = 0;
  let round = state.round;
  let dealt = false;
  for (let i = 0; i < 4000 && !dealt; i++) {
    const before = state.botSeq;
    state = tick(state, (now += tickIntervalMs)).state;
    assert.ok(state.botSeq >= before, 'botSeq went backwards');
    if (state.round !== round) { dealt = true; assert.ok(state.botSeq > 0); }
  }
  assert.ok(dealt, 'the session never redealt');
});
