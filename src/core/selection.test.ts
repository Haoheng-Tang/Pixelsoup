import { describe, expect, it } from 'vitest';
import { combineSelections, Selection } from './selection';

/** Builds a selection from rows of '#' (fully selected) and '.' (not selected). */
function fromRows(rows: string[]): Selection {
  const width = rows[0]?.length ?? 0;
  const values = [...rows.join('')].map((c) => (c === '#' ? 255 : 0));
  return Selection.fromMask(width, rows.length, values);
}

/** Renders a selection as rows of '#' (255), '.' (0) and '+' (partial coverage). */
function rowsOf(selection: Selection): string[] {
  const rows: string[] = [];
  for (let y = 0; y < selection.height; y++) {
    let row = '';
    for (let x = 0; x < selection.width; x++) {
      const v = selection.coverageAt(x, y);
      row += v === 255 ? '#' : v === 0 ? '.' : '+';
    }
    rows.push(row);
  }
  return rows;
}

function totalCoverage(selection: Selection): number {
  let sum = 0;
  for (const v of selection.mask) sum += v;
  return sum / 255;
}

describe('Selection basics', () => {
  it('empty selects nothing', () => {
    const s = Selection.empty(4, 3);
    expect(s.isEmpty).toBe(true);
    expect(s.bounds()).toBeNull();
    expect(s.coverageAt(1, 1)).toBe(0);
  });

  it('selectAll selects every pixel fully', () => {
    const s = Selection.selectAll(4, 3);
    expect(s.isEmpty).toBe(false);
    expect(s.bounds()).toEqual({ x: 0, y: 0, width: 4, height: 3 });
    expect([...s.mask].every((v) => v === 255)).toBe(true);
  });

  it('rejects invalid sizes', () => {
    expect(() => Selection.empty(0, 3)).toThrow(RangeError);
    expect(() => Selection.fromMask(2, 2, [0, 0, 0])).toThrow(RangeError);
  });

  it('coverageAt floors coordinates and is 0 outside the canvas', () => {
    const s = Selection.fromMask(3, 2, [0, 10, 20, 30, 40, 50]);
    expect(s.coverageAt(1.7, 1.2)).toBe(40);
    expect(s.coverageAt(2.99, 0)).toBe(20);
    expect(s.coverageAt(-0.5, 0)).toBe(0);
    expect(s.coverageAt(3, 0)).toBe(0);
    expect(s.coverageAt(0, 2)).toBe(0);
  });

  it('fromMask copies its input and scans the bounds', () => {
    const values = [0, 0, 0, 0, 0, 7, 0, 0, 0, 0, 9, 0];
    const s = Selection.fromMask(4, 3, values);
    values[5] = 0;
    expect(s.coverageAt(1, 1)).toBe(7);
    expect(s.bounds()).toEqual({ x: 1, y: 1, width: 2, height: 2 });
  });

  it('equals compares coverage, not identity', () => {
    const a = fromRows(['.##', '.##']);
    expect(a.equals(Selection.fromRect(3, 2, { x: 1, y: 0, width: 2, height: 2 }))).toBe(true);
    expect(a.equals(fromRows(['.##', '.#.']))).toBe(false);
    expect(a.equals(Selection.empty(3, 2))).toBe(false);
    expect(Selection.empty(3, 2).equals(Selection.empty(3, 2))).toBe(true);
    expect(Selection.empty(3, 2).equals(Selection.empty(2, 3))).toBe(false);
  });
});

describe('Selection.fromRect', () => {
  it('selects the pixels inside the rect', () => {
    const s = Selection.fromRect(5, 4, { x: 1, y: 1, width: 3, height: 2 });
    expect(rowsOf(s)).toEqual(['.....', '.###.', '.###.', '.....']);
    expect(s.bounds()).toEqual({ x: 1, y: 1, width: 3, height: 2 });
  });

  it('clips to the canvas', () => {
    const s = Selection.fromRect(4, 3, { x: -2, y: -1, width: 4, height: 3 });
    expect(rowsOf(s)).toEqual(['##..', '##..', '....']);
    expect(s.bounds()).toEqual({ x: 0, y: 0, width: 2, height: 2 });
  });

  it('rounds edges to whole pixels and accepts negative sizes', () => {
    // x: round(0.4) = 0 to round(2.6) = 3; y: round(1.6) = 2 back to round(0.6) = 1.
    const s = Selection.fromRect(4, 3, { x: 0.4, y: 1.6, width: 2.2, height: -1 });
    expect(rowsOf(s)).toEqual(['....', '###.', '....']);
  });

  it('is empty for a zero-size rect or one entirely off the canvas', () => {
    expect(Selection.fromRect(4, 3, { x: 1, y: 1, width: 0, height: 2 }).isEmpty).toBe(true);
    expect(Selection.fromRect(4, 3, { x: 1, y: 1, width: 0.4, height: 2 }).isEmpty).toBe(true);
    expect(Selection.fromRect(4, 3, { x: 5, y: 0, width: 2, height: 2 }).isEmpty).toBe(true);
  });
});

describe('Selection.fromEllipse', () => {
  // A circle of radius 5 centred on (5, 5), inscribed in the 10×10 canvas.
  const circle = Selection.fromEllipse(10, 10, { x: 0, y: 0, width: 10, height: 10 });

  it('fully selects the inside and leaves the corners out', () => {
    expect(circle.coverageAt(4, 4)).toBe(255);
    expect(circle.coverageAt(5, 5)).toBe(255);
    expect(circle.coverageAt(2, 5)).toBe(255);
    expect(circle.coverageAt(0, 0)).toBe(0);
    expect(circle.coverageAt(9, 9)).toBe(0);
    expect(circle.bounds()).toEqual({ x: 0, y: 0, width: 10, height: 10 });
  });

  it('gives edge pixels their covered fraction', () => {
    // Pixel (0, 4) spans y 4–5 at the circle's left extreme. Its covered area is
    // ∫₀¹ (1 − 5 + √(25 − u²)) du = −4 + [u/2·√(25 − u²) + 12.5·asin(u/5)]₀¹
    // = −4 + 2.4495 + 2.5170 = 0.9665, and 0.9665 × 255 ≈ 246.
    expect(Math.abs(circle.coverageAt(0, 4) - 246)).toBeLessThanOrEqual(1);
    // Pixel (1, 1): the circle passes through its corners (1, 2) and (2, 1), so it
    // covers half the pixel plus the circular segment on that √2 chord:
    // θ = 2·asin(√2 / 10) = 0.28381, segment = 25/2 · (θ − sin θ) = 0.0477;
    // (0.5 + 0.0477) × 255 ≈ 140.
    expect(Math.abs(circle.coverageAt(1, 1) - 140)).toBeLessThanOrEqual(1);
  });

  it('is symmetric and covers the area of the circle', () => {
    for (const [x, y] of [
      [1, 1],
      [0, 4],
      [3, 0],
    ] as const) {
      const v = circle.coverageAt(x, y);
      expect(Math.abs(circle.coverageAt(9 - x, y) - v)).toBeLessThanOrEqual(1);
      expect(Math.abs(circle.coverageAt(x, 9 - y) - v)).toBeLessThanOrEqual(1);
      expect(Math.abs(circle.coverageAt(y, x) - v)).toBeLessThanOrEqual(1);
    }
    expect(totalCoverage(circle)).toBeCloseTo(Math.PI * 25, 1);
  });

  it('handles non-circular ellipses', () => {
    const s = Selection.fromEllipse(8, 4, { x: 0, y: 0, width: 8, height: 4 });
    expect(s.coverageAt(3, 1)).toBe(255);
    // Only the corner of pixel (0, 0) nearest the centre is inside: at y = 1 the edge is at
    // x = 4 − 4·√(1 − ¼) = 0.54, and at y = 0.5 it is already at x = 1.35.
    expect(s.coverageAt(0, 0)).toBeGreaterThan(0);
    expect(s.coverageAt(0, 0)).toBeLessThan(64);
    expect(s.coverageAt(7, 3)).toBe(s.coverageAt(0, 0));
    expect(s.bounds()).toEqual({ x: 0, y: 0, width: 8, height: 4 });
    expect(totalCoverage(s)).toBeCloseTo(Math.PI * 4 * 2, 1);
  });

  it('clips to the canvas', () => {
    // The circle centred on the canvas corner: only its bottom-right quarter is inside.
    const s = Selection.fromEllipse(10, 10, { x: -5, y: -5, width: 10, height: 10 });
    expect(s.coverageAt(0, 0)).toBe(255);
    expect(s.bounds()).toEqual({ x: 0, y: 0, width: 5, height: 5 });
    expect(totalCoverage(s)).toBeCloseTo((Math.PI * 25) / 4, 1);
  });

  it('is empty when degenerate or off the canvas', () => {
    expect(Selection.fromEllipse(10, 10, { x: 2, y: 2, width: 0, height: 5 }).isEmpty).toBe(true);
    expect(Selection.fromEllipse(10, 10, { x: 20, y: 2, width: 5, height: 5 }).isEmpty).toBe(true);
  });
});

describe('Selection set operations', () => {
  const a = fromRows(['##..', '##..', '....']);
  const b = fromRows(['.##.', '.##.', '.##.']);

  it('union takes pixels selected in either', () => {
    const s = a.union(b);
    expect(rowsOf(s)).toEqual(['###.', '###.', '.##.']);
    expect(s.bounds()).toEqual({ x: 0, y: 0, width: 3, height: 3 });
  });

  it('subtract removes the other selection', () => {
    const s = a.subtract(b);
    expect(rowsOf(s)).toEqual(['#...', '#...', '....']);
    expect(s.bounds()).toEqual({ x: 0, y: 0, width: 1, height: 2 });
    expect(b.subtract(a).bounds()).toEqual({ x: 1, y: 0, width: 2, height: 3 });
    expect(a.subtract(a).isEmpty).toBe(true);
  });

  it('intersect keeps pixels selected in both', () => {
    const s = a.intersect(b);
    expect(rowsOf(s)).toEqual(['.#..', '.#..', '....']);
    expect(s.bounds()).toEqual({ x: 1, y: 0, width: 1, height: 2 });
    expect(a.intersect(fromRows(['...#', '....', '....'])).isEmpty).toBe(true);
  });

  it('invert flips every pixel', () => {
    const s = a.invert();
    expect(rowsOf(s)).toEqual(['..##', '..##', '####']);
    expect(s.bounds()).toEqual({ x: 0, y: 0, width: 4, height: 3 });
    expect(s.invert().equals(a)).toBe(true);
    expect(Selection.selectAll(4, 3).invert().isEmpty).toBe(true);
    expect(Selection.empty(4, 3).invert().equals(Selection.selectAll(4, 3))).toBe(true);
  });

  it('treats partial coverage as fuzzy membership', () => {
    const p = Selection.fromMask(5, 1, [0, 100, 200, 255, 50]);
    const q = Selection.fromMask(5, 1, [255, 150, 100, 0, 50]);
    expect([...p.union(q).mask]).toEqual([255, 150, 200, 255, 50]);
    expect([...p.intersect(q).mask]).toEqual([0, 100, 100, 0, 50]);
    // min(p, 255 − q)
    expect([...p.subtract(q).mask]).toEqual([0, 100, 155, 255, 50]);
    // 255 − p, also for the pixel past the last whole group of four
    expect([...p.invert().mask]).toEqual([255, 155, 55, 0, 205]);
  });

  it('leaves its inputs unchanged', () => {
    const before = [...a.mask];
    a.union(b);
    a.subtract(b);
    a.intersect(b);
    a.invert();
    expect([...a.mask]).toEqual(before);
  });

  it('works with empty operands', () => {
    const none = Selection.empty(4, 3);
    expect(a.union(none).equals(a)).toBe(true);
    expect(none.union(a).equals(a)).toBe(true);
    expect(a.subtract(none).equals(a)).toBe(true);
    expect(none.subtract(a).isEmpty).toBe(true);
    expect(a.intersect(none).isEmpty).toBe(true);
  });

  it('rejects selections of different sizes', () => {
    const other = Selection.selectAll(3, 4);
    expect(() => a.union(other)).toThrow(RangeError);
    expect(() => a.subtract(other)).toThrow(RangeError);
    expect(() => a.intersect(other)).toThrow(RangeError);
  });
});

describe('combineSelections', () => {
  const base = fromRows(['##..', '##..']);
  const shape = fromRows(['.##.', '.##.']);

  it('combines a shape with the current selection by mode', () => {
    expect(combineSelections(base, shape, 'replace')).toBe(shape);
    expect(rowsOf(combineSelections(base, shape, 'add') ?? Selection.empty(4, 2))).toEqual([
      '###.',
      '###.',
    ]);
    expect(rowsOf(combineSelections(base, shape, 'subtract') ?? Selection.empty(4, 2))).toEqual([
      '#...',
      '#...',
    ]);
    expect(rowsOf(combineSelections(base, shape, 'intersect') ?? Selection.empty(4, 2))).toEqual([
      '.#..',
      '.#..',
    ]);
  });

  it('handles having no current selection', () => {
    expect(combineSelections(null, shape, 'replace')).toBe(shape);
    expect(combineSelections(null, shape, 'add')).toBe(shape);
    expect(combineSelections(null, shape, 'subtract')).toBeNull();
    expect(combineSelections(null, shape, 'intersect')).toBeNull();
  });

  it('returns null when nothing ends up selected', () => {
    expect(combineSelections(base, Selection.empty(4, 2), 'replace')).toBeNull();
    expect(combineSelections(base, base, 'subtract')).toBeNull();
    expect(combineSelections(base, fromRows(['...#', '...#']), 'intersect')).toBeNull();
  });
});
