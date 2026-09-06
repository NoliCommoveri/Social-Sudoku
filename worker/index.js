// The Worker's whole surface. Static assets are matched before this script runs
// at all, so everything arriving here is a path with no file behind it.
//
//   /admin, /admin/*   the database admin page (worker/admin.js)
//   /gate              the passphrase page (worker/gate.js)
//   /api/*             the site's own endpoints (worker/api.js), gated
//   anything else      handed back to public/ via the assets binding, which
//                      answers with the file if there is one and a 404 if not
//
// The gate sits in front of /api/* and nothing else. Two consequences worth
// stating rather than discovering:
//
// - **The shell is public; the data is not.** public/index.html is a file, so
//   it is served before this script runs and cannot be gated without giving up
//   the assets binding. It renders a page with no names, no faces and no
//   record on it, then asks /api/players, which is where the gate answers.
// - **/admin is exempt on purpose.** It has to render before a passphrase
//   exists, and the passphrase is a Worker secret rather than a row, so a gated
//   /admin is a database that can never be brought up. worker/gate.js says the
//   rest of that reasoning.

import { handleAdmin } from './admin.js';
import { handleGate } from './gate.js';
import { handleApi } from './api.js';

/**
 * @type {ExportedHandler<{
 *   DB?: D1Database,
 *   ASSETS: Fetcher,
 *   FAMILY_PASSPHRASE?: string,
 *   SESSION_SECRET?: string,
 * }>}
 */
export default {
  async fetch(request, env) {
    const admin = await handleAdmin(request, env);
    if (admin) return admin;

    const gate = await handleGate(request, env);
    if (gate) return gate;

    const { pathname } = new URL(request.url);
    if (pathname === '/api' || pathname.startsWith('/api/')) {
      return handleApi(request, env, pathname);
    }

    return env.ASSETS.fetch(request);
  },
};
