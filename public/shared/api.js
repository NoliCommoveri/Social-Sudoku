// The client half of identity: four calls, and one rule about what happens when
// the gate says no.
//
// The shell is a static file and cannot be gated (worker/index.js says why), so
// the first thing any hub screen does is ask for data and find out. A 401 here
// is not an error to render — it is a navigation to /gate, carrying where we
// were so the gate can put us back.
//
// Nothing in here touches the DOM, and nothing outside it calls fetch.

/**
 * Thrown for anything the caller has to show a person.
 *
 * `field` is set when the server refused one field of a form rather than the
 * whole request — the editor puts the message beside that field, which is the
 * difference between "that did not work" and "somebody already has that face".
 */
export class ApiError extends Error {
  /** @param {string} message @param {number} status @param {string | null} [field] */
  constructor(message, status, field = null) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.field = field;
  }
}

/** Where the gate should send us back to. */
function here() {
  return location.pathname + location.search;
}

/**
 * @param {string} path
 * @param {RequestInit} [init]
 * @returns {Promise<any>}
 */
async function call(path, init) {
  let response;
  try {
    response = await fetch(path, { ...init, headers: { accept: 'application/json', ...(init && init.headers) } });
  } catch {
    // Offline, or the deploy is mid-flight. Both look the same from here and
    // both are worth saying out loud rather than showing an empty shelf.
    throw new ApiError('No answer from the gameroom. Check the wifi and try again.', 0);
  }

  if (response.status === 401) {
    location.replace(`/gate?next=${encodeURIComponent(here())}`);
    // The navigation is asynchronous; nothing after this should render.
    throw new ApiError('Going to the gate…', 401);
  }

  let body = null;
  try {
    body = await response.json();
  } catch {
    body = null;
  }

  if (!response.ok) {
    const detail = body && (body.detail || body.error);
    throw new ApiError(
      detail ? String(detail) : `That did not work (${response.status}).`,
      response.status,
      body && typeof body.field === 'string' ? body.field : null,
    );
  }
  return body;
}

/**
 * @typedef {{ id: string, name: string, avatar: string }} Player
 */

/**
 * Every live profile and which one this device is.
 *
 * One call rather than two: the shelf needs both to draw anything, and `me`
 * comes from an HttpOnly cookie the page cannot read for itself.
 *
 * @returns {Promise<{ players: Player[], me: string | null }>}
 */
export function getPlayers() {
  return call('/api/players');
}

/**
 * Remember, or forget, who is playing on this device.
 *
 * @param {string | null} id null clears it, which is what a shared tablet wants
 * @returns {Promise<{ me: string | null }>}
 */
export function setWho(id) {
  return call('/api/who', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ id }),
  });
}

/**
 * Make a new profile.
 *
 * `me` comes back because creating one on a device that had nobody picks it —
 * the server decides that, not this call, since only it can read the `who`
 * cookie (worker/api.js).
 *
 * @param {{ name: string, avatar: string }} profile
 * @returns {Promise<{ player: Player, me: string | null }>}
 */
export function createPlayer(profile) {
  return call('/api/players', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(profile),
  });
}

/**
 * Change a screen name, a face, or both. What is left out keeps its current
 * value.
 *
 * @param {string} id
 * @param {{ name?: string, avatar?: string }} changes
 * @returns {Promise<{ player: Player }>}
 */
export function updatePlayer(id, changes) {
  return call(`/api/players/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(changes),
  });
}
