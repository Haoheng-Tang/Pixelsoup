import { describe, expect, it } from 'vitest';
import { TILE_SIZE, TileGrid, tileRect } from './tiles';

describe('TileGrid', () => {
  it('splits an area into the parts in each tile, clipped to the grid', () => {
    const grid = new TileGrid<number>(2 * TILE_SIZE + 10, TILE_SIZE + 1);
    expect([grid.columns, grid.rows]).toEqual([3, 2]);
    const parts: unknown[] = [];
    grid.forEachIn({ x: TILE_SIZE - 2, y: -5, width: 200, height: TILE_SIZE + 10 }, (c, r, part) =>
      parts.push([c, r, part]),
    );
    expect(parts).toEqual([
      [0, 0, { x: TILE_SIZE - 2, y: 0, width: 2, height: TILE_SIZE }],
      [1, 0, { x: TILE_SIZE, y: 0, width: TILE_SIZE, height: TILE_SIZE }],
      [2, 0, { x: 2 * TILE_SIZE, y: 0, width: 10, height: TILE_SIZE }],
      [0, 1, { x: TILE_SIZE - 2, y: TILE_SIZE, width: 2, height: 1 }],
      [1, 1, { x: TILE_SIZE, y: TILE_SIZE, width: TILE_SIZE, height: 1 }],
      [2, 1, { x: 2 * TILE_SIZE, y: TILE_SIZE, width: 10, height: 1 }],
    ]);
    const none: unknown[] = [];
    grid.forEachIn({ x: -10, y: 0, width: 10, height: 10 }, () => none.push(1));
    expect(none).toEqual([]);
  });

  it('keeps the tiles it is given', () => {
    const grid = new TileGrid<string>(3 * TILE_SIZE, 3 * TILE_SIZE);
    grid.set(2, 1, 'a');
    grid.set(0, 2, 'b');
    expect(grid.get(2, 1)).toBe('a');
    expect(grid.get(1, 1)).toBeUndefined();
    const seen: unknown[] = [];
    grid.forEachTile((tile, c, r) => seen.push([tile, c, r]));
    expect(seen).toEqual([
      ['a', 2, 1],
      ['b', 0, 2],
    ]);
    expect(tileRect(2, 1)).toEqual({
      x: 2 * TILE_SIZE,
      y: TILE_SIZE,
      width: TILE_SIZE,
      height: TILE_SIZE,
    });
  });
});
