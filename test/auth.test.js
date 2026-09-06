// The signed cookies. Everything here is the half of identity that decides
// something -- worker/auth.js -- and it takes strings rather than Requests,
// which is the whole reason CI can reach it.
//
// What these assert is one property stated five ways: a cookie this Worker did
// not issue does not verify. That property is what separates "the client says
// it is player 3" from "the server issued this", and Phase 3 writes play
// results on the strength of it.

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  COOKIE_MAX_AGE,
  cookieHeader,
  fingerprint,
  normalisePassphrase,
  readCookie,
  safeNext,
  secretEquals,
  sign,
  verify,
} from '../worker/auth.js';

const SECRET = 'a-long-random-session-secret-for-tests';
const HOUR = 60 * 60 * 1000;

/** @param {object} [extra] */
const gate = (extra = {}) => ({ k: 'gate', pf: 'abc123', exp: Date.now() + HOUR, ...extra });

test('a signed cookie verifies and gives its payload back', async () => {
  const value = await sign(SECRET, gate({ pf: 'deadbeef0000' }));
  const payload = await verify(SECRET, value, 'gate');
  assert.ok(payload);
  assert.equal(payload.k, 'gate');
  assert.equal(payload.pf, 'deadbeef0000');
});

test('a who cookie carries the player id', async () => {
  const value = await sign(SECRET, { k: 'who', id: 'p3', exp: Date.now() + HOUR });
  const payload = await verify(SECRET, value, 'who');
  assert.equal(payload && payload.id, 'p3');
});

test('a different secret does not verify', async () => {
  const value = await sign(SECRET, gate());
  assert.equal(await verify('some-other-secret', value, 'gate'), null);
});

// Rotating SESSION_SECRET is the whole of the "log everyone out" story, and it
// works because of the assertion above rather than because anything is deleted.

test('an edited payload does not verify', async () => {
  const value = await sign(SECRET, { k: 'who', id: 'p3', exp: Date.now() + HOUR });
  const [body, mac] = value.split('.');
  const forged = Buffer.from(JSON.stringify({ k: 'who', id: 'p1', exp: Date.now() + HOUR }))
    .toString('base64url');
  assert.equal(await verify(SECRET, `${forged}.${mac}`, 'who'), null);
});

test('a cookie of the wrong kind does not verify', async () => {
  const value = await sign(SECRET, gate());
  assert.equal(await verify(SECRET, value, 'who'), null);
});

test('expiry is inside the signature, so extending it invalidates the cookie', async () => {
  const value = await sign(SECRET, gate({ exp: Date.now() - 1 }));
  assert.equal(await verify(SECRET, value, 'gate'), null);

  const [, mac] = value.split('.');
  const stretched = Buffer.from(JSON.stringify(gate({ exp: Date.now() + HOUR })))
    .toString('base64url');
  assert.equal(await verify(SECRET, `${stretched}.${mac}`, 'gate'), null);
});

test('rubbish does not verify, and does not throw', async () => {
  for (const value of ['', '.', 'nodot', 'a.b', '...', 'eyJ9.zzzz', null, undefined]) {
    assert.equal(await verify(SECRET, value, 'gate'), null, `for ${JSON.stringify(value)}`);
  }
  assert.equal(await verify('', await sign(SECRET, gate()), 'gate'), null);
  assert.equal(await verify(undefined, await sign(SECRET, gate()), 'gate'), null);
});

test('a payload that is not an object does not verify', async () => {
  // Signed by us, so the MAC is right; it is the shape that is wrong.
  const body = Buffer.from(JSON.stringify('just a string')).toString('base64url');
  const value = await sign(SECRET, /** @type {any} */ ('ignored'));
  const mac = value.split('.')[1];
  assert.equal(await verify(SECRET, `${body}.${mac}`, 'gate'), null);
});

test('the passphrase fingerprint is stable, short, and separates passphrases', async () => {
  const one = await fingerprint('blue fox');
  assert.equal(one, await fingerprint('blue fox'));
  assert.equal(one.length, 12);
  assert.match(one, /^[0-9a-f]+$/);
  assert.notEqual(one, await fingerprint('blue socks'));
});

test('passphrases are compared without case or surrounding space', () => {
  assert.equal(normalisePassphrase('  Blue Fox  '), 'blue fox');
  assert.equal(normalisePassphrase('BLUE FOX'), normalisePassphrase('blue fox'));
  assert.equal(normalisePassphrase(null), '');
});

test('secretEquals matches only an equal secret', async () => {
  assert.equal(await secretEquals('blue fox', 'blue fox'), true);
  assert.equal(await secretEquals('blue fox', 'blue fo'), false);
  assert.equal(await secretEquals('blue fox', 'Blue Fox'), false);
  assert.equal(await secretEquals('', ''), true);
});

test('cookies are read by name from a Cookie header', () => {
  const header = 'gate=abc.def; who=ghi.jkl; other=1';
  assert.equal(readCookie(header, 'gate'), 'abc.def');
  assert.equal(readCookie(header, 'who'), 'ghi.jkl');
  assert.equal(readCookie(header, 'missing'), null);
  assert.equal(readCookie('', 'gate'), null);
  assert.equal(readCookie(null, 'gate'), null);
  // A prefix of a name is not that name.
  assert.equal(readCookie('gateway=x', 'gate'), null);
});

test('the Set-Cookie line carries the attributes identity depends on', () => {
  const line = cookieHeader('who', 'value.mac');
  assert.match(line, /^who=value\.mac;/);
  assert.match(line, /Path=\//);
  assert.match(line, /HttpOnly/);
  assert.match(line, /SameSite=Lax/);
  assert.match(line, /Secure/);
  assert.match(line, new RegExp(`Max-Age=${COOKIE_MAX_AGE}`));
  assert.match(cookieHeader('who', '', 0), /Max-Age=0/);
});

test('the gate only ever redirects to a path on this site', () => {
  assert.equal(safeNext('/sudoku/'), '/sudoku/');
  assert.equal(safeNext('/?a=1'), '/?a=1');
  for (const bad of [
    '//evil.example',
    '/\\evil.example',
    'https://evil.example',
    'javascript:alert(1)',
    '/next\nlocation: https://evil.example',
    '',
    null,
    undefined,
    42,
  ]) {
    assert.equal(safeNext(/** @type {any} */ (bad)), '/', `for ${JSON.stringify(bad)}`);
  }
});
