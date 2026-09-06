// Mechanical defence of the rules Pit's tree has to hold and a reviewer would
// have to notice: the numbers the game is sized by live in one module, the core
// is pure, a bot cannot reach the rules module, and neither can a client. Every
// one of them is the kind of rule that is true when it is written and quietly
// false a session later, so none of them is left to review.
//
// The source scanner below is a copy of the one in no-hardcoded-sizes.test.js
// rather than a promotion of it into a shared helper. Promoting means editing
// sudoku's test for the benefit of a game that did not exist when it was
// written, which is the thing H2 in ROADMAP.md exists to prevent. Revisit at
// game three.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const PIT_DIR = fileURLToPath(new URL('../public/pit/', import.meta.url));
const CORE_DIR = path.join(PIT_DIR, 'core');

// HAND, MAX_OFFER, and every point value the ladder can reach. 5 is deliberately
// absent for the same reason 2 is absent from sudoku's list: it is VALUE_STEP
// and it is also a dozen honest things besides, and a rule that fires on it is a
// rule that gets suppressed everywhere.
const BANNED = new Set([4, 9, 55, 60, 65, 70, 75, 80, 85, 90, 95]);

// The module the numbers belong to. It is the whole point.
const EXEMPT_FILES = new Set(['core/commodities.js']);

// Structural counts that genuinely equal a banned number and are not a hand
// size, an offer size or a value. Each is an exact line of code, matched after
// comments and string contents have been blanked out. Adding an entry is a
// deliberate edit in two files.
/** @type {{ file: string, code: string }[]} */
const EXEMPT_LINES = [];

/** Every .js file under public/pit/, relative to it, sorted. */
function sources(dir = PIT_DIR, prefix = '') {
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) out.push(...sources(path.join(dir, entry.name), rel));
    else if (entry.name.endsWith('.js')) out.push(rel);
  }
  return out;
}

/**
 * Replaces the contents of comments and string literals with spaces, keeping
 * every other character and every newline in place so line and column numbers
 * still mean something.
 */
function blankCommentsAndStrings(source) {
  const out = source.split('');
  let mode = 'code';
  let quote = '';
  for (let i = 0; i < source.length; i++) {
    const ch = source[i];
    const next = source[i + 1];
    if (mode === 'code') {
      if (ch === '/' && next === '/') { mode = 'line'; out[i] = ' '; out[i + 1] = ' '; i++; }
      else if (ch === '/' && next === '*') { mode = 'block'; out[i] = ' '; out[i + 1] = ' '; i++; }
      else if (ch === '"' || ch === "'" || ch === '`') { mode = 'string'; quote = ch; }
    } else if (mode === 'line') {
      if (ch === '\n') mode = 'code';
      else out[i] = ' ';
    } else if (mode === 'block') {
      if (ch === '*' && next === '/') { mode = 'code'; out[i] = ' '; out[i + 1] = ' '; i++; }
      else if (ch !== '\n') out[i] = ' ';
    } else if (mode === 'string') {
      if (ch === '\\') { out[i] = ' '; out[i + 1] = ' '; i++; }
      else if (ch === quote) mode = 'code';
      else if (ch !== '\n') out[i] = ' ';
    }
  }
  return out.join('');
}

const NUMBER = /(?<![\w$.])\d+(?![\w$.])/g;
const read = (rel) => readFileSync(path.join(PIT_DIR, rel), 'utf8');

test('the hand size, the offer size and the point values live in one module', () => {
  const offences = [];
  for (const rel of sources()) {
    if (EXEMPT_FILES.has(rel)) continue;
    const code = blankCommentsAndStrings(read(rel));
    code.split('\n').forEach((line, index) => {
      const trimmed = line.trim();
      if (EXEMPT_LINES.some((entry) => entry.file === rel && entry.code === trimmed)) return;
      for (const match of line.matchAll(NUMBER)) {
        if (BANNED.has(Number(match[0]))) offences.push(`${rel}:${index + 1} literal ${match[0]} — ${trimmed}`);
      }
    });
  }
  assert.deepEqual(offences, [], `Pit's sizes written down twice:\n${offences.join('\n')}`);
});

test('every exemption still matches a real line', () => {
  for (const entry of EXEMPT_LINES) {
    const lines = blankCommentsAndStrings(read(entry.file)).split('\n').map((line) => line.trim());
    assert.ok(lines.includes(entry.code), `exemption "${entry.code}" no longer appears in ${entry.file}`);
  }
});

const STATIC_IMPORT = /\bimport\b[^;'"]*?['"]([^'"]+)['"]/g;
const DYNAMIC_IMPORT = /\bimport\s*\(/g;
const coreFiles = readdirSync(CORE_DIR).filter((name) => name.endsWith('.js')).sort();

test('core/ imports nothing outside core/', () => {
  const offences = [];
  for (const name of coreFiles) {
    const raw = readFileSync(path.join(CORE_DIR, name), 'utf8');
    const code = blankCommentsAndStrings(raw);
    for (const match of raw.matchAll(STATIC_IMPORT)) {
      if (code.slice(match.index, match.index + 'import'.length) !== 'import') continue;
      const specifier = match[1];
      const local = specifier.startsWith('./') && !specifier.slice(2).includes('/');
      if (!local) offences.push(`${name} imports "${specifier}"`);
    }
    for (const match of code.matchAll(DYNAMIC_IMPORT)) {
      offences.push(`${name} uses dynamic import() at offset ${match.index}`);
    }
  }
  assert.deepEqual(offences, [], `core/ reached outside itself:\n${offences.join('\n')}`);
});

// `now` arrives as an argument and randomness comes from the seed. That is what
// lets node --test cover the same code the browser runs, and what makes a round
// replayable in a Durable Object that was asleep between two actions.
test('core/ touches no DOM, no storage, no clock and no unseeded randomness', () => {
  const FORBIDDEN = [
    'document', 'window', 'localStorage', 'sessionStorage',
    'navigator', 'fetch', 'Date', 'setTimeout', 'setInterval', 'performance',
  ];
  const offences = [];
  for (const name of coreFiles) {
    const code = blankCommentsAndStrings(readFileSync(path.join(CORE_DIR, name), 'utf8'));
    for (const global of FORBIDDEN) {
      const pattern = new RegExp(`(?<![\\w$.])${global}(?![\\w$])`, 'g');
      for (const match of code.matchAll(pattern)) {
        offences.push(`${name}:${code.slice(0, match.index).split('\n').length} references ${global}`);
      }
    }
    for (const match of code.matchAll(/Math\s*\.\s*random/g)) {
      offences.push(`${name}:${code.slice(0, match.index).split('\n').length} calls Math.random`);
    }
  }
  assert.deepEqual(offences, [], `core/ is not pure:\n${offences.join('\n')}`);
});

test('every core file is covered by this scan', () => {
  assert.deepEqual(coreFiles, ['bot.js', 'commodities.js', 'rng.js', 'rules.js']);
});

/** Every import specifier in a file, comments and strings already discounted. */
function importsOf(rel) {
  const raw = read(rel);
  const code = blankCommentsAndStrings(raw);
  const out = [];
  for (const match of raw.matchAll(STATIC_IMPORT)) {
    if (code.slice(match.index, match.index + 'import'.length) !== 'import') continue;
    out.push(match[1]);
  }
  return out;
}

// A bot reaches a view and nothing else. `botAction` takes a View, and this is
// what makes "it cannot be handed a State" mechanical: there is no import in
// the file that could produce one.
test('core/bot.js cannot reach the rules module', () => {
  assert.deepEqual(importsOf('core/bot.js'), ['./commodities.js']);
});

// The client renders a view and sends actions. Session 3's files do not exist
// yet; the rule is written now so that it is enforced the moment they do.
test('nothing outside core/ and room/ imports the rules module', () => {
  const offences = [];
  for (const rel of sources()) {
    const area = rel.includes('/') ? rel.slice(0, rel.indexOf('/')) : '';
    if (area === 'core' || area === 'room') continue;
    for (const specifier of importsOf(rel)) {
      if (/(^|\/)core\/rules\.js$/.test(specifier)) offences.push(`${rel} imports "${specifier}"`);
    }
  }
  assert.deepEqual(offences, [], `the rules module reached from a client file:\n${offences.join('\n')}`);
});
