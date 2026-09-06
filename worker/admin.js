// The database admin page. Server-rendered HTML, no client JavaScript, no
// fetch: the actions are <form method="post">. A page that needs JavaScript to
// tell you the database is broken fails exactly when it is needed, and with no
// CLI there is no log to fall back on.
//
// Its styles are inline for the same reason. It has to render when public/ is
// mid-deploy, when no table exists, and before the gate exists at all.
//
// Three of its seven routes destroy or restore data, and the export is what
// makes the destructive one survivable: GET /admin/export hands back the
// backup and sets a ten-minute cookie holding the fingerprint of the snapshot
// it just served, and the erase confirmation refuses without that cookie, or
// with one that no longer matches the live database. That is how the backup
// becomes a step nobody can walk past with no client JavaScript and no secret
// -- SESSION_SECRET is Session C's and this could not wait for it. It is a
// guardrail against forgetting, not a lock: anyone who can reach /admin can
// erase, which was already true of Apply pending.
//
// docs/hub/specs/phase-2-session-b-erase-export.md is the design.

import { MIGRATIONS, SEEDS } from './db/migrations.js';
import {
  currentPlan,
  applyPending,
  runSeeds,
  readLedger,
  exportAll,
  eraseAll,
  importAll,
} from './db/apply.js';
import { parseBackup, schemaDrift } from './db/backup.js';

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
  form.block { display: grid; gap: .6rem; justify-items: start; }
  input[type="text"], input[type="file"] { font: inherit; color: var(--ink); background: var(--ground);
           border: 1px solid var(--edge); border-radius: .6rem; padding: .6rem .7rem; min-height: 44px;
           max-width: 100%; }
  button.stop { background: #4a2630; border-color: var(--stop); color: #ffd7d7; }
  button.stop:hover { background: #5d2f3b; }
  ul { margin: .5rem 0 0; padding-left: 1.1rem; color: var(--soft); }
  li { margin: .15rem 0; }
  a { color: var(--ink); }
  .big { font-size: 1.05rem; font-weight: 700; }
`;

/**
 * @param {string} body
 * @param {number} [status]
 * @param {Record<string, string>} [extra]
 */
function page(body, status = 200, extra = {}) {
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
    {
      status,
      headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', ...extra },
    },
  );
}

/** @param {import('./db/apply.js').RunOutcome | null} outcome */
function renderOutcome(outcome) {
  if (!outcome) return '';
  const parts = [`<p>${esc(outcome.message)}</p>`];
  if (outcome.ran.length > 0) parts.push(`<p>Ran: <code>${esc(outcome.ran.join(', '))}</code></p>`);
  if (outcome.skipped) parts.push(`<p>Not attempted: <code>${esc(outcome.skipped)}</code></p>`);
  if (outcome.notes && outcome.notes.length > 0) {
    parts.push(`<ul>\n    ${outcome.notes.map((note) => `<li>${esc(note)}</li>`).join('\n    ')}\n  </ul>`);
  }
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

// Export is a link rather than a form because it is a read: bookmarkable,
// repeatable, and safe to press when nothing is wrong. It is also the only copy
// of the play record that ever leaves the database, which is why it says so.
const BACKUP = `<section>
  <h2>Backup</h2>
  <p>Everything except the migration ledger, as JSON. The ledger is rebuilt by Apply pending and
  restoring it would claim files had been applied that may no longer read the same way.</p>
  <p><a class="big" href="/admin/export" target="_blank" rel="noopener">Download a backup</a></p>
</section>`;

const RESTORE = `<section>
  <h2>Restore</h2>
  <p>Import a backup into the schema this database has <em>now</em>. Tables and columns the schema
  no longer has are skipped and named; columns it has gained take their defaults. Every insert is
  <code>INSERT OR IGNORE</code>, so importing the same file twice changes nothing the second time
  and never overwrites a row that is already there.</p>
  <form class="block" method="post" action="/admin/import" enctype="multipart/form-data">
    <input type="file" name="backup" accept="application/json,.json" required>
    <button type="submit">Import</button>
  </form>
</section>`;

// Last on the page and in its own red panel, because a destructive button next
// to Run seed is a mis-tap waiting for a 360px screen.
const DANGER = `<section class="panel bad">
  <h2>Danger</h2>
  <p>Erase everything drops every table, the migration ledger included. That is the schema-change
  path here rather than a bug: everything comes back with Apply pending and Run seed, reading the
  files as they now are. What does not come back is the play record — export first.</p>
  <form method="post" action="/admin/erase"><button class="stop" type="submit">Erase everything</button></form>
</section>`;

/**
 * @param {D1Database | undefined} db
 * @param {import('./db/apply.js').RunOutcome | null} outcome
 * @param {Record<string, string>} [headers]
 */
async function render(db, outcome, headers = {}) {
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
    BACKUP,
    RESTORE,
    DANGER,
  ].filter(Boolean).join('\n'), 200, headers);
}

/**
 * The erase confirmation. It carries the download rather than pointing at it
 * from somewhere else, and it says what is about to go in numbers, because
 * "every table" is not a quantity anyone can feel.
 *
 * @param {import('./db/backup.js').BackupDoc} doc
 * @param {string | null} problem
 */
function renderConfirm(doc, problem) {
  const rows = doc.tables.map(
    (table) => `<tr><td><code>${esc(table.name)}</code></td><td>${table.rows.length}</td></tr>`,
  );
  const counts = rows.length > 0
    ? `<table>
    <thead><tr><th>Table</th><th>Rows</th></tr></thead>
    <tbody>
${rows.join('\n')}
    </tbody>
  </table>`
    : '<p>There are no tables to drop. Erasing this database changes nothing.</p>';

  const blocked = problem
    ? `<section class="panel bad">
  <h2>Not yet</h2>
  <p>${esc(problem)}</p>
</section>`
    : '';

  return page(`${blocked}
<section class="panel bad">
  <h2>Erase everything</h2>
  ${counts}
  <p>Every one of those tables goes, and the migration ledger with them. Apply pending and Run seed
  rebuild the schema and the placeholders; nothing rebuilds the rows.</p>
</section>
<section>
  <h2>1 — Take the backup</h2>
  <p>The button below does not work until you have. Opening it in a new tab leaves this page where
  it is.</p>
  <p><a class="big" href="/admin/export" target="_blank" rel="noopener">Download the backup</a></p>
</section>
<section>
  <h2>2 — Confirm</h2>
  <form class="block" method="post" action="/admin/erase/confirm">
    <p>Type <code>erase</code>:</p>
    <input type="text" name="confirm" autocomplete="off" autocapitalize="none" spellcheck="false" required>
    <button class="stop" type="submit">Erase everything, permanently</button>
  </form>
</section>
<section class="actions">
  <form method="get" action="/admin"><button type="submit">Cancel</button></form>
</section>`);
}

/**
 * The cookie a download leaves behind. Not a credential — a receipt.
 *
 * SameSite=Strict earns its place beyond the obvious: a POST from somewhere
 * else on the internet does not carry this cookie, so the one route here that
 * destroys data refuses a cross-site press by the same check that refuses a
 * forgetful one. The routes that only write still have nothing in front of
 * them, which is Session C's gate to decide.
 */
const ERASE_COOKIE = 'erase_ok';
const COOKIE_ATTRS = 'Path=/admin; HttpOnly; SameSite=Strict; Secure';

/**
 * @param {Request} request
 * @param {string} name
 * @returns {string | null}
 */
function readCookie(request, name) {
  for (const part of (request.headers.get('cookie') || '').split(';')) {
    const [key, ...rest] = part.trim().split('=');
    if (key === name) return rest.join('=');
  }
  return null;
}

/** A backup bigger than this is not from this project. */
const MAX_IMPORT_BYTES = 8 * 1024 * 1024;

/** @param {string} message @returns {import('./db/apply.js').RunOutcome} */
const refused = (message) => ({ ok: false, ran: [], skipped: '', message, failure: null });

/** @param {string} body @param {string} fingerprint */
function exportResponse(body, fingerprint) {
  const now = new Date().toISOString();
  const name = `gameroom-${now.slice(0, 10)}-${now.slice(11, 13)}${now.slice(14, 16)}.json`;
  return new Response(body, {
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'content-disposition': `attachment; filename="${name}"`,
      'cache-control': 'no-store',
      'set-cookie': `${ERASE_COOKIE}=${fingerprint}; Max-Age=600; ${COOKIE_ATTRS}`,
    },
  });
}

/** GET routes answer HEAD too; everything that changes the database is a POST. */
const ROUTES = new Map([
  ['/admin', 'GET'],
  ['/admin/export', 'GET'],
  ['/admin/apply', 'POST'],
  ['/admin/seed', 'POST'],
  ['/admin/erase', 'POST'],
  ['/admin/erase/confirm', 'POST'],
  ['/admin/import', 'POST'],
]);

/**
 * Every /admin route. Returns null for anything else so the caller can carry on
 * routing.
 *
 * The posts render their result directly rather than redirecting. A redirect
 * would lose the failing statement, which is the one thing this page exists to
 * show. Refreshing re-posts, and every action here is safe to repeat: apply and
 * seed by their own rules, import because it is INSERT OR IGNORE, erase because
 * a database with no tables has nothing to drop.
 *
 * There is no login. Session C's gate must keep at least /admin exempt: the
 * page has to render before a passphrase exists and while the database that
 * would answer for one is empty. Whether it covers the three destructive routes
 * is C's to decide.
 *
 * @param {Request} request
 * @param {{ DB?: D1Database }} env
 * @returns {Promise<Response | null>}
 */
export async function handleAdmin(request, env) {
  const { pathname } = new URL(request.url);
  const method = ROUTES.get(pathname);
  if (!method) return null;

  const allowed = method === 'GET'
    ? request.method === 'GET' || request.method === 'HEAD'
    : request.method === 'POST';
  if (!allowed) {
    return new Response('Method not allowed', { status: 405, headers: { allow: method } });
  }

  const db = env.DB;
  if (!db) return render(undefined, null);

  try {
    return await route(request, db, pathname);
  } catch (err) {
    // Anything unexpected renders here rather than as a bare 500. With no CLI
    // this page is the only place an error from the database can be read, and
    // that is as true of a thrown one as of a failed statement.
    return render(db, {
      ok: false,
      ran: [],
      skipped: '',
      message: 'That action failed before it could report anything.',
      failure: {
        name: pathname,
        statement: null,
        error: String(err && err.message ? err.message : err),
      },
    });
  }
}

/**
 * @param {Request} request
 * @param {D1Database} db
 * @param {string} pathname
 * @returns {Promise<Response>}
 */
async function route(request, db, pathname) {
  if (pathname === '/admin') return render(db, null);

  if (pathname === '/admin/export') {
    const { body, fingerprint } = await exportAll(db);
    return exportResponse(body, fingerprint);
  }

  if (pathname === '/admin/apply') return render(db, await applyPending(db, MIGRATIONS));
  if (pathname === '/admin/seed') return render(db, await runSeeds(db, SEEDS));

  if (pathname === '/admin/erase') {
    const { doc } = await exportAll(db);
    return renderConfirm(doc, null);
  }

  if (pathname === '/admin/erase/confirm') {
    const form = await request.formData();
    const typed = String(form.get('confirm') || '').trim().toLowerCase();
    const receipt = readCookie(request, ERASE_COOKIE);
    const fresh = await exportAll(db);

    // In this order: the backup first, then whether it is still the truth, then
    // whether the press was deliberate.
    if (!receipt) {
      return renderConfirm(fresh.doc, 'Download the backup first. Nothing here works until you have, and there is no other copy of the play record.');
    }
    if (receipt !== fresh.fingerprint) {
      return renderConfirm(fresh.doc, 'The database has changed since that backup — somebody finished a game, or a seed ran. Download it again; the one you have is already out of date.');
    }
    if (typed !== 'erase') {
      return renderConfirm(fresh.doc, 'Type erase in the box to confirm. Nothing has been dropped.');
    }

    const outcome = await eraseAll(db);
    // The receipt is spent, and after this it points at a database that no
    // longer exists.
    return render(db, outcome, { 'set-cookie': `${ERASE_COOKIE}=; Max-Age=0; ${COOKIE_ATTRS}` });
  }

  // The only route left is /admin/import.
  const form = await request.formData();
  const file = form.get('backup');
  if (!file || typeof file === 'string') {
    return render(db, refused('Choose a backup file first.'));
  }
  const text = await file.text();
  if (text.length === 0) return render(db, refused('That file is empty.'));
  if (text.length > MAX_IMPORT_BYTES) {
    return render(db, refused('That file is larger than 8 MB, which no backup from this database is.'));
  }

  const parsed = parseBackup(text);
  if (!parsed.ok) return render(db, refused(parsed.error));

  const { rows: applied } = await readLedger(db);
  const warning = schemaDrift(parsed.doc, applied);
  const outcome = await importAll(db, parsed.doc);
  if (warning) outcome.notes = [warning, ...(outcome.notes || [])];
  return render(db, outcome);
}
