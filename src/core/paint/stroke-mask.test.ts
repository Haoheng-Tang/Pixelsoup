import { describe, expect, it } from 'vitest';
import type { Rect } from '../geometry';
import { Selection } from '../selection';
import type { Dab } from './dab';
import { StrokeMask } from './stroke-mask';
import { TILE_SIZE } from './tiles';

const dab = (x: number, y: number, size: number, strength = 1): Dab => ({ x, y, size, strength });

function values(mask: StrokeMask, area: Rect): number[][] {
  return Array.from({ length: area.height }, (_, row) =>
    Array.from({ length: area.width }, (_, column) => mask.valueAt(area.x + column, area.y + row)),
  );
}

describe('StrokeMask', () => {
  const canvas = { x: 0, y: 0, width: 200, height: 200 };

  it('stamps a 1 px hard dab on a pixel centre as one pixel', () => {
    const mask = new StrokeMask(10, 10);
    expect(mask.stamp(dab(3.5, 4.5, 1), 1, canvas, null)).toEqual({
      x: 3,
      y: 4,
      width: 1,
      height: 1,
    });
    expect(values(mask, { x: 2, y: 3, width: 3, height: 3 })).toEqual([
      [0, 0, 0],
      [0, 255, 0],
      [0, 0, 0],
    ]);
  });

  it('stamps a dab centred on a pixel corner symmetrically', () => {
    // A soft 7 px dab centred where pixels 9 and 10 meet, in both directions: the mask
    // mirrors about that corner and about the diagonals.
    const mask = new StrokeMask(20, 20);
    mask.stamp(dab(10, 10, 7), 0.3, canvas, null);
    for (let y = 4; y < 16; y++) {
      for (let x = 4; x < 16; x++) {
        const value = mask.valueAt(x, y);
        expect(mask.valueAt(19 - x, y)).toBe(value);
        expect(mask.valueAt(x, 19 - y)).toBe(value);
        expect(mask.valueAt(y, x)).toBe(value);
      }
    }
    expect(mask.valueAt(9, 9)).toBe(255);
    expect(mask.valueAt(13, 9)).toBeGreaterThan(0);
    expect(mask.valueAt(14, 9)).toBe(0);
  });

  it('stamps a dab at a fractional centre symmetrically about it', () => {
    // Centred on pixel 10's centre across, and a quarter of the way into pixel 7 down: the
    // columns mirror about column 10.
    const mask = new StrokeMask(20, 20);
    mask.stamp(dab(10.5, 7.25, 8.6), 0.5, canvas, null);
    for (let y = 0; y < 15; y++) {
      for (let k = 1; k < 7; k++) expect(mask.valueAt(10 - k, y)).toBe(mask.valueAt(10 + k, y));
    }
    expect(mask.valueAt(10, 7)).toBe(255);
    // Row 3's centre (3.5) is 3.75 px from the dab's centre, row 11's (11.5) 4.25 px.
    expect(mask.valueAt(10, 3)).toBe(48);
    expect(mask.valueAt(10, 11)).toBe(8);
  });

  it('keeps the maximum of overlapping dabs instead of adding them up', () => {
    const mask = new StrokeMask(20, 20);
    expect(mask.stamp(dab(10, 10, 6, 0.5), 1, canvas, null)).not.toBeNull();
    expect(mask.valueAt(10, 10)).toBe(128);
    expect(mask.stamp(dab(10, 10, 6, 0.5), 1, canvas, null)).toBeNull();
    expect(mask.stamp(dab(10.5, 10, 6, 0.5), 1, canvas, null)).not.toBeNull();
    expect(mask.valueAt(10, 10)).toBe(128);
    mask.stamp(dab(10, 10, 6, 0.75), 1, canvas, null);
    expect(mask.valueAt(10, 10)).toBe(191);
    mask.stamp(dab(10, 10, 6, 0.25), 1, canvas, null);
    expect(mask.valueAt(10, 10)).toBe(191);
  });

  it('reports only the area it raised', () => {
    const mask = new StrokeMask(20, 20);
    mask.stamp(dab(10, 10, 6), 1, canvas, null);
    // A second dab 2 px to the right raises only pixels nearer its centre than the
    // first's, and not those the first already covered fully.
    const raised = mask.stamp(dab(12, 10, 6), 1, canvas, null);
    expect(raised).toEqual({ x: 11, y: 7, width: 4, height: 6 });
  });

  it('stays inside the clip rect and the selection', () => {
    const mask = new StrokeMask(20, 20);
    const clip = { x: 5, y: 5, width: 5, height: 20 };
    expect(mask.stamp(dab(10, 10, 6), 1, clip, null)).toEqual({ x: 7, y: 7, width: 3, height: 6 });
    expect(mask.valueAt(9, 9)).toBe(255);
    expect(mask.valueAt(10, 9)).toBe(0);

    const selection = Selection.fromRect(20, 20, { x: 0, y: 0, width: 20, height: 10 });
    const masked = new StrokeMask(20, 20);
    expect(masked.stamp(dab(10, 10, 6), 1, canvas, selection)).toEqual({
      x: 7,
      y: 7,
      width: 6,
      height: 3,
    });
    expect(masked.valueAt(9, 9)).toBe(255);
    expect(masked.valueAt(9, 10)).toBe(0);
    expect(masked.stamp(dab(10, 15, 4), 1, canvas, selection)).toBeNull();
  });

  it('stamps across tile edges', () => {
    const mask = new StrokeMask(3 * TILE_SIZE, 2 * TILE_SIZE);
    const edge = TILE_SIZE;
    mask.stamp(dab(edge, edge, 4), 1, { x: 0, y: 0, width: 3 * edge, height: 2 * edge }, null);
    // Hard, radius 2: pixels whose centres lie d > 1.5 px away get (2.5 − d) × 255, so
    // √4.5 → 96.6 and √2.5 → 234.3.
    expect(values(mask, { x: edge - 2, y: edge - 2, width: 4, height: 4 })).toEqual([
      [97, 234, 234, 97],
      [234, 255, 255, 234],
      [234, 255, 255, 234],
      [97, 234, 234, 97],
    ]);
    let tiles = 0;
    mask.forEachTile(() => tiles++);
    expect(tiles).toBe(4);
  });
});
