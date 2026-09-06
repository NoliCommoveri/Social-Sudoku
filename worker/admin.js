// The database admin page. Server-rendered HTML, no client JavaScript, no
// fetch: the actions are <form method="post">. A page that needs JavaScript to
// tell you the database is broken fails exactly when it is needed, and with no
// CLI there is no log to fall back on.
//
// Its styles are inline for the same reason. It has to render when public/ is
// mid-deploy, when no table exists, and before the gate exists at all.
//
// Erase everything is not here and is not here disabled. A greyed-out button is
// a promise; Session B is a better place to make it than a tooltip is.

import { MIGRATIONS, SEEDS } from './db/migrations.js';
import { currentPlan, applyPending, runSeeds } from './db/apply.js';

/** @param {unknown} value */
function esc(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

/** Checksums are 64 characters and compared by eye. Show enough to compare. */
const short = (sum) => (sum ? `${sum.slice(0, 12)}…` : '—');

/** @param {number | null} ms */
const when = (ms) => (ms ? new Date(ms).toISOString().replace('T', ' ').slice(0, 19) : '—');

const STYLES = `
  :root { color-scheme: dark; --ink: #e8ecf2; --soft: #97a2b3; --edge: #333c4a;
          --ground: #14181f; --panel: #1b212b; --stop: #ff6b6b; --go: #6bd39a; }
  * { box-sizing: border-box; }
  body { margin: 0; padding: 1.5rem 1rem 4rem; font: 15px/1.5 system-ui, sans-serif;
         color: var(--ink); background: var(--ground); }
  main { max-width: 52rem; margin: 0 auto; display: grid; gap: 1.75rem; }
  h1 { margin: 0; font-size: 1.4rem; }
  h2 { margin: 0 0 .5rem; font-size: 1rem; color: var(--soft); font-weight: 600;
       text-transform: uppercase; letter-spacing: .06em; }
  p { margin: 0 0 .5rem; color: var(--soft); }
  table { width: 100%; border-collapse: collapse; font-size: .9rem; }
  th, td { text-align: left; padding: .5rem .6rem; border-bottom: 1px solid var(--edge);
           vertical-align: top; }
  th { color: var(--soft); font-weight: 600; }
  code, pre { font-family: ui-monospace, monospace; font-size: .85rem; }
  pre { background: var(--panel); border: 1px solid var(--edge); border-radius: .5rem;
        padding: .75rem; overflow-x: auto; white-space: pre-wrap; word-break: break-word;
        margin: .5rem 0 0; }
  .state { font-weight: 700; }
  .applied { color: var(--go); }
  .pending { color: var(--ink); }
  .drifted { color: var(--stop); }
  .panel { background: var(--panel); border: 1px solid var(--edge); border-radius: .75rem;
           padding: 1rem; }
  .panel.bad { border-color: var(--stop); }
  .panel.bad h2 { color: var(--stop); }
  form { display: inline; }
  button { font: inherit; font-weight: 600; color: var(--ink); background: #2b3442;
           border: 1px solid var(--edge); border-radius: .6rem; padding: .7rem 1.1rem;
           min-height: 44px; cursor: pointer; }
  button:hover { background: #35414f; }
  .actions { display: flex; gap: .75rem; flex-wrap: wrap; }
`;

/**
 * @param {string} body
 * @param {number} [status]
 */
function page(body, status = 200) {
  return new Response(
    `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Gameroom database</title>
<link rel="icon" href="data:,">
<style>${STYLES}</style>
</head>
<body>
<main>
<h1>Gameroom database</h1>
${body}
</main>
</body>
</html>`,
    { status, headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' } },
  );
}

/** @param {import('./db/apply.js').RunOutcome | null} outcome */
function renderOutcome(outcome) {
  if (!outcome) return '';
  const parts = [`<p>${esc(outcome.message)}</p>`];
  if (outcome.ran.length > 0) parts.push(`<p>Ran: <code>${esc(outcome.ran.join(', '))}</code></p>`);
  if (outcome.skipped) parts.push(`<p>Not attempted: <code>${esc(outcome.skipped)}</code></p>`);
  if (outcome.failure) {
    parts.push(`<p>Error from <code>${esc(outcome.failure.name)}</code>:</p>`);
    parts.push(`<pre>${esc(outcome.failure.error)}</pre>`);
    parts.push(
      outcome.failure.statement
        ? `<p>The statement it came from:</p><pre>${esc(outcome.failure.statement)}</pre>`
        : '<p>The statement could not be narrowed down; the whole file failed to run.</p>',
    );
  }
  return `<section class="panel${outcome.ok ? '' : ' bad'}">
  <h2>Last action</h2>
  ${parts.join('\n  ')}
</section>`;
}

/** @param {Awaited<ReturnType<typeof currentPlan>>} plan */
function renderStatus(plan) {
  const rows = plan.entries.map((entry) => {
    const drift = entry.state === 'drifted'
      ? `<br><span class="drifted">file ${esc(short(entry.fileChecksum))} ≠ ledger ${esc(short(entry.ledgerChecksum))}</span>`
      : '';
    return `<tr>
    <td><code>${esc(entry.name)}</code>${drift}</td>
    <td class="state ${entry.state}">${entry.state}</td>
    <td>${esc(when(entry.appliedAt))}</td>
  </tr>`;
  });

  const empty = plan.ledgerExists
    ? ''
    : '<p>This database has no tables yet. Everything below is pending, which is what a fresh database looks like.</p>';

  return `<section>
  <h2>Migrations</h2>
  ${empty}
  <table>
    <thead><tr><th>File</th><th>State</th><th>Applied</th></tr></thead>
    <tbody>
${rows.join('\n')}
    </tbody>
  </table>
</section>`;
}

/** @param {Awaited<ReturnType<typeof currentPlan>>} plan */
function renderProblems(plan) {
  const blocks = [];

  if (plan.drifted.length > 0) {
    blocks.push(`<section class="panel bad">
  <h2>Drifted</h2>
  <p><code>${esc(plan.drifted.join(', '))}</code> changed after being applied. It will not be
  reapplied, and the schema in this database is not the schema in the files.</p>
  <p>The fix is Erase everything, then Apply pending, then Run seed. Export first — erase
  drops the play record and that is the one thing here that cannot be regenerated.</p>
</section>`);
  }

  if (plan.orphans.length > 0) {
    blocks.push(`<section class="panel bad">
  <h2>Orphaned ledger rows</h2>
  <p><code>${esc(plan.orphans.map((row) => row.name).join(', '))}</code> ran against this database
  and is no longer in <code>MIGRATIONS</code>. A deleted migration is drift of a different kind:
  the database carries a schema change nothing in the repo describes.</p>
</section>`);
  }

  if (plan.outOfOrder.length > 0) {
    blocks.push(`<section class="panel bad">
  <h2>Out of order</h2>
  <p><code>${esc(plan.outOfOrder.join(', '))}</code> is pending but sorts before a migration that
  has already run. The files were edited under a live database. Apply pending refuses this rather
  than building a schema no fresh database would ever have.</p>
</section>`);
  }

  return blocks.join('\n');
}

function renderSeeds() {
  const rows = SEEDS.map((seed) => `<tr><td><code>${esc(seed.name)}</code></td></tr>`);
  return `<section>
  <h2>Seeds</h2>
  <p>Not checksummed and not recorded. Run seed re-runs all of them, whole, on every press;
  every statement is <code>INSERT … ON CONFLICT DO NOTHING</code>, so a second press changes
  nothing. This is what lets a seed file grow by editing it in the web editor.</p>
  <table><tbody>
${rows.join('\n')}
  </tbody></table>
</section>`;
}

const ACTIONS = `<section class="actions">
  <form method="post" action="/admin/apply"><button type="submit">Apply pending</button></form>
  <form method="post" action="/admin/seed"><button type="submit">Run seed</button></form>
</section>`;

/**
 * @param {D1Database | undefined} db
 * @param {import('./db/apply.js').RunOutcome | null} outcome
 */
async function render(db, outcome) {
  if (!db) {
    return page(
      `<section class="panel bad">
  <h2>No database binding</h2>
  <p>The Worker has no <code>DB</code> binding. Create the D1 database in the Cloudflare
  dashboard — D1 → Create → <code>gameroom</code> — and paste its id into
  <code>wrangler.jsonc</code>. That is setup task A2 in <code>docs/architecture.md</code> §8.</p>
</section>`,
      500,
    );
  }

  let plan;
  try {
    plan = await currentPlan(db, MIGRATIONS);
  } catch (err) {
    return page(
      `${renderOutcome(outcome)}
<section class="panel bad">
  <h2>Could not read the database</h2>
  <pre>${esc(String(err && err.message ? err.message : err))}</pre>
</section>`,
      500,
    );
  }

  return page([
    renderOutcome(outcome),
    renderProblems(plan),
    renderStatus(plan),
    ACTIONS,
    renderSeeds(),
  ].filter(Boolean).join('\n'));
}

/**
 * `/admin`, `/admin/apply`, `/admin/seed`. Returns null for anything else so
 * the caller can carry on routing.
 *
 * The posts render their result directly rather than redirecting. A redirect
 * would lose the failing statement, which is the one thing this page exists to
 * show. Refreshing re-posts, and both actions are safe to repeat.
 *
 * There is no login. Session C's gate must keep this route exempt: the admin
 * page has to render before a passphrase exists and while the database that
 * would answer for one is empty.
 *
 * @param {Request} request
 * @param {{ DB?: D1Database }} env
 * @returns {Promise<Response | null>}
 */
export async function handleAdmin(request, env) {
  const { pathname } = new URL(request.url);
  if (pathname !== '/admin' && pathname !== '/admin/apply' && pathname !== '/admin/seed') {
    return null;
  }

  if (pathname === '/admin') {
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      return new Response('Method not allowed', { status: 405, headers: { allow: 'GET' } });
    }
    return render(env.DB, null);
  }

  if (request.method !== 'POST') {
    return new Response('Method not allowed', { status: 405, headers: { allow: 'POST' } });
  }
  if (!env.DB) return render(undefined, null);

  const outcome = pathname === '/admin/apply'
    ? await applyPending(env.DB, MIGRATIONS)
    : await runSeeds(env.DB, SEEDS);

  return render(env.DB, outcome);
}
