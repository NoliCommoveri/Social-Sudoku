// The avatar set. It is data rather than logic, and what is worth asserting
// about data is the things that break something else when they drift.
//
// The one that pays for the file: **every avatar key the seed uses exists in
// the set.** A key that does not is a player with no face, and it shows up as
// a grey question mark on the picker long after the seed was edited.
//
// public/shared/avatars.js is imported directly. It is a pure module with no
// DOM in it, which is what makes that possible -- and keeping it that way is
// itself one of the assertions here.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { AVATARS, avatar, avatarSvg, avatarTint } from '../public/shared/avatars.js';

const SOURCE = readFileSync(
  fileURLToPath(new URL('../public/shared/avatars.js', import.meta.url)),
  'utf8',
);
const SEED = readFileSync(
  fileURLToPath(new URL('../worker/db/sql/seed_players.sql', import.meta.url)),
  'utf8',
);

test('the set is one screenful: 24 to 30 glyphs', () => {
  // docs/identity-and-stats.md §3.1. Fewer and two players are choosing from
  // the same handful; more and it is a scroll rather than a choice.
  assert.ok(AVATARS.length >= 24 && AVATARS.length <= 30, `${AVATARS.length} avatars`);
});

test('keys are unique, lowercase, and safe in a URL or an SQL string', () => {
  const keys = AVATARS.map((a) => a.key);
  assert.equal(new Set(keys).size, keys.length, 'duplicate key');
  for (const key of keys) assert.match(key, /^[a-z][a-z0-9-]{1,15}$/, key);
});

test('every glyph has a label and its own tint', () => {
  const tints = new Set();
  for (const { key, label, tint } of AVATARS) {
    assert.ok(label && label.length > 0, `${key} has no label`);
    assert.match(tint, /^#[0-9a-f]{6}$/, `${key} tint`);
    assert.ok(!tints.has(tint), `${key} reuses a tint`);
    tints.add(tint);
  }
});

test('art is inline SVG shapes and nothing else', () => {
  for (const { key, art } of AVATARS) {
    assert.ok(art.length > 0, `${key} has no art`);
    // No script, no external reference, no raster. The set exists partly so
    // that nothing about an avatar can be fetched from anywhere.
    assert.doesNotMatch(art, /<script|<image|<foreignObject|href=|url\(/i, key);
    // Balanced enough to be parsed: every element opened is closed. Anything
    // subtler than this is a job for a browser, and S8 is where that happens.
    const opens = (art.match(/<[a-zA-Z]/g) || []).length;
    const closes = (art.match(/\/>|<\//g) || []).length;
    assert.equal(opens, closes, `${key} has unbalanced markup`);
  }
});

test('avatarSvg draws a known key at the size asked for', () => {
  const svg = avatarSvg('fox', { size: 64 });
  assert.match(svg, /^<svg /);
  assert.match(svg, /viewBox="0 0 48 48"/);
  assert.match(svg, /width="64"/);
  assert.match(svg, /color:#/);
  assert.match(svg, /aria-hidden="true"/);
  assert.ok(svg.endsWith('</svg>'));
});

test('an unknown key still draws something tappable', () => {
  // A player whose avatar was edited to something the set does not have needs
  // a tile that can be found and pressed, not an empty one.
  const svg = avatarSvg('there-is-no-such-animal');
  assert.match(svg, /^<svg /);
  assert.ok(svg.length > 100);
  assert.equal(avatar('there-is-no-such-animal'), null);
  assert.match(avatarTint('there-is-no-such-animal'), /^#[0-9a-f]{6}$/);
});

test('avatarSvg defaults to filling its box', () => {
  assert.match(avatarSvg('cat'), /width="100%"/);
});

test('every avatar key in seed_players.sql exists in the set', () => {
  const keys = new Set(AVATARS.map((a) => a.key));
  const used = [...SEED.matchAll(/VALUES\s*\([^)]*?,\s*'[^']*',\s*'([^']+)'/gi)].map((m) => m[1]);
  assert.ok(used.length > 0, 'no avatar keys found in the seed -- has its shape changed?');
  for (const key of used) assert.ok(keys.has(key), `seed uses '${key}', which is not in the set`);
});

test('the module stays pure: no DOM, no window, no storage', () => {
  // It is imported by the browser and by this test runner, and the second one
  // has no document in it. The same rule the sudoku core follows.
  const code = SOURCE.replace(/\/\/[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '');
  for (const forbidden of ['document', 'window.', 'localStorage', 'fetch(']) {
    assert.ok(!code.includes(forbidden), `avatars.js references ${forbidden}`);
  }
});
