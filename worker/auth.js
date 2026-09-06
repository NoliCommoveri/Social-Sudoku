// The signing half of identity, and the only part of it with a decision in it.
// Strings in, values out: nothing here knows what a Request is, which is what
// lets `node --test` cover it. worker/gate.js and worker/api.js are the halves
// that touch requests and hold no logic worth testing.
//
// Two cookies, both signed with SESSION_SECRET (docs/identity-and-stats.md
// §3.3):
//
//   gate  proof the family passphrase was entered on this device
//   who   the player id last picked here
//
// Signing is the whole difference between "the client says it is player 3" and
// "the server issued this". Neither cookie is secret -- a player id is on the
// screen -- so nothing here encrypts. What it does is make a value the server
// did not issue unusable, which is what stops a stray script writing results as
// somebody else.

/** Both cookies last a year. A device that is ours today still is in a year. */
export const COOKIE_MAX_AGE = 365 * 24 * 60 * 60;

export const GATE_COOKIE = 'gate';
export const WHO_COOKIE = 'who';

const encoder = new TextEncoder();

/** @param {ArrayBuffer | Uint8Array} bytes */
function b64url(bytes) {
  let binary = '';
  for (const byte of new Uint8Array(bytes)) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');
}

/** @param {string} text @returns {Uint8Array} */
function unb64url(text) {
  const padded = text.replaceAll('-', '+').replaceAll('_', '/');
  const binary = atob(padded + '='.repeat((4 - (padded.length % 4)) % 4));
  return Uint8Array.from(binary, (ch) => ch.charCodeAt(0));
}

/** @param {string} secret */
function key(secret) {
  return crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
}

/**
 * A short, stable fingerprint of a secret. Used to bind a `gate` cookie to the
 * passphrase that issued it, so that changing FAMILY_PASSPHRASE turns every
 * gate cookie in the house into one that no longer verifies. That is the whole
 * of the "lock the site again" story, and it is why the fingerprint sits inside
 * the signed payload rather than being compared separately.
 *
 * Twelve hex characters of SHA-256. It travels in a cookie the family can read
 * in devtools, so it is deliberately too short to attack the passphrase with
 * and long enough that two passphrases will not collide.
 *
 * @param {string} secret
 * @returns {Promise<string>}
 */
export async function fingerprint(secret) {
  const digest = await crypto.subtle.digest('SHA-256', encoder.encode(secret));
  return [...new Uint8Array(digest)]
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
    .slice(0, 12);
}

/**
 * @typedef {{ k: string, exp: number, [key: string]: any }} Payload
 */

/**
 * Signs a payload into a cookie value: `<payload>.<hmac>`, both base64url.
 *
 * The payload is JSON and travels in the clear. `exp` is a millisecond
 * timestamp and is inside the signature, so a client that edits it invalidates
 * the cookie rather than extending it -- which is the reason expiry is not left
 * to the cookie's own Max-Age, the one number the browser will happily change.
 *
 * @param {string} secret
 * @param {Payload} payload
 * @returns {Promise<string>}
 */
export async function sign(secret, payload) {
  const body = b64url(encoder.encode(JSON.stringify(payload)));
  const mac = await crypto.subtle.sign('HMAC', await key(secret), encoder.encode(body));
  return `${body}.${b64url(mac)}`;
}

/** Length-independent equality. Both arguments are base64url of a fixed-size MAC. */
function sameMac(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/**
 * Verifies a cookie value and returns its payload, or null.
 *
 * Null covers every way a cookie can be no good -- absent, malformed, signed
 * with a different secret, edited, expired, or the wrong kind -- because the
 * caller does the same thing in all of them: show the gate, or forget who you
 * are. Telling them apart would only ever be a message to somebody attacking
 * it.
 *
 * @param {string | null | undefined} secret
 * @param {string | null | undefined} value
 * @param {string} kind the `k` the payload must carry
 * @param {number} [now]
 * @returns {Promise<Payload | null>}
 */
export async function verify(secret, value, kind, now = Date.now()) {
  if (!secret || !value) return null;
  const dot = value.lastIndexOf('.');
  if (dot <= 0) return null;

  const body = value.slice(0, dot);
  const mac = value.slice(dot + 1);

  let expected;
  try {
    expected = b64url(await crypto.subtle.sign('HMAC', await key(secret), encoder.encode(body)));
  } catch {
    return null;
  }
  if (!sameMac(mac, expected)) return null;

  try {
    const payload = JSON.parse(new TextDecoder().decode(unb64url(body)));
    if (!payload || typeof payload !== 'object') return null;
    if (payload.k !== kind) return null;
    if (typeof payload.exp !== 'number' || payload.exp <= now) return null;
    return payload;
  } catch {
    return null;
  }
}

/**
 * Whether two secrets are the same, compared as digests rather than as strings.
 *
 * Hashing first is what makes the comparison constant-time in the length of the
 * inputs as well as their contents: two SHA-256 digests are always 32 bytes, so
 * a wrong passphrase of the wrong length takes exactly as long to reject as a
 * wrong one of the right length.
 *
 * @param {string} a
 * @param {string} b
 * @returns {Promise<boolean>}
 */
export async function secretEquals(a, b) {
  const [da, db] = await Promise.all([
    crypto.subtle.digest('SHA-256', encoder.encode(a)),
    crypto.subtle.digest('SHA-256', encoder.encode(b)),
  ]);
  return sameMac(b64url(da), b64url(db));
}

/**
 * What the gate compares. Case and surrounding space are thrown away on both
 * sides, because the passphrase is typed by a 5-year-old on an Android
 * keyboard that capitalises the first letter whatever anyone wants. The
 * entropy that costs is entropy this gate was never relying on -- it exists to
 * keep the open internet out of the leaderboard, not to survive an attack
 * (docs/identity-and-stats.md §2).
 *
 * @param {string | null | undefined} text
 * @returns {string}
 */
export function normalisePassphrase(text) {
  return String(text || '').trim().toLowerCase();
}

/**
 * The value of one cookie from a Cookie header. Cookie values here are
 * base64url and a dot, so nothing needs decoding.
 *
 * @param {string | null | undefined} header
 * @param {string} name
 * @returns {string | null}
 */
export function readCookie(header, name) {
  for (const part of (header || '').split(';')) {
    const trimmed = part.trim();
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    if (trimmed.slice(0, eq) === name) return trimmed.slice(eq + 1);
  }
  return null;
}

/**
 * A Set-Cookie line. `Secure` is unconditional: this site is only ever reached
 * over https, and a cookie that would also travel over http is one that can be
 * stripped by anything between the phone and Cloudflare.
 *
 * SameSite=Lax rather than Strict, because the family opens this site from a
 * chat message and a Strict cookie is not sent on that first navigation -- the
 * gate would ask again every time, which is exactly what it promises not to do.
 *
 * @param {string} name
 * @param {string} value
 * @param {number} [maxAge] seconds; 0 deletes
 */
export function cookieHeader(name, value, maxAge = COOKIE_MAX_AGE) {
  return `${name}=${value}; Path=/; Max-Age=${maxAge}; HttpOnly; SameSite=Lax; Secure`;
}

/**
 * Where to send someone after the gate. Only a path on this site: anything
 * else -- an absolute URL, a protocol-relative `//host`, a backslash Chrome
 * normalises into one, whitespace or a control character smuggling a header --
 * becomes `/`.
 *
 * An open redirect on a family game site is not much of a prize. It is four
 * lines to not have one.
 *
 * @param {string | null | undefined} next
 * @returns {string}
 */
export function safeNext(next) {
  if (!next || typeof next !== 'string') return '/';
  if (next[0] !== '/') return '/';
  if (next[1] === '/' || next[1] === '\\') return '/';
  if (/[\u0000-\u0020\u007f]/.test(next)) return '/';
  return next;
}
