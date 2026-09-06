// The gate and the two endpoints, driven end to end with real Requests.
//
// This is further than the project's testing rule usually reaches -- "the
// module that touches the platform is checked in a browser" -- and it is
// reachable for one reason: worker/gate.js and worker/api.js import nothing
// that imports a .sql file, so `node --test` can load them. D1 is stubbed
// below in about twenty lines because all these two routes ask it for is a list
// of players.
//
// worker/index.js is still out of reach (it imports admin.js, which imports
// SQL), so what is *not* covered here is the routing between them. That is S8's
// first two steps.

import test from 'node:test';
import assert from 'node:assert/strict';

import { handleGate, throughGate } from '../worker/gate.js';
import { handleApi } from '../worker/api.js';
import { GATE_COOKIE, WHO_COOKIE } from '../worker/auth.js';

const PASSPHRASE = 'blue fox';
const env = () => ({
  FAMILY_PASSPHRASE: PASSPHRASE,
  SESSION_SECRET: 'test-session-secret-test-session-secret',
  DB: fakeDb([
    { id: 'p1', screen_name: 'Grown-up One', avatar: 'owl' },
    { id: 'p3', screen_name: 'Twelve', avatar: 'dragon' },
  ]),
});

/**
 * Just enough D1 to answer the one query these routes make. It ignores the SQL
 * and returns the rows it was built with, which is honest about what it is:
 * this file tests the Worker's decisions, not SQLite's.
 *
 * @param {object[]} rows
 */
function fakeDb(rows) {
  return {
    prepare: () => ({
      bind: () => ({ all: async () => ({ results: rows }) }),
      all: async () => ({ results: rows }),
    }),
  };
}

/** @param {string} path @param {RequestInit & { cookie?: string }} [init] */
function req(path, init = {}) {
  const { cookie, ...rest } = init;
  const headers = new Headers(rest.headers);
  if (cookie) headers.set('cookie', cookie);
  return new Request(`https://games.example${path}`, { ...rest, headers });
}

/** The cookie value a Set-Cookie header hands back, ready to send again. */
const cookieFrom = (response, name) => {
  const line = (response.headers.getSetCookie() || []).find((c) => c.startsWith(`${name}=`));
  return line ? line.slice(0, line.indexOf(';')) : null;
};

/** Types the passphrase and comes back with a gate cookie. */
async function passGate(e) {
  const body = new URLSearchParams({ word: PASSPHRASE, next: '/' });
  const response = await handleGate(
    req('/gate', { method: 'POST', body, headers: { 'content-type': 'application/x-www-form-urlencoded' } }),
    e,
  );
  assert.equal(response.status, 303);
  const cookie = cookieFrom(response, GATE_COOKIE);
  assert.ok(cookie, 'no gate cookie was set');
  return cookie;
}

test('the gate page renders, and only for /gate', async () => {
  const e = env();
  assert.equal(await handleGate(req('/'), e), null);
  assert.equal(await handleGate(req('/api/players'), e), null);

  const response = await handleGate(req('/gate'), e);
  assert.equal(response.status, 200);
  const html = await response.text();
  assert.match(html, /<form method="post" action="\/gate">/);
  assert.match(html, /name="word"/);
  // It draws from the shared tokens: the gate is the first screen of the site
  // and has to look like it.
  assert.match(html, /\/shared\/theme\.css/);
});

test('the wrong word is refused and the right one lets you in', async () => {
  const e = env();
  const wrong = await handleGate(
    req('/gate', {
      method: 'POST',
      body: new URLSearchParams({ word: 'not it', next: '/' }),
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
    }),
    e,
  );
  assert.equal(wrong.status, 401);
  assert.equal(cookieFrom(wrong, GATE_COOKIE), null);
  assert.match(await wrong.text(), /not the word/i);

  const cookie = await passGate(e);
  assert.equal(await throughGate(req('/', { cookie }), e), true);
});

test('case and stray spaces do not keep a 5-year-old out', async () => {
  const e = env();
  const response = await handleGate(
    req('/gate', {
      method: 'POST',
      body: new URLSearchParams({ word: '  Blue FOX ', next: '/sudoku/' }),
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
    }),
    e,
  );
  assert.equal(response.status, 303);
  assert.equal(response.headers.get('location'), '/sudoku/');
});

test('the gate will not redirect off this site', async () => {
  const e = env();
  const response = await handleGate(
    req('/gate', {
      method: 'POST',
      body: new URLSearchParams({ word: PASSPHRASE, next: 'https://evil.example/' }),
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
    }),
    e,
  );
  assert.equal(response.headers.get('location'), '/');
});

test('changing the passphrase invalidates every gate cookie', async () => {
  const e = env();
  const cookie = await passGate(e);
  assert.equal(await throughGate(req('/', { cookie }), e), true);

  const rotated = { ...e, FAMILY_PASSPHRASE: 'green socks' };
  assert.equal(await throughGate(req('/', { cookie }), rotated), false);
});

test('before setup task A3 the gate says so rather than showing a form', async () => {
  const response = await handleGate(req('/gate'), { DB: fakeDb([]) });
  assert.equal(response.status, 503);
  assert.match(await response.text(), /A3/);
});

test('the api refuses without a gate cookie, in JSON', async () => {
  const response = await handleApi(req('/api/players'), env(), '/api/players');
  assert.equal(response.status, 401);
  assert.equal(response.headers.get('content-type'), 'application/json');
  assert.deepEqual(await response.json(), { error: 'gate', gate: '/gate' });
});

test('players come back through the gate, with nobody picked yet', async () => {
  const e = env();
  const cookie = await passGate(e);
  const response = await handleApi(req('/api/players', { cookie }), e, '/api/players');
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.me, null);
  assert.deepEqual(body.players, [
    { id: 'p1', name: 'Grown-up One', avatar: 'owl' },
    { id: 'p3', name: 'Twelve', avatar: 'dragon' },
  ]);
});

test('picking a player sets a who cookie the next read believes', async () => {
  const e = env();
  const gate = await passGate(e);

  const picked = await handleApi(
    req('/api/who', { method: 'POST', cookie: gate, body: JSON.stringify({ id: 'p3' }) }),
    e,
    '/api/who',
  );
  assert.equal(picked.status, 200);
  assert.deepEqual(await picked.json(), { me: 'p3' });

  const who = cookieFrom(picked, WHO_COOKIE);
  const read = await handleApi(req('/api/players', { cookie: `${gate}; ${who}` }), e, '/api/players');
  assert.equal((await read.json()).me, 'p3');
});

test('a who cookie this Worker did not issue is nobody', async () => {
  const e = env();
  const gate = await passGate(e);
  const forged = `${WHO_COOKIE}=${Buffer.from(JSON.stringify({ k: 'who', id: 'p1', exp: Date.now() + 1e6 })).toString('base64url')}.notasignature`;
  const response = await handleApi(req('/api/players', { cookie: `${gate}; ${forged}` }), e, '/api/players');
  assert.equal((await response.json()).me, null);
});

test('a who cookie naming a player who is gone is nobody', async () => {
  const e = env();
  const gate = await passGate(e);
  const picked = await handleApi(
    req('/api/who', { method: 'POST', cookie: gate, body: JSON.stringify({ id: 'p3' }) }),
    e,
    '/api/who',
  );
  const who = cookieFrom(picked, WHO_COOKIE);

  // p3 retires: the same signed cookie now names nobody, and the picker is the
  // answer rather than an error.
  const shrunk = { ...e, DB: fakeDb([{ id: 'p1', screen_name: 'Grown-up One', avatar: 'owl' }]) };
  const response = await handleApi(req('/api/players', { cookie: `${gate}; ${who}` }), shrunk, '/api/players');
  assert.equal((await response.json()).me, null);
});

test('picking somebody who does not exist is refused', async () => {
  const e = env();
  const gate = await passGate(e);
  const response = await handleApi(
    req('/api/who', { method: 'POST', cookie: gate, body: JSON.stringify({ id: 'p99' }) }),
    e,
    '/api/who',
  );
  assert.equal(response.status, 404);
  assert.equal(cookieFrom(response, WHO_COOKIE), null);
});

test('picking nobody clears the cookie, which is the shared tablet', async () => {
  const e = env();
  const gate = await passGate(e);
  const response = await handleApi(
    req('/api/who', { method: 'POST', cookie: gate, body: JSON.stringify({ id: null }) }),
    e,
    '/api/who',
  );
  assert.deepEqual(await response.json(), { me: null });
  assert.match(
    (response.headers.getSetCookie() || []).find((c) => c.startsWith(`${WHO_COOKIE}=`)) || '',
    /Max-Age=0/,
  );
});

test('bad JSON, wrong methods and unknown paths answer in JSON', async () => {
  const e = env();
  const gate = await passGate(e);

  const bad = await handleApi(
    req('/api/who', { method: 'POST', cookie: gate, body: 'not json' }),
    e,
    '/api/who',
  );
  assert.equal(bad.status, 400);

  const wrongMethod = await handleApi(req('/api/players', { method: 'POST', cookie: gate }), e, '/api/players');
  assert.equal(wrongMethod.status, 405);
  assert.equal(wrongMethod.headers.get('allow'), 'GET');

  const unknown = await handleApi(req('/api/nothing', { cookie: gate }), e, '/api/nothing');
  assert.equal(unknown.status, 404);
  assert.equal((await unknown.json()).error, 'not_found');
});

test('with no database binding the api says which setup task is missing', async () => {
  const e = env();
  const gate = await passGate(e);
  const response = await handleApi(req('/api/players', { cookie: gate }), { ...e, DB: undefined }, '/api/players');
  assert.equal(response.status, 503);
  assert.match((await response.json()).detail, /A2/);
});

test('nothing here is cacheable', async () => {
  const e = env();
  const gate = await passGate(e);
  const response = await handleApi(req('/api/players', { cookie: gate }), e, '/api/players');
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.equal((await handleGate(req('/gate'), e)).headers.get('cache-control'), 'no-store');
});
