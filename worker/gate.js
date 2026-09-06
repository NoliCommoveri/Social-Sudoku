// The gate: one shared family passphrase, typed once per device
// (docs/identity-and-stats.md §2). Server-rendered, no client JavaScript, a
// plain <form method="post"> — the same reasoning as the admin page. A login
// screen that needs a script to work is a login screen that fails on the one
// device where the script did not load.
//
// What it is and is not: it keeps the open internet out of the leaderboard. It
// does not separate family members from each other, there is nothing behind it
// worth attacking, and the deterrent against a sibling logging in as their
// brother is that every play is timestamped and the family can see it.
//
// It does not cover /admin. That page has to render before a passphrase exists
// and while the database that would hold one is empty — and since the
// passphrase is a Worker secret rather than a row, gating /admin would mean a
// site that cannot apply its own schema until a secret is set. The routes that
// change the database are unguarded for the same reason they were in Session B:
// the erase confirmation guards itself with a backup receipt, and anyone who
// can reach /admin can already erase.

// The one place the Worker imports a client module. avatars.js is pure — no
// DOM, no window — so wrangler bundles it into the Worker as happily as the
// browser loads it, and the gate gets three real faces instead of three dots.
// The dependency only ever points this way: nothing under public/ imports from
// worker/.
import { avatarSvg, avatarTint } from '../public/shared/avatars.js';
import {
  GATE_COOKIE,
  cookieHeader,
  fingerprint,
  normalisePassphrase,
  readCookie,
  safeNext,
  secretEquals,
  sign,
  verify,
  COOKIE_MAX_AGE,
} from './auth.js';

/**
 * Whether this request carries a gate cookie this Worker issued, for the
 * passphrase currently set.
 *
 * The passphrase's fingerprint is inside the signed payload, so changing
 * FAMILY_PASSPHRASE logs every device out — that is the whole "lock it again"
 * story, and it needs no state anywhere.
 *
 * @param {Request} request
 * @param {{ SESSION_SECRET?: string, FAMILY_PASSPHRASE?: string }} env
 * @returns {Promise<boolean>}
 */
export async function throughGate(request, env) {
  if (!env.SESSION_SECRET || !env.FAMILY_PASSPHRASE) return false;
  const cookie = readCookie(request.headers.get('cookie'), GATE_COOKIE);
  const payload = await verify(env.SESSION_SECRET, cookie, 'gate');
  if (!payload) return false;
  return payload.pf === (await fingerprint(normalisePassphrase(env.FAMILY_PASSPHRASE)));
}

/** @param {unknown} value */
function esc(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

/**
 * The page. Styled from the shared tokens, so the first screen of the site
 * already looks like the site — but its layout is inline, because this page
 * has to render while public/ is mid-deploy.
 *
 * @param {string} body
 * @param {number} status
 * @param {Record<string, string>} [headers]
 */
function page(body, status, headers = {}) {
  return new Response(
    `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Carson Family Gameroom</title>
<link rel="icon" href="data:,">
<link rel="stylesheet" href="/shared/theme.css">
<style>
  body { display: grid; place-content: center; justify-items: center; gap: 1.5rem;
         padding: 2rem 1.25rem 4rem; text-align: center; }
  h1 { margin: 0; font-size: var(--step-4); letter-spacing: -0.02em; }
  p { margin: 0; max-width: 26rem; color: var(--ink-soft); font-size: var(--step-1); }
  form { display: grid; gap: 0.75rem; width: min(22rem, 100%); }
  input { min-height: var(--tap); padding: 0 1rem; font: inherit; font-size: var(--step-2);
          text-align: center; color: var(--ink); background: var(--panel);
          border: 2px solid var(--edge); border-radius: var(--radius); }
  input:focus { border-color: var(--accent); outline: none; }
  .wrong { color: var(--stop); font-weight: 700; }
  .marks { display: flex; gap: 0.5rem; }
  .marks .disc { --disc: 56px; }
</style>
</head>
<body>
${body}
</body>
</html>`,
    {
      status,
      headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', ...headers },
    },
  );
}

/**
 * Three faces from the avatar set, drawn on the gate so the first screen has
 * something on it for someone who cannot read the words yet.
 */
const FACES = `<div class="marks">
${['fox', 'rocket', 'frog']
  .map((key) => `  <span class="disc" style="color:${avatarTint(key)}">${avatarSvg(key)}</span>`)
  .join('\n')}
</div>`;

/** @param {string} next @param {string | null} problem */
function askPage(next, problem) {
  return page(
    `${FACES}
<h1>Carson Family Gameroom</h1>
<p>Type the family word. This device only asks once.</p>
${problem ? `<p class="wrong">${esc(problem)}</p>` : ''}
<form method="post" action="/gate">
  <input type="password" name="word" autocomplete="current-password" autocapitalize="none"
         autocorrect="off" spellcheck="false" required autofocus aria-label="Family word">
  <input type="hidden" name="next" value="${esc(next)}">
  <button class="btn btn-accent" type="submit">Come in</button>
</form>`,
    problem ? 401 : 200,
  );
}

/**
 * Before setup task A3 there is no passphrase, and there is no way to invent
 * one from here. Saying so beats a form that can never be right.
 */
function unsetPage() {
  return page(
    `<h1>Not set up yet</h1>
<p>This Worker has no <code>FAMILY_PASSPHRASE</code> or no <code>SESSION_SECRET</code>. Both are
set in the Cloudflare dashboard — Worker → Settings → Variables and Secrets → Encrypted. That is
setup task <strong>A3</strong> in <code>docs/architecture.md</code> §8.</p>
<p><code>/admin</code> works without them, which is deliberate: the database has to be able to come
up before anybody can be let in.</p>`,
    503,
  );
}

/** 303 rather than 302: the answer to a POST is a GET of somewhere else. */
function seeOther(location, headers = {}) {
  return new Response(null, { status: 303, headers: { location, 'cache-control': 'no-store', ...headers } });
}

/**
 * GET and POST /gate. Returns null for every other path.
 *
 * @param {Request} request
 * @param {{ SESSION_SECRET?: string, FAMILY_PASSPHRASE?: string }} env
 * @returns {Promise<Response | null>}
 */
export async function handleGate(request, env) {
  const url = new URL(request.url);
  if (url.pathname !== '/gate') return null;

  if (request.method !== 'GET' && request.method !== 'HEAD' && request.method !== 'POST') {
    return new Response('Method not allowed', { status: 405, headers: { allow: 'GET, POST' } });
  }

  if (!env.FAMILY_PASSPHRASE || !env.SESSION_SECRET) return unsetPage();

  if (request.method !== 'POST') {
    const next = safeNext(url.searchParams.get('next'));
    // Already in: the gate is not a page anybody should have to look at twice.
    if (await throughGate(request, env)) return seeOther(next);
    return askPage(next, null);
  }

  const form = await request.formData();
  const next = safeNext(String(form.get('next') || '/'));
  const word = normalisePassphrase(form.get('word'));

  if (!(await secretEquals(word, normalisePassphrase(env.FAMILY_PASSPHRASE)))) {
    return askPage(next, 'That is not the word. Ask somebody in the house.');
  }

  const value = await sign(env.SESSION_SECRET, {
    k: 'gate',
    pf: await fingerprint(normalisePassphrase(env.FAMILY_PASSPHRASE)),
    exp: Date.now() + COOKIE_MAX_AGE * 1000,
  });
  return seeOther(next, { 'set-cookie': cookieHeader(GATE_COOKIE, value) });
}
