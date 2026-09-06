// The Worker's whole surface. Static assets are matched before this script runs
// at all, so everything arriving here is a path with no file behind it.
//
//   /admin, /admin/*   the database admin page (worker/admin.js)
//   /api/*             the site's own endpoints
//   anything else      handed back to public/ via the assets binding, which
//                      answers with the file if there is one and a 404 if not
//
// Session C adds the passphrase gate in front of /api/*. It must not cover
// /admin: that page has to render before a passphrase exists and before the
// players table that would hold one does.

import { handleAdmin } from './admin.js';

/** @type {ExportedHandler<{ DB?: D1Database, ASSETS: Fetcher }>} */
export default {
  async fetch(request, env) {
    const admin = await handleAdmin(request, env);
    if (admin) return admin;

    const { pathname } = new URL(request.url);
    if (pathname === '/api' || pathname.startsWith('/api/')) {
      return handleApi(request, env, pathname);
    }

    return env.ASSETS.fetch(request);
  },
};

/**
 * There is nothing behind /api/ yet. Session C brings the gate, /api/players
 * and the picker; Phase 3 brings /api/plays.
 *
 * Answering in JSON rather than falling through to the asset handler matters:
 * a fetch that gets an HTML 404 page back fails at `res.json()` with an error
 * that names the wrong problem.
 *
 * @param {Request} request
 * @param {{ DB?: D1Database }} env
 * @param {string} pathname
 * @returns {Promise<Response>}
 */
async function handleApi(request, env, pathname) {
  return Response.json(
    { error: 'not_found', path: pathname },
    { status: 404, headers: { 'cache-control': 'no-store' } },
  );
}
