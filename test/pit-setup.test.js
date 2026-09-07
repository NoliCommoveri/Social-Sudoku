// The setup screen's pure half: the seats a set of choices makes, the faces
// they wear, and the config that reaches `init`.

import test from 'node:test';
import assert from 'node:assert/strict';

import { AVATARS } from '../public/shared/avatars.js';
import { seatLimits } from '../public/pit/room/local.js';
import { buildSeats, botAvatarPool, configFrom, botRange, TARGETS } from '../public/pit/ui/setup.js';

const me = { id: 'p-me', name: 'Jo', avatar: 'fox' };

/** Deterministic, so a face collision is a bug and not a run of bad luck. */
function seq(seed = 1) {
  let state = seed;
  return () => {
    state = (Math.imul(state, 1103515245) + 12345) & 0x7fffffff;
    return state / 0x80000000;
  };
}

const pool = () => botAvatarPool([me]);

test('the tile row is the rules module’s range, minus the one human', () => {
  const { minPlayers, maxPlayers } = seatLimits();
  assert.deepEqual(botRange(), [2, 3, 4, 5, 6, 7, 8]);
  assert.equal(botRange()[0], minPlayers - 1);
  assert.equal(botRange().at(-1), maxPlayers - 1);
});

test('buildSeats seats the human first and the bots behind', () => {
  for (const botCount of botRange()) {
    const { seats } = buildSeats({ me, botCount, botLevel: 'hard', avatars: pool(), rng: seq(botCount) });
    assert.equal(seats.length, botCount + 1);
    assert.deepEqual(seats[0], { playerId: 'p-me', name: 'Jo' });
    assert.ok(seats.slice(1).every((seat) => seat.isBot === true && seat.botLevel === 'hard'));
    const ids = seats.map((seat) => seat.playerId);
    assert.equal(new Set(ids).size, ids.length, 'a duplicate id would refuse to deal');
  }
});

test('a bot count outside the range is refused rather than clamped', () => {
  for (const botCount of [1, 9, 0, -1, 2.5, '4']) {
    assert.throws(() => buildSeats({ me, botCount, avatars: pool(), rng: seq() }), RangeError, String(botCount));
  }
});

test('no bot wears a face a real profile holds, and no two bots look alike', () => {
  const players = [me, { id: 'p2', name: 'Ada', avatar: 'cat' }, { id: 'p3', name: 'Sam', avatar: 'owl' }];
  const taken = new Set(players.map((player) => player.avatar));
  const eligible = botAvatarPool(players);

  assert.equal(eligible.length, AVATARS.length - taken.size);
  for (const key of taken) assert.ok(!eligible.includes(key), key);

  for (let seed = 1; seed <= 20; seed++) {
    const { faces, seats } = buildSeats({ me, botCount: 8, avatars: eligible, rng: seq(seed) });
    const worn = seats.slice(1).map((seat) => faces[seat.playerId]);
    assert.equal(new Set(worn).size, worn.length, `seed ${seed}: two bots in one face`);
    for (const key of worn) assert.ok(eligible.includes(key), `seed ${seed}: bot wearing ${key}`);
    assert.equal(faces[me.id], me.avatar);
  }
});

test('an unknown level falls back rather than reaching init', () => {
  const { defaultLevel } = seatLimits();
  const { seats } = buildSeats({ me, botCount: 2, botLevel: 'nightmare', avatars: pool(), rng: seq() });
  assert.ok(seats.slice(1).every((seat) => seat.botLevel === defaultLevel));
});

test('configFrom takes plain choices and falls back on a value it does not know', () => {
  assert.deepEqual(configFrom({ target: 500, autoCorner: true }), { target: 500, autoCorner: true });
  assert.deepEqual(configFrom({}), { target: TARGETS[1], autoCorner: false });
  for (const target of [null, 0, 250, '300', undefined, NaN]) {
    assert.equal(configFrom({ target }).target, TARGETS[1], String(target));
  }
  for (const autoCorner of ['yes', 1, null, undefined]) {
    assert.equal(configFrom({ autoCorner }).autoCorner, false, String(autoCorner));
  }
});
