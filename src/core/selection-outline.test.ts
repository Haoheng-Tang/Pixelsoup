import { describe, expect, it } from 'vitest';
import { Selection } from './selection';
import {
  downsampleSelection,
  loopLength,
  traceDownsampledOutline,
  traceSelectionOutline,
} from './selection-outline';

/** Builds a selection from rows of '#' (fully selected) and '.' (not selected). */
function fromRows(rows: string[]): Selection {
  const width = rows[0]?.length ?? 0;
  const values = [...rows.join('')].map((c) => (c === '#' ? 255 : 0));
  return Selection.fromMask(width, rows.length, values);
}

describe('traceSelectionOutline', () => {
  it('has no loops for an empty selection', () => {
    expect(traceSelectionOutline(Selection.empty(4, 4))).toEqual({ loops: [], edgeCount: 0 });
  });

  it('traces a 3×3 square as one closed loop of 12 edges', () => {
    const outline = traceSelectionOutline(fromRows(['.....', '.###.', '.###.', '.###.', '.....']));
    expect(outline.edgeCount).toBe(12);
    // Corners only, clockwise on screen from the top-left.
    expect(outline.loops).toEqual([[1, 1, 4, 1, 4, 4, 1, 4]]);
  });

  it('traces a single pixel and a selection touching the canvas edges', () => {
    expect(traceSelectionOutline(fromRows(['...', '..#'])).loops).toEqual([
      [2, 1, 3, 1, 3, 2, 2, 2],
    ]);
    const all = traceSelectionOutline(Selection.selectAll(3, 2));
    expect(all.loops).toEqual([[0, 0, 3, 0, 3, 2, 0, 2]]);
    expect(all.edgeCount).toBe(10);
  });

  it('traces a region with a hole as two loops', () => {
    const outline = traceSelectionOutline(fromRows(['#####', '#...#', '#...#', '#...#', '#####']));
    expect(outline.loops).toEqual([
      [0, 0, 5, 0, 5, 5, 0, 5],
      // The hole runs the other way round, keeping the selection on its right.
      [1, 4, 4, 4, 4, 1, 1, 1],
    ]);
    expect(outline.edgeCount).toBe(20 + 12);
  });

  it('traces non-convex shapes corner by corner', () => {
    const outline = traceSelectionOutline(fromRows(['##.', '###']));
    expect(outline.loops).toEqual([[0, 0, 2, 0, 2, 1, 3, 1, 3, 2, 0, 2]]);
    expect(outline.edgeCount).toBe(10);
  });

  it('keeps pixels that only touch diagonally as separate loops', () => {
    const outline = traceSelectionOutline(fromRows(['#.', '.#']));
    expect(outline.loops).toEqual([
      [0, 0, 1, 0, 1, 1, 0, 1],
      [1, 1, 2, 1, 2, 2, 1, 2],
    ]);
    expect(outline.edgeCount).toBe(8);
  });

  it('follows one loop through a vertex it passes twice', () => {
    // The gap at (1, 1) touches the outside diagonally at vertex (2, 2), so its edges
    // belong to the outer loop.
    const outline = traceSelectionOutline(fromRows(['###', '#.#', '##.']));
    expect(outline.loops).toEqual([[0, 0, 3, 0, 3, 2, 2, 2, 2, 1, 1, 1, 1, 2, 2, 2, 2, 3, 0, 3]]);
    expect(outline.edgeCount).toBe(16);
  });

  it('counts pixels as selected from more than 50% coverage', () => {
    const outline = traceSelectionOutline(Selection.fromMask(3, 1, [127, 128, 255]));
    expect(outline.loops).toEqual([[1, 0, 3, 0, 3, 1, 1, 1]]);
  });
});

describe('loopLength', () => {
  it('adds up the edges, the closing one included', () => {
    expect(loopLength([0, 0, 3, 0, 3, 2, 0, 2])).toBe(10);
    expect(loopLength([0, 0, 2, 0, 2, 1, 3, 1, 3, 2, 0, 2])).toBe(10);
    expect(loopLength([])).toBe(0);
  });
});

/** The coarse mask's selected pixels as rows of '#' and '.'. */
function rowsOf(selection: Selection): string[] {
  const rows: string[] = [];
  for (let y = 0; y < selection.height; y++) {
    let row = '';
    for (let x = 0; x < selection.width; x++) row += selection.coverageAt(x, y) ? '#' : '.';
    rows.push(row);
  }
  return rows;
}

describe('downsampleSelection', () => {
  it('gives the selection itself for a cell of 1', () => {
    const selection = fromRows(['#.', '.#']);
    expect(downsampleSelection(selection, 1)).toBe(selection);
  });

  it('averages each cell and keeps it where more than half is selected', () => {
    // 4 × 4 cells (25 % zoom): 9 of 16 pixels is more than half, 8 isn't.
    const nine = Selection.fromRect(8, 4, { x: 0, y: 0, width: 3, height: 3 });
    const eight = Selection.fromRect(8, 4, { x: 4, y: 0, width: 4, height: 2 });
    expect(rowsOf(downsampleSelection(nine.union(eight), 4))).toEqual(['#.']);
    // Partial coverage counts too, with the same threshold as a single pixel: 128 is more
    // than half of 255, 127 isn't.
    const soft = Selection.fromMask(4, 2, [128, 128, 127, 127, 128, 128, 127, 127]);
    expect(rowsOf(downsampleSelection(soft, 2))).toEqual(['#.']);
  });

  it('drops a 2 × 2 region at 25 % zoom wherever it lies', () => {
    // At most 4 of a cell's 16 pixels: never more than half, so it vanishes at every
    // offset, whether it fits in one cell or straddles two or four.
    for (let dy = 0; dy < 4; dy++) {
      for (let dx = 0; dx < 4; dx++) {
        const region = Selection.fromRect(12, 12, { x: 4 + dx, y: 4 + dy, width: 2, height: 2 });
        expect(downsampleSelection(region, 4).isEmpty).toBe(true);
      }
    }
  });

  it('keeps a 2 × 2 region at 50 % zoom as one pixel only where it fills a cell', () => {
    const at = (x: number, y: number) =>
      rowsOf(downsampleSelection(Selection.fromRect(6, 6, { x, y, width: 2, height: 2 }), 2));
    expect(at(2, 2)).toEqual(['...', '.#.', '...']);
    // Half of two cells, or a quarter of four: never more than half of any.
    expect(at(3, 2)).toEqual(['...', '...', '...']);
    expect(at(3, 3)).toEqual(['...', '...', '...']);
  });

  it('averages cells cut short by the canvas over what is left of them', () => {
    // A 5 × 3 canvas in 2 × 2 cells: the last column is 1 pixel wide, the last row 1 tall.
    const column = Selection.fromRect(5, 3, { x: 4, y: 0, width: 1, height: 3 });
    expect(rowsOf(downsampleSelection(column, 2))).toEqual(['..#', '..#']);
    const corner = Selection.fromRect(5, 3, { x: 4, y: 2, width: 1, height: 1 });
    expect(rowsOf(downsampleSelection(corner, 2))).toEqual(['...', '..#']);
  });

  it('rejects cells that are not positive whole numbers', () => {
    const selection = Selection.selectAll(4, 4);
    expect(() => downsampleSelection(selection, 0)).toThrow(RangeError);
    expect(() => downsampleSelection(selection, 1.5)).toThrow(RangeError);
  });
});

describe('traceDownsampledOutline', () => {
  it('matches traceSelectionOutline for a cell of 1', () => {
    for (const rows of [
      ['#.', '.#'],
      ['###', '#.#', '##.'],
      ['#####', '#...#', '#####'],
    ]) {
      const selection = fromRows(rows);
      expect(traceDownsampledOutline(selection, 1)).toEqual(traceSelectionOutline(selection));
    }
  });

  it('traces the coarse mask in canvas coordinates', () => {
    const square = Selection.fromRect(8, 8, { x: 0, y: 0, width: 4, height: 4 });
    expect(traceDownsampledOutline(square, 2)).toEqual({
      loops: [[0, 0, 4, 0, 4, 4, 0, 4]],
      edgeCount: 16,
    });
  });

  it('stops at the canvas edges where the last cells are cut short', () => {
    expect(traceDownsampledOutline(Selection.selectAll(5, 5), 4)).toEqual({
      loops: [[0, 0, 5, 0, 5, 5, 0, 5]],
      edgeCount: 20,
    });
  });

  it('has no loops when every region is too small to see', () => {
    const dots = fromRows(['#...#...', '........', '..#...#.', '........']);
    expect(traceDownsampledOutline(dots, 4)).toEqual({ loops: [], edgeCount: 0 });
  });
});
