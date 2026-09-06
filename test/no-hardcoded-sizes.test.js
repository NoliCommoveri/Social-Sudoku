// Mechanical defence of the size-parameterisation rule (design 4.1), plus the
// two other properties core/ has to hold: it imports nothing outside itself
// (criterion 8), and it never touches the DOM, window or storage.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const CORE_DIR = fileURLToPath(new URL('../public/sudoku/core/', import.meta.url));

// The three side lengths and their cell counts. 2 is deliberately absent: it is
// an honest box dimension at 4x4 and 6x6 and a dozen other things besides, so a
// rule that fires on it is a rule that gets suppressed everywhere. 3 is here,
// because it is a box dimension at 6x6 and 9x9 — exactly what this rule exists
// to catch — and its one legitimate use is exempted below by name.
const BANNED = new Set([3, 4, 6, 9, 16, 36, 81]);

// sizes.js is where dimensions are written down. It is the whole point.
const EXEMPT_FILES = new Set(['sizes.js']);

// Structural counts that genuinely equal a banned number and are not
// dimensions. Each is an exact line of code, matched after comments and string
// contents have been blanked out. This list is not a comment marker any file
// can opt into: adding an entry is a deliberate edit in two files.
const EXEMPT_LINES = [
  { file: 'grid.js', code: 'export const UNIT_KINDS = 3;' },
];

const coreFiles = readdirSync(CORE_DIR)
  .filter((name) => name.endsWith('.js'))
  .sort();

/**
 * Replaces the contents of comments and string literals with spaces, keeping
 * every other character and every newline in place so line and column numbers
 * still mean something. Regex literals are not recognised; a digit inside one
 * would be reported, which errs the safe way.
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

test('core/ contains no hardcoded grid dimensions', () => {
  const offences = [];
  for (const name of coreFiles) {
    if (EXEMPT_FILES.has(name)) continue;
    const code = blankCommentsAndStrings(readFileSync(path.join(CORE_DIR, name), 'utf8'));
    code.split('\n').forEach((line, index) => {
      const trimmed = line.trim();
      const exempt = EXEMPT_LINES.some((entry) => entry.file === name && entry.code === trimmed);
      if (exempt) return;
      for (const match of line.matchAll(NUMBER)) {
        if (BANNED.has(Number(match[0]))) {
          offences.push(`${name}:${index + 1} literal ${match[0]} — ${trimmed}`);
        }
      }
    });
  }
  assert.deepEqual(offences, [], `hardcoded dimensions in core/:\n${offences.join('\n')}`);
});

test('the UNIT_KINDS exemption still matches a real line', () => {
  for (const entry of EXEMPT_LINES) {
    const code = blankCommentsAndStrings(readFileSync(path.join(CORE_DIR, entry.file), 'utf8'));
    const lines = code.split('\n').map((line) => line.trim());
    assert.ok(
      lines.includes(entry.code),
      `exemption "${entry.code}" no longer appears in ${entry.file} — delete it or fix it`,
    );
  }
});

const STATIC_IMPORT = /\bimport\b[^;'"]*?['"]([^'"]+)['"]/g;
const DYNAMIC_IMPORT = /\bimport\s*\(/g;

test('core/ imports nothing outside core/', () => {
  const offences = [];
  for (const name of coreFiles) {
    const code = blankCommentsAndStrings(readFileSync(path.join(CORE_DIR, name), 'utf8'));
    const raw = readFileSync(path.join(CORE_DIR, name), 'utf8');

    // Specifiers live inside string literals, so read them from the raw source
    // but only at offsets the blanked source shows are real code.
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

test('core/ touches no DOM, window or storage', () => {
  const FORBIDDEN = ['document', 'window', 'localStorage', 'sessionStorage', 'navigator', 'fetch'];
  const offences = [];
  for (const name of coreFiles) {
    const code = blankCommentsAndStrings(readFileSync(path.join(CORE_DIR, name), 'utf8'));
    for (const global of FORBIDDEN) {
      const pattern = new RegExp(`(?<![\\w$.])${global}(?![\\w$])`, 'g');
      for (const match of code.matchAll(pattern)) {
        const line = code.slice(0, match.index).split('\n').length;
        offences.push(`${name}:${line} references ${global}`);
      }
    }
  }
  assert.deepEqual(offences, [], `core/ is not pure:\n${offences.join('\n')}`);
});

test('every core file is covered by this scan', () => {
  assert.deepEqual(coreFiles, [
    'candidates.js', 'generator.js', 'grid.js', 'openness.js', 'rng.js', 'sizes.js',
  ]);
});
