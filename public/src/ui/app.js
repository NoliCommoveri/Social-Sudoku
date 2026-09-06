// Wiring: owns the game state, deals new puzzles, runs undo/redo, answers the
// check button, and notices completion. Nothing here is timed or recorded —
// there is nothing to record until slice 8.
//
// Size and difficulty are both runtime choices. Size changes the geometry, so
// board and keypad are rebuilt on every switch; difficulty does not, so it only
// deals. Each size and difficulty keeps its own saved game, and switching away
// from a board never destroys it.

import {
  SIZES, SIZE_KEYS, DEFAULT_SIZE_KEY,
  TIER_IDS, TIER_LABELS, DEFAULT_TIER_ID, tierFor,
} from '../core/sizes.js';
import { makeGeometry } from '../core/grid.js';
import { deal } from '../core/generator.js';
import { createBoard } from './board.js';
import { loadGame, saveGame, loadPrefs, savePrefs, debounce } from '../store/local.js';

const SAVE_DELAY_MS = 200;

const els = {
  board: document.getElementById('board'),
  sizes: document.getElementById('sizes'),
  tiers: document.getElementById('tiers'),
  pad: document.getElementById('pad'),
  status: document.getElementById('status'),
  erase: document.getElementById('erase'),
  newGame: document.getElementById('new-game'),
  undo: document.getElementById('undo'),
  redo: document.getElementById('redo'),
  check: document.getElementById('check'),
};

const prefs = loadPrefs();
let sizeKey = SIZE_KEYS.includes(prefs.sizeKey) ? prefs.sizeKey : DEFAULT_SIZE_KEY;
let tierId = TIER_IDS.includes(prefs.tierId) ? prefs.tierId : DEFAULT_TIER_ID;
let geom = makeGeometry(SIZES[sizeKey]);
let board = null;

const state = {
  seed: 0,
  givens: new Uint8Array(geom.cellCount),
  values: new Uint8Array(geom.cellCount),
  solution: new Uint8Array(geom.cellCount),
  moveStack: [],
  redoStack: [],
  marks: new Set(),
  selected: null,
  solved: false,
};

// The size, the difficulty and the board are arguments, not read at write time:
// a save still inside the debounce window when the player switches must land
// under the size and difficulty it was made on.
const persist = debounce(saveGame, SAVE_DELAY_MS);

function save() {
  persist(sizeKey, tierId, {
    seed: state.seed,
    givens: Uint8Array.from(state.givens),
    values: Uint8Array.from(state.values),
    moveStack: state.moveStack.map((move) => ({ ...move })),
  });
}

// A fresh element per board, so the old one's listeners leave with it.
function mountBoard() {
  const fresh = document.createElement('div');
  fresh.id = els.board.id;
  els.board.replaceWith(fresh);
  els.board = fresh;
  board = createBoard({
    root: fresh,
    geom,
    onSelect: (cell) => {
      state.selected = cell;
      render();
    },
    onSet: (cell, value) => setValue(cell, value),
  });
}

function randomSeed() {
  return Math.floor(Math.random() * 0x100000000) >>> 0;
}

function newGame(seed = randomSeed()) {
  const dealt = deal(geom, seed, tierFor(sizeKey, tierId));
  state.seed = seed;
  state.givens = dealt.givens;
  state.solution = dealt.solution;
  state.values = Uint8Array.from(dealt.givens);
  state.moveStack = [];
  state.redoStack = [];
  state.marks.clear();
  state.selected = null;
  state.solved = false;
  save();
  render();
}

// A saved game stores its seed rather than its solution, so restoring means
// re-dealing. If the givens no longer match what that seed produces the save
// predates a generator change — a new clue target in `SIZES` is one — so drop
// it and deal fresh rather than restore a board whose solution we cannot trust.
function restore(saved) {
  const dealt = deal(geom, saved.seed, tierFor(sizeKey, tierId));
  for (let cell = 0; cell < geom.cellCount; cell++) {
    if (dealt.givens[cell] !== saved.givens[cell]) return false;
  }
  state.seed = saved.seed;
  state.givens = dealt.givens;
  state.solution = dealt.solution;
  state.values = saved.values;
  state.moveStack = saved.moveStack;
  state.redoStack = [];
  state.marks.clear();
  state.selected = null;
  state.solved = isComplete();
  render();
  return true;
}

// The board for this size and difficulty: the one saved under them if it still
// deals true, a fresh one otherwise.
function resume() {
  const saved = loadGame(sizeKey, tierId, geom.cellCount);
  if (!saved || !restore(saved)) newGame();
}

function isComplete() {
  for (let cell = 0; cell < geom.cellCount; cell++) {
    if (state.values[cell] !== state.solution[cell]) return false;
  }
  return true;
}

function apply(cell, value) {
  state.values[cell] = value;
  state.marks.clear();
  state.solved = isComplete();
  save();
  render();
}

function setValue(cell, value) {
  if (state.givens[cell] !== 0) return;
  const from = state.values[cell];
  if (from === value) return;
  state.moveStack.push({ cell, from, to: value });
  state.redoStack.length = 0;
  state.selected = cell;
  apply(cell, value);
}

function undo() {
  const move = state.moveStack.pop();
  if (!move) return;
  state.redoStack.push(move);
  state.selected = move.cell;
  apply(move.cell, move.from);
}

function redo() {
  const move = state.redoStack.pop();
  if (!move) return;
  state.moveStack.push(move);
  state.selected = move.cell;
  apply(move.cell, move.to);
}

// Q3: mistakes are marked only when asked for. Immediate feedback would make
// nine taps brute-force any cell. Marks clear on the next edit.
function check() {
  state.marks.clear();
  for (let cell = 0; cell < geom.cellCount; cell++) {
    const value = state.values[cell];
    if (value !== 0 && value !== state.solution[cell]) state.marks.add(cell);
  }
  render();
}

function statusText() {
  if (state.solved) return 'Solved.';
  if (state.marks.size > 0) {
    return state.marks.size === 1 ? '1 cell is wrong.' : `${state.marks.size} cells are wrong.`;
  }
  const empty = state.values.reduce((count, value) => count + (value === 0 ? 1 : 0), 0);
  return `${empty} to go.`;
}

function render() {
  board.render(state);
  els.status.textContent = statusText();
  els.board.classList.toggle('solved', state.solved);
  els.undo.disabled = state.moveStack.length === 0;
  els.redo.disabled = state.redoStack.length === 0;
  for (const button of els.sizes.children) {
    button.setAttribute('aria-pressed', Number(button.dataset.sizeKey) === sizeKey ? 'true' : 'false');
  }
  for (const button of els.tiers.children) {
    button.setAttribute('aria-pressed', button.dataset.tierId === tierId ? 'true' : 'false');
  }
}

// Two rows of buttons built the same way: one of grid dimensions, one of
// difficulties. Size is not difficulty — a 4x4 is small, not easy — so they are
// separate rows and either can be changed without touching the other.
function buildPicker(host, options) {
  for (const { value, text, label, onPick } of options) {
    const button = document.createElement('button');
    button.className = 'pad-key pick';
    button.type = 'button';
    Object.assign(button.dataset, value);
    button.textContent = text;
    button.setAttribute('aria-label', label);
    button.addEventListener('click', () => {
      onPick();
      board.focus();
    });
    host.append(button);
  }
}

function buildPickers() {
  buildPicker(els.sizes, SIZE_KEYS.map((key) => {
    const { n } = SIZES[key];
    return {
      value: { sizeKey: String(key) },
      text: `${n}×${n}`,
      label: `${n} by ${n}`,
      onPick: () => setSize(key),
    };
  }));
  buildPicker(els.tiers, TIER_IDS.map((id) => ({
    value: { tierId: id },
    text: TIER_LABELS[id],
    label: TIER_LABELS[id],
    onPick: () => setTier(id),
  })));
}

// The board being left must be on disk before the one being opened is read.
function setSize(nextKey) {
  if (nextKey === sizeKey) return;
  persist.flush();
  sizeKey = nextKey;
  prefs.sizeKey = sizeKey;
  savePrefs(prefs);
  geom = makeGeometry(SIZES[sizeKey]);
  mountBoard();
  buildPad();
  resume();
}

// Difficulty does not change the geometry, so the board and the keypad stand.
function setTier(nextId) {
  if (nextId === tierId) return;
  persist.flush();
  tierId = nextId;
  prefs.tierId = tierId;
  savePrefs(prefs);
  resume();
}

// A keypad laid out from the geometry rather than from a literal: boxW columns
// of digits, one column of actions beside them, new game across the bottom.
// At 9x9 that is a 3x3 block with erase/undo/redo alongside; at 6x6 and 4x4 the
// same shape falls out with fewer digit columns and fewer keys — 4 digits at
// 4x4, not 9 with 5 of them dead.
function buildPad() {
  for (const stale of els.pad.querySelectorAll('.digit')) stale.remove();

  const digitCols = geom.boxW;
  const sideColumn = digitCols + 1;
  els.pad.style.setProperty('--pad-cols', String(sideColumn));

  const keys = document.createDocumentFragment();
  for (let value = 1; value <= geom.n; value++) {
    const button = document.createElement('button');
    button.className = 'pad-key digit';
    button.type = 'button';
    button.textContent = String(value);
    button.style.gridColumn = String(((value - 1) % digitCols) + 1);
    button.style.gridRow = String(Math.floor((value - 1) / digitCols) + 1);
    button.addEventListener('click', () => {
      if (state.selected !== null) setValue(state.selected, value);
      board.focus();
    });
    keys.append(button);
  }
  // Ahead of the action keys, so the markup order is the tab order.
  els.pad.prepend(keys);

  const beside = [els.erase, els.undo, els.redo];
  beside.forEach((el, index) => {
    el.style.gridColumn = String(sideColumn);
    el.style.gridRow = String(index + 1);
  });

  const digitRows = Math.ceil(geom.n / digitCols);
  const belowBoth = Math.max(digitRows, beside.length) + 1;
  els.check.style.gridColumn = '1 / -1';
  els.check.style.gridRow = String(belowBoth);
  els.newGame.style.gridColumn = '1 / -1';
  els.newGame.style.gridRow = String(belowBoth + 1);
}

// The on-screen undo/redo buttons are not optional — the phone has no Ctrl.
document.addEventListener('keydown', (event) => {
  if (!(event.ctrlKey || event.metaKey)) return;
  if (event.key.toLowerCase() !== 'z') return;
  event.preventDefault();
  if (event.shiftKey) redo();
  else undo();
});

// Every control hands focus back to the board. Without this a Chromebook
// player who presses Check has to Tab their way back before the keyboard
// drives the grid again.
function control(el, action) {
  el.addEventListener('click', () => {
    action();
    board.focus();
  });
}

control(els.erase, () => {
  if (state.selected !== null) setValue(state.selected, 0);
});
control(els.newGame, () => newGame());
control(els.undo, undo);
control(els.redo, redo);
control(els.check, check);

buildPickers();
mountBoard();
buildPad();
resume();
board.focus();
