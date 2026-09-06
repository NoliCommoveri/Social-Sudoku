import test from 'node:test';
import assert from 'node:assert/strict';

import { SIZES } from '../public/sudoku/core/sizes.js';
import { makeGeometry, UNIT_KINDS } from '../public/sudoku/core/grid.js';

const allSizes = Object.values(SIZES);

test('every cell belongs to exactly UNIT_KINDS units', () => {
  for (const size of allSizes) {
    const geom = makeGeometry(size);
    for (let cell = 0; cell < geom.cellCount; cell++) {
      assert.equal(geom.unitsOf[cell].length, UNIT_KINDS, `size ${size.n}, cell ${cell}`);
      const containing = geom.units.filter((unit) => unit.includes(cell));
      assert.equal(containing.length, UNIT_KINDS, `size ${size.n}, cell ${cell}`);
    }
  }
});

test('every unit holds n distinct cells', () => {
  for (const size of allSizes) {
    const geom = makeGeometry(size);
    assert.equal(geom.units.length, UNIT_KINDS * geom.n);
    for (const unit of geom.units) {
      assert.equal(unit.length, geom.n);
      assert.equal(new Set(unit).size, geom.n);
    }
  }
});

test('peer count matches 2(n-1) + (boxW*boxH - 1) - (boxW-1) - (boxH-1)', () => {
  for (const size of allSizes) {
    const geom = makeGeometry(size);
    const { n, boxW, boxH } = geom;
    const expected = 2 * (n - 1) + (boxW * boxH - 1) - (boxW - 1) - (boxH - 1);
    for (let cell = 0; cell < geom.cellCount; cell++) {
      assert.equal(geom.peersOf[cell].length, expected, `size ${n}, cell ${cell}`);
    }
  }
});

test('the known peer counts are 7, 12 and 20', () => {
  assert.equal(makeGeometry(SIZES[4]).peersOf[0].length, 7);
  assert.equal(makeGeometry(SIZES[6]).peersOf[0].length, 12);
  assert.equal(makeGeometry(SIZES[9]).peersOf[0].length, 20);
});

test('peering is symmetric and no cell is its own peer', () => {
  for (const size of allSizes) {
    const geom = makeGeometry(size);
    for (let cell = 0; cell < geom.cellCount; cell++) {
      assert.ok(!geom.peersOf[cell].includes(cell), `cell ${cell} peers itself`);
      for (const peer of geom.peersOf[cell]) {
        assert.ok(geom.peersOf[peer].includes(cell), `${cell} -> ${peer} not symmetric`);
      }
    }
  }
});

test('boxes tile the grid: each box is a boxW x boxH rectangle', () => {
  for (const size of allSizes) {
    const geom = makeGeometry(size);
    for (let box = 0; box < geom.n; box++) {
      const members = geom.units[geom.n + geom.n + box];
      const rows = new Set([...members].map((cell) => geom.rowOf[cell]));
      const cols = new Set([...members].map((cell) => geom.colOf[cell]));
      assert.equal(rows.size, geom.boxH);
      assert.equal(cols.size, geom.boxW);
    }
  }
});

// The heavy rules a board draws: a cell carries one when the next column or
// row starts a new box. The outer frame is not a box edge — the board element
// draws its top and left, and board.js puts the other two on the last column
// and row — so these flags stop short of it.
test('box edges fall where a box ends, never at the grid edge', () => {
  for (const size of allSizes) {
    const geom = makeGeometry(size);
    for (let cell = 0; cell < geom.cellCount; cell++) {
      const col = geom.colOf[cell];
      const row = geom.rowOf[cell];
      const right = (col + 1) % geom.boxW === 0 && col !== geom.n - 1;
      const bottom = (row + 1) % geom.boxH === 0 && row !== geom.n - 1;
      assert.equal(Boolean(geom.boxEdgeRight[cell]), right, `size ${geom.n}, cell ${cell} right`);
      assert.equal(Boolean(geom.boxEdgeBottom[cell]), bottom, `size ${geom.n}, cell ${cell} bottom`);
    }
  }
});

// Written out by index rather than derived, because the off-by-one this catches
// is one a derived expectation would repeat. 6x6 is the size that has it: boxes
// 3 wide and 2 tall, so one internal column rule and two internal row rules,
// which is neither the same column count nor the same row count.
test('6x6 box edges are exactly these cells', () => {
  const geom = makeGeometry(SIZES[6]);
  const withRight = [];
  const withBottom = [];
  for (let cell = 0; cell < geom.cellCount; cell++) {
    if (geom.boxEdgeRight[cell]) withRight.push(cell);
    if (geom.boxEdgeBottom[cell]) withBottom.push(cell);
  }
  assert.deepEqual(withRight, [2, 8, 14, 20, 26, 32]);
  assert.deepEqual(withBottom, [6, 7, 8, 9, 10, 11, 18, 19, 20, 21, 22, 23]);
});

test('4x4 and 9x9 box edges are exactly these columns and rows', () => {
  const columnsAndRows = (sizeKey) => {
    const geom = makeGeometry(SIZES[sizeKey]);
    const cols = new Set();
    const rows = new Set();
    for (let cell = 0; cell < geom.cellCount; cell++) {
      if (geom.boxEdgeRight[cell]) cols.add(geom.colOf[cell]);
      if (geom.boxEdgeBottom[cell]) rows.add(geom.rowOf[cell]);
    }
    return [[...cols].sort(), [...rows].sort()];
  };
  assert.deepEqual(columnsAndRows(4), [[1], [1]]);
  assert.deepEqual(columnsAndRows(9), [[2, 5], [2, 5]]);
});

test('makeGeometry memoizes per size', () => {
  for (const size of allSizes) {
    assert.equal(makeGeometry(size), makeGeometry({ ...size }));
  }
  assert.notEqual(makeGeometry(SIZES[4]), makeGeometry(SIZES[9]));
});

test('a box that does not tile the grid is rejected', () => {
  assert.throws(() => makeGeometry({ n: 9, boxW: 2, boxH: 2 }), /does not tile/);
});
