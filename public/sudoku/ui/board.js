// Render and input for one board. Owns no game state: it draws what it is
// handed and reports what the player did. app.js decides what that means.
//
// A CSS grid of elements rather than a canvas, because cells need to be
// individually styled, focused, and later highlighted by the technique library.

/**
 * @param {object} opts
 * @param {HTMLElement} opts.root
 * @param {object} opts.geom
 * @param {(cell: number) => void} opts.onSelect
 * @param {(cell: number, value: number) => void} opts.onSet
 */
export function createBoard({ root, geom, onSelect, onSet }) {
  root.classList.add('board');
  root.style.setProperty('--n', String(geom.n));
  root.tabIndex = 0;
  root.setAttribute('role', 'grid');
  root.setAttribute('aria-label', `${geom.n} by ${geom.n} sudoku`);

  const cells = [];
  for (let cell = 0; cell < geom.cellCount; cell++) {
    const el = document.createElement('div');
    el.className = 'cell';
    el.dataset.cell = String(cell);
    el.setAttribute('role', 'gridcell');
    // Two different things, kept apart. box-* is an internal box boundary and
    // comes from the geometry's boxW/boxH — which is what makes 6x6's 3x2 box
    // fall out of the same code as 9x9's 3x3. edge-* is the outer frame's
    // right and bottom, which have to live on cells because the board element
    // only draws its top and left.
    if (geom.boxEdgeRight[cell]) el.classList.add('box-right');
    if (geom.boxEdgeBottom[cell]) el.classList.add('box-bottom');
    if (geom.colOf[cell] === geom.n - 1) el.classList.add('edge-right');
    if (geom.rowOf[cell] === geom.n - 1) el.classList.add('edge-bottom');
    root.append(el);
    cells.push(el);
  }

  // A copy of the last rendered selection, kept only so key handling knows
  // where it is moving from. app.js remains authoritative.
  let selected = null;

  const clamp = (row, col) => {
    if (row < 0 || row >= geom.n || col < 0 || col >= geom.n) return null;
    return row * geom.n + col;
  };

  const STEPS = {
    ArrowLeft: [0, -1],
    ArrowRight: [0, 1],
    ArrowUp: [-1, 0],
    ArrowDown: [1, 0],
  };

  root.addEventListener('pointerdown', (event) => {
    const target = event.target.closest('.cell');
    if (!target) return;
    root.focus();
    onSelect(Number(target.dataset.cell));
  });

  root.addEventListener('keydown', (event) => {
    // Ctrl+Z and friends belong to app.js.
    if (event.ctrlKey || event.metaKey || event.altKey) return;

    const step = STEPS[event.key];
    if (step) {
      event.preventDefault();
      if (selected === null) {
        onSelect(0);
        return;
      }
      const next = clamp(geom.rowOf[selected] + step[0], geom.colOf[selected] + step[1]);
      if (next !== null) onSelect(next);
      return;
    }

    if (selected === null) return;

    if (event.key === 'Backspace' || event.key === 'Delete' || event.key === '0') {
      event.preventDefault();
      onSet(selected, 0);
      return;
    }

    const digit = Number(event.key);
    if (Number.isInteger(digit) && digit >= 1 && digit <= geom.n) {
      event.preventDefault();
      onSet(selected, digit);
    }
  });

  /**
   * @param {object} state
   * @param {Uint8Array} state.values
   * @param {Uint8Array} state.givens
   * @param {Set<number>} state.marks   cells the check button flagged wrong
   * @param {number|null} state.selected
   */
  function render({ values, givens, marks, selected: nowSelected }) {
    selected = nowSelected;
    for (let cell = 0; cell < geom.cellCount; cell++) {
      const el = cells[cell];
      const value = values[cell];
      el.textContent = value === 0 ? '' : String(value);
      el.classList.toggle('given', givens[cell] !== 0);
      el.classList.toggle('wrong', marks.has(cell));
      el.classList.toggle('selected', cell === nowSelected);
      el.setAttribute('aria-readonly', givens[cell] !== 0 ? 'true' : 'false');
    }
  }

  return { render, focus: () => root.focus() };
}
