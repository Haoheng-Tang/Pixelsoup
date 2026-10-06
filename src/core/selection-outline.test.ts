import { describe, expect, it } from 'vitest';
import { Selection } from './selection';
import { traceSelectionOutline } from './selection-outline';

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
