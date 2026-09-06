// Creating a profile and changing one, driven with real Requests through the
// gate, the way test/gate-api.test.js drives the reads.
//
// The D1 stub here is a step past that file's: those routes only ever ask for a
// list, and these ones write, so a stub that ignored the SQL would let every
// assertion below pass against a Worker that wrote nothing. This one keeps an
// array of rows, applies the three statements api.js actually issues, and
// enforces the one thing the schema enforces — a live avatar is held once
// (`players_avatar_live`, Session A) — so the constraint path is reachable
// without SQLite.
//
// What it is not is a database. It is honest about which decisions are being
// checked: the Worker's, not SQLite's.

import test from 'node:test';
import assert from 'node:assert/strict';

import { handleGate } from '../worker/gate.js';
import { handleApi } from '../worker/api.js';
import { GATE_COOKIE, WHO_COOKIE } from '../worker/auth.js';
import { NAME_MAX } from '../public/shared/profile.js';

const PASSPHRASE = 'blue fox';
const SECRET = 'test-session-secret-test-session-secret';

/** The house as the seed leaves it, cut to two so the assertions stay short. */
const HOUSE = () => [
  { id: 'p1', screen_name: 'Grown-up One', avatar: 'owl', created_at: 1, retired_at: null },
  { id: 'p3', screen_name: 'Twelve', avatar: 'dragon', created_at: 2, retired_at: null },
];

/**
 * Enough D1 to hold rows. It recognises the three statements worker/api.js
 * issues by their first word and ignores everything else about them.
 *
 * @param {object[]} rows
 */
function fakeDb(rows) {
  const live = () => rows.filter((row) => row.retired_at === null || row.retired_at === undefined);

  /** @param {string} sql @param {any[]} args */
  function run(sql, args) {
    if (sql.startsWith('SELECT')) {
      return {
        all: async () => ({
          results: live()
            .slice()
            .sort((a, b) => a.created_at - b.created_at || String(a.id).localeCompare(String(b.id))),
        }),
      };
    }

    if (sql.startsWith('INSERT')) {
      const [id, screen_name, avatar, created_at] = args;
      return {
        run: async () => {
          if (live().some((row) => row.avatar === avatar)) {
            throw new Error('D1_ERROR: UNIQUE constraint failed: index players_avatar_live');
          }
          rows.push({ id, screen_name, avatar, created_at, retired_at: null });
          return { success: true };
        },
      };
    }

    if (sql.startsWith('UPDATE')) {
      const [screen_name, avatar, id] = args;
      return {
        run: async () => {
          const row = live().find((entry) => entry.id === id);
          if (!row) return { success: true, meta: { changes: 0 } };
          if (live().some((entry) => entry.id !== id && entry.avatar === avatar)) {
            throw new Error('D1_ERROR: UNIQUE constraint failed: index players_avatar_live');
          }
          row.screen_name = screen_name;
          row.avatar = avatar;
          return { success: true, meta: { changes: 1 } };
        },
      };
    }

    throw new Error(`the stub does not know this statement: ${sql}`);
  }

  return {
    rows,
    prepare: (sql) => ({
      bind: (...args) => run(sql, args),
      ...run(sql, []),
    }),
  };
}

const env = (rows = HOUSE()) => ({
  FAMILY_PASSPHRASE: PASSPHRASE,
  SESSION_SECRET: SECRET,
  DB: fakeDb(rows),
});

/** @param {string} path @param {RequestInit & { cookie?: string }} [init] */
function req(path, init = {}) {
  const { cookie, ...rest } = init;
  const headers = new Headers(rest.headers);
  if (cookie) headers.set('cookie', cookie);
  return new Request(`https://games.example${path}`, { ...rest, headers });
}

const cookieFrom = (response, name) => {
  const line = (response.headers.getSetCookie() || []).find((c) => c.startsWith(`${name}=`));
  return line ? line.slice(0, line.indexOf(';')) : null;
};

/** Types the passphrase and comes back with a gate cookie. */
async function passGate(e) {
  const response = await handleGate(
    req('/gate', {
      method: 'POST',
      body: new URLSearchParams({ word: PASSPHRASE, next: '/' }),
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
    }),
    e,
  );
  return cookieFrom(response, GATE_COOKIE);
}

/** @param {any} e @param {string} cookie @param {object} body */
const post = (e, cookie, body) =>
  handleApi(req('/api/players', { method: 'POST', cookie, body: JSON.stringify(body) }), e, '/api/players');

/** @param {any} e @param {string} cookie @param {string} id @param {object} body */
const patch = (e, cookie, id, body) =>
  handleApi(
    req(`/api/players/${id}`, { method: 'PATCH', cookie, body: JSON.stringify(body) }),
    e,
    `/api/players/${id}`,
  );

test('creating a profile puts a row in the database and hands it back', async () => {
  const e = env();
  const gate = await passGate(e);

  const response = await post(e, gate, { name: '  Eleven  ', avatar: 'rocket' });
  assert.equal(response.status, 201);

  const { player } = await response.json();
  assert.equal(player.name, 'Eleven', 'the name is stored normalised, not as typed');
  assert.equal(player.avatar, 'rocket');
  assert.ok(player.id, 'a new profile gets an id');
  assert.ok(!['p1', 'p3'].includes(player.id), 'and it is not one that was already taken');

  const read = await handleApi(req('/api/players', { cookie: gate }), e, '/api/players');
  const { players } = await read.json();
  assert.deepEqual(players.map((entry) => entry.name), ['Grown-up One', 'Twelve', 'Eleven']);
});

test('creating on a device with nobody on it picks the new profile', async () => {
  const e = env();
  const gate = await passGate(e);

  const response = await post(e, gate, { name: 'Eleven', avatar: 'rocket' });
  const { player, me } = await response.json();
  assert.equal(me, player.id);

  const who = cookieFrom(response, WHO_COOKIE);
  assert.ok(who, 'the who cookie is set, so the next screen is the shelf');

  const read = await handleApi(req('/api/players', { cookie: `${gate}; ${who}` }), e, '/api/players');
  assert.equal((await read.json()).me, player.id);
});

test('creating on a device that is already somebody leaves that somebody alone', async () => {
  const e = env();
  const gate = await passGate(e);

  const picked = await handleApi(
    req('/api/who', { method: 'POST', cookie: gate, body: JSON.stringify({ id: 'p1' }) }),
    e,
    '/api/who',
  );
  const who = cookieFrom(picked, WHO_COOKIE);

  // A parent making a profile for a child from their own phone. Making one is
  // not the same thing as becoming one.
  const response = await post({ ...e }, `${gate}; ${who}`, { name: 'Four', avatar: 'frog' });
  assert.equal((await response.json()).me, 'p1');
  assert.equal(cookieFrom(response, WHO_COOKIE), null, 'and the cookie is left where it was');
});

test('a profile with no name, a long name or a taken name is refused', async () => {
  const e = env();
  const gate = await passGate(e);

  for (const name of ['', '   ', 'x'.repeat(NAME_MAX + 1), 'twelve']) {
    const response = await post(e, gate, { name, avatar: 'rocket' });
    assert.equal(response.status, 400, `"${name}" should not be a name`);
    assert.equal((await response.json()).field, 'name');
  }
  assert.equal(e.DB.rows.length, 2, 'and nothing was written');
});

test('a face that is taken, or is not in the set, is refused', async () => {
  const e = env();
  const gate = await passGate(e);

  const taken = await post(e, gate, { name: 'Eleven', avatar: 'dragon' });
  assert.equal(taken.status, 400);
  assert.equal((await taken.json()).field, 'avatar');

  const invented = await post(e, gate, { name: 'Eleven', avatar: 'unicorn-of-the-void' });
  assert.equal(invented.status, 400);
  assert.equal((await invented.json()).field, 'avatar');

  assert.equal(e.DB.rows.length, 2);
});

test('the schema has the last word on a face two phones pick at once', async () => {
  // The check before the write is what normally answers this; the index is what
  // makes it true. Here the row appears between the two, which is the window
  // the constraint exists to close.
  const rows = HOUSE();
  const e = env(rows);
  const gate = await passGate(e);

  const db = e.DB;
  const prepare = db.prepare;
  db.prepare = (sql) => {
    if (sql.startsWith('INSERT')) {
      rows.push({ id: 'sneaked', screen_name: 'Somebody', avatar: 'rocket', created_at: 3, retired_at: null });
      db.prepare = prepare;
    }
    return prepare(sql);
  };

  const response = await post(e, gate, { name: 'Eleven', avatar: 'rocket' });
  assert.equal(response.status, 400);
  assert.equal((await response.json()).field, 'avatar');
});

test('a rename changes the name and nothing else', async () => {
  const e = env();
  const gate = await passGate(e);

  const response = await patch(e, gate, 'p3', { name: 'Thirteen' });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { player: { id: 'p3', name: 'Thirteen', avatar: 'dragon' } });

  const row = e.DB.rows.find((entry) => entry.id === 'p3');
  assert.equal(row.screen_name, 'Thirteen');
  assert.equal(row.avatar, 'dragon', 'the face it arrived with is still on it');
  assert.equal(row.created_at, 2, 'and it keeps its place in the strip');
});

test('a new face can be taken and the old one is released', async () => {
  const e = env();
  const gate = await passGate(e);

  const moved = await patch(e, gate, 'p3', { avatar: 'fox' });
  assert.equal((await moved.json()).player.avatar, 'fox');

  // The dragon is free now, so somebody else may have it.
  const response = await post(e, gate, { name: 'Eleven', avatar: 'dragon' });
  assert.equal(response.status, 201);
});

test('saving a profile unchanged is not a clash with itself', async () => {
  const e = env();
  const gate = await passGate(e);
  const response = await patch(e, gate, 'p3', { name: 'Twelve', avatar: 'dragon' });
  assert.equal(response.status, 200);
});

test("taking a name or a face that is somebody else's is refused, and changes nothing", async () => {
  const e = env();
  const gate = await passGate(e);

  const name = await patch(e, gate, 'p3', { name: 'Grown-up One' });
  assert.equal(name.status, 400);
  assert.equal((await name.json()).field, 'name');

  const avatarTaken = await patch(e, gate, 'p3', { avatar: 'owl' });
  assert.equal(avatarTaken.status, 400);
  assert.equal((await avatarTaken.json()).field, 'avatar');

  const row = e.DB.rows.find((entry) => entry.id === 'p3');
  assert.equal(row.screen_name, 'Twelve');
  assert.equal(row.avatar, 'dragon');
});

test('editing a player who is not there is a 404, not a new one', async () => {
  const e = env();
  const gate = await passGate(e);

  const missing = await patch(e, gate, 'p99', { name: 'Ghost' });
  assert.equal(missing.status, 404);

  const retired = env([
    { id: 'p1', screen_name: 'Grown-up One', avatar: 'owl', created_at: 1, retired_at: null },
    { id: 'p9', screen_name: 'Gone', avatar: 'fox', created_at: 2, retired_at: 99 },
  ]);
  const gate2 = await passGate(retired);
  assert.equal((await patch(retired, gate2, 'p9', { name: 'Back' })).status, 404);
  assert.equal(e.DB.rows.length, 2);
});

test('the writes are behind the gate like everything else', async () => {
  const e = env();
  assert.equal((await post(e, '', { name: 'Eleven', avatar: 'rocket' })).status, 401);
  assert.equal((await patch(e, '', 'p3', { name: 'Thirteen' })).status, 401);
  assert.equal(e.DB.rows.length, 2);
});

test('the wrong method and a body that is not JSON answer in JSON', async () => {
  const e = env();
  const gate = await passGate(e);

  const deleted = await handleApi(
    req('/api/players', { method: 'DELETE', cookie: gate }),
    e,
    '/api/players',
  );
  assert.equal(deleted.status, 405);
  assert.equal(deleted.headers.get('allow'), 'GET, POST');

  const posted = await handleApi(
    req('/api/players/p3', { method: 'POST', cookie: gate, body: '{}' }),
    e,
    '/api/players/p3',
  );
  assert.equal(posted.status, 405);
  assert.equal(posted.headers.get('allow'), 'PATCH');

  const rubbish = await handleApi(
    req('/api/players', { method: 'POST', cookie: gate, body: 'not json' }),
    e,
    '/api/players',
  );
  assert.equal(rubbish.status, 400);
});
