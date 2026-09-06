// What makes a profile a profile: the rules a screen name and an avatar have to
// pass, in one place both halves of the site can read.
//
// It lives under public/shared/ rather than worker/ for the same reason
// avatars.js does — the dependency across the two trees only ever points from
// worker/ into public/, never back (worker/README.md). So the Worker imports
// this file to decide, the editor imports it to say so before the round trip,
// and there is exactly one definition of "that name is too long".
//
// Pure: strings and arrays in, a problem or null out. No DOM, no database, no
// fetch. test/profile.test.js imports it directly.

import { avatar } from './avatars.js';

/**
 * Twenty characters. The shelf's bar shows a name beside a 48px face on a
 * 360px phone and ellipsises what does not fit, so a longer name is not a
 * longer name — it is the same name with a `…` on it.
 */
export const NAME_MAX = 20;

/**
 * A typed name as it will be stored.
 *
 * Surrounding space goes, runs of space collapse to one, and control
 * characters are dropped — an Android keyboard and a paste out of a chat
 * message both produce all three. Case is kept exactly as typed: this is the
 * name a 12-year-old chose, and the gate's passphrase is the only thing on the
 * site that lowercases anything.
 *
 * @param {unknown} text
 * @returns {string}
 */
export function normaliseName(text) {
  return String(text == null ? '' : text)
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * The avatars no longer on offer, given the other live players.
 *
 * Two live players may not hold the same face — it is how a pre-reader picks
 * their own row out, so uniqueness matters more than choice
 * (docs/identity-and-stats.md §3.1). The list passed in is *other* players, so
 * the face you already have is never taken away from you.
 *
 * @param {{ avatar: string }[]} others
 * @returns {Set<string>}
 */
export function takenAvatars(others) {
  return new Set(others.map((player) => player.avatar));
}

/**
 * Whether a proposed profile can be saved.
 *
 * Returns the first problem as a field and a sentence, or null. The field is
 * what the editor puts the message beside; the sentence is written to be read
 * by an 11-year-old rather than parsed by a client.
 *
 * The same call runs in the browser for the instant answer and in the Worker
 * for the real one. The browser's is a courtesy — the Worker never trusts it,
 * because anybody through the gate can post whatever they like.
 *
 * @param {{ name: string, avatar: string }} proposal a name already normalised
 * @param {{ id: string, name: string, avatar: string }[]} others every live player except this one
 * @returns {{ field: 'name' | 'avatar', message: string } | null}
 */
export function profileProblem(proposal, others) {
  const name = String(proposal.name || '');

  if (name.length === 0) {
    return { field: 'name', message: 'Everybody needs a name.' };
  }
  if ([...name].length > NAME_MAX) {
    return { field: 'name', message: `That is a bit long — ${NAME_MAX} letters at most.` };
  }
  if (others.some((player) => player.name.toLowerCase() === name.toLowerCase())) {
    return { field: 'name', message: 'Somebody in the house is already called that.' };
  }

  if (!avatar(proposal.avatar)) {
    return { field: 'avatar', message: 'Pick a face.' };
  }
  if (takenAvatars(others).has(proposal.avatar)) {
    return { field: 'avatar', message: 'Somebody already has that face. Pick another one.' };
  }

  return null;
}
