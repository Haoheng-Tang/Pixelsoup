import type { Rect } from '../geometry';
import { intersectRects } from '../geometry';

/** Side of the square tiles strokes keep their mask and replaced pixels in. */
export const TILE_SIZE = 64;

/**
 * A sparse grid of TILE_SIZE × TILE_SIZE tiles over a width × height area, created as
 * they're needed, so that what a stroke keeps follows the area it touched. Tile (c, r)
 * covers [c × TILE_SIZE, (c + 1) × TILE_SIZE) × [r × TILE_SIZE, (r + 1) × TILE_SIZE).
 */
export class TileGrid<T> {
  readonly columns: number;
  readonly rows: number;
  private readonly tiles: (T | undefined)[];

  constructor(
    readonly width: number,
    readonly height: number,
  ) {
    this.columns = Math.ceil(width / TILE_SIZE);
    this.rows = Math.ceil(height / TILE_SIZE);
    this.tiles = new Array<T | undefined>(this.columns * this.rows).fill(undefined);
  }

  get(column: number, row: number): T | undefined {
    return this.tiles[row * this.columns + column];
  }

  set(column: number, row: number, tile: T): void {
    this.tiles[row * this.columns + column] = tile;
  }

  /**
   * Calls `visit` for each tile position overlapping `area` (clipped to the grid), with
   * the part of the area in that tile.
   */
  forEachIn(area: Rect, visit: (column: number, row: number, part: Rect) => void): void {
    const clipped = intersectRects(area, { x: 0, y: 0, width: this.width, height: this.height });
    if (!clipped) return;
    const right = clipped.x + clipped.width;
    const bottom = clipped.y + clipped.height;
    for (let row = Math.floor(clipped.y / TILE_SIZE); row * TILE_SIZE < bottom; row++) {
      const y0 = Math.max(clipped.y, row * TILE_SIZE);
      const y1 = Math.min(bottom, (row + 1) * TILE_SIZE);
      for (let column = Math.floor(clipped.x / TILE_SIZE); column * TILE_SIZE < right; column++) {
        const x0 = Math.max(clipped.x, column * TILE_SIZE);
        const x1 = Math.min(right, (column + 1) * TILE_SIZE);
        visit(column, row, { x: x0, y: y0, width: x1 - x0, height: y1 - y0 });
      }
    }
  }

  /** Calls `visit` for each tile created so far. */
  forEachTile(visit: (tile: T, column: number, row: number) => void): void {
    for (let i = 0; i < this.tiles.length; i++) {
      const tile = this.tiles[i];
      if (tile !== undefined) visit(tile, i % this.columns, Math.floor(i / this.columns));
    }
  }
}

/** The area tile (column, row) covers. */
export function tileRect(column: number, row: number): Rect {
  return { x: column * TILE_SIZE, y: row * TILE_SIZE, width: TILE_SIZE, height: TILE_SIZE };
}
