// The site's own endpoints. Two of them this session, both about who you are.
//
//   GET  /api/players   every live profile, and which one this device is
//   POST /api/who       pick a profile on this device, or clear it
//
// Everything here is behind the gate, and `who` is only ever set from a signed
// cookie this Worker issued. That is the difference between "the client says it
// is player 3" and "the server issued this", and it is what will stop a stray
// script writing a play result as somebody else in Phase 3
// (docs/identity-and-stats.md §3.3).
//
// Reads only, still. Creating a profile and changing a name or a face are
// Session D, and this file is where they land.

import { WHO_COOKIE, COOKIE_MAX_AGE, cookieHeader, readCookie, sign, verify } from './auth.js';
import { throughGate } from './gate.js';

/** @param {unknown} body @param {number} [status] @param {Record<string,string>} [headers] */
function json(body, status = 200, headers = {}) {
  return Response.json(body, { status, headers: { 'cache-control': 'no-store', ...headers } });
}

/**
 * Live profiles, in a fixed order.
 *
 * Order is not cosmetic: the shelf does not reorder itself, because position is
 * how a pre-reader finds their own face (docs/design-language.md §2). Creation
 * order is the one order that never changes under them, and `id` breaks the tie
 * when a seed inserts six rows in the same millisecond.
 *
 * @param {D1Database} db
 */
async function livePlayers(db) {
  const { results } = await db
    .prepare(
      `SELECT id, screen_name, avatar FROM players
        WHERE retired_at IS NULL
        ORDER BY created_at, id`,
    )
    .all();
  return results.map((row) => ({
    id: String(row.id),
    name: String(row.screen_name),
    avatar: String(row.avatar),
  }));
}

/**
 * The player id in the `who` cookie, if it verifies and still names a live
 * player. A retired or deleted player reads as nobody rather than as an error:
 * the picker is the answer to both.
 *
 * @param {Request} request
 * @param {{ SESSION_SECRET?: string }} env
 * @param {{ id: string }[]} players
 * @returns {Promise<string | null>}
 */
async function currentWho(request, env, players) {
  const cookie = readCookie(request.headers.get('cookie'), WHO_COOKIE);
  const payload = await verify(env.SESSION_SECRET, cookie, 'who');
  if (!payload || typeof payload.id !== 'string') return null;
  return players.some((player) => player.id === payload.id) ? payload.id : null;
}

/**
 * Every /api/* request. The gate is checked here rather than in index.js so
 * that a refusal is JSON: a fetch that gets an HTML page back fails at
 * `res.json()` with an error naming the wrong problem, and the client needs to
 * be told to go to the gate rather than to guess.
 *
 * @param {Request} request
 * @param {{ DB?: D1Database, SESSION_SECRET?: string, FAMILY_PASSPHRASE?: string }} env
 * @param {string} pathname
 * @returns {Promise<Response>}
 */
export async function handleApi(request, env, pathname) {
  if (!(await throughGate(request, env))) {
    return json({ error: 'gate', gate: '/gate' }, 401);
  }
  if (!env.DB) {
    return json({ error: 'no_database', detail: 'The Worker has no DB binding. See docs/architecture.md §8, task A2.' }, 503);
  }

  if (pathname === '/api/players') {
    if (request.method !== 'GET') return json({ error: 'method' }, 405, { allow: 'GET' });
    const players = await livePlayers(env.DB);
    return json({ players, me: await currentWho(request, env, players) });
  }

  if (pathname === '/api/who') {
    if (request.method !== 'POST') return json({ error: 'method' }, 405, { allow: 'POST' });
    return pickWho(request, env, env.DB);
  }

  return json({ error: 'not_found', path: pathname }, 404);
}

/**
 * Picking who you are on this device, and unpicking.
 *
 * `{"id": null}` clears the cookie, which is the shared tablet's answer: the
 * next person gets the picker instead of somebody else's face. There is no
 * confirmation on either direction and no password, deliberately — switching is
 * one tap from the header and always will be.
 *
 * @param {Request} request
 * @param {{ SESSION_SECRET?: string }} env
 * @param {D1Database} db
 */
async function pickWho(request, env, db) {
  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'bad_body' }, 400);
  }
  const id = body && body.id === null ? null : String((body && body.id) || '');

  if (id === null) {
    return json({ me: null }, 200, { 'set-cookie': cookieHeader(WHO_COOKIE, '', 0) });
  }

  const players = await livePlayers(db);
  if (!players.some((player) => player.id === id)) {
    return json({ error: 'no_such_player', id }, 404);
  }

  const value = await sign(String(env.SESSION_SECRET), {
    k: 'who',
    id,
    exp: Date.now() + COOKIE_MAX_AGE * 1000,
  });
  return json({ me: id }, 200, { 'set-cookie': cookieHeader(WHO_COOKIE, value) });
}
