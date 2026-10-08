import type { Rect } from '../geometry';
import { intersectRects } from '../geometry';
import type { Selection } from '../selection';
import type { Dab } from './dab';
import { DabProfile, dabBounds } from './dab';
import { TILE_SIZE, TileGrid } from './tiles';

/**
 * Coverage (0–255) of one stroke over a width × height canvas, kept in tiles. Each dab
 * raises it to at most the dab's own coverage (the maximum, not a sum), so overlapping
 * dabs within a stroke never paint more than the stroke's opacity, as in Photoshop.
 */
export class StrokeMask {
  private readonly tiles: TileGrid<Uint8Array>;

  constructor(
    readonly width: number,
    readonly height: number,
  ) {
    this.tiles = new TileGrid(width, height);
  }

  /** The tile at (column, row), or undefined if nothing has been stamped in it. */
  tile(column: number, row: number): Uint8Array | undefined {
    return this.tiles.get(column, row);
  }

  valueAt(x: number, y: number): number {
    if (x < 0 || y < 0 || x >= this.width || y >= this.height) return 0;
    const tile = this.tiles.get(Math.floor(x / TILE_SIZE), Math.floor(y / TILE_SIZE));
    return tile ? tile[(y % TILE_SIZE) * TILE_SIZE + (x % TILE_SIZE)] : 0;
  }

  /**
   * Stamps a dab of the given hardness (0–1) inside `clip`, leaving pixels outside the
   * selection (when there is one) alone. Returns the area it raised, or null if it raised
   * nothing.
   */
  stamp(dab: Dab, hardness: number, clip: Rect, selection: Selection | null): Rect | null {
    const area = intersectRects(dabBounds(dab), clip);
    if (!area || dab.size <= 0 || dab.strength <= 0) return null;
    const { x: cx, y: cy } = dab;
    const radius = dab.size / 2;
    const scale = 255 * Math.min(dab.strength, 1);
    const full = Math.round(scale);
    const profile = new DabProfile(radius, hardness);
    // Squared distances within which pixels are wholly covered, and beyond which not at all.
    const solid = radius * hardness - 0.5;
    const solid2 = solid > 0 ? solid * solid : -1;
    const reach2 = (radius + 0.5) * (radius + 0.5);
    const coverage = selection ? selection.mask : null;
    const tiles = this.tiles;
    const width = this.width;
    const right = area.x + area.width;
    let x0 = Infinity;
    let y0 = Infinity;
    let x1 = -Infinity;
    let y1 = -Infinity;
    for (let y = area.y; y < area.y + area.height; y++) {
      const dy = y + 0.5 - cy;
      const dy2 = dy * dy;
      if (dy2 >= reach2) continue;
      // Only the pixels whose centres lie within reach of the dab's centre.
      const half = Math.sqrt(reach2 - dy2);
      const start = Math.max(area.x, Math.floor(cx - half - 0.5));
      const end = Math.min(right, Math.ceil(cx + half - 0.5) + 1);
      const row = Math.floor(y / TILE_SIZE);
      const rowStart = (y - row * TILE_SIZE) * TILE_SIZE;
      let s = y * width + start;
      for (let x = start; x < end;) {
        const column = Math.floor(x / TILE_SIZE);
        const segmentEnd = Math.min(end, (column + 1) * TILE_SIZE);
        let tile = tiles.get(column, row);
        let t = rowStart + x - column * TILE_SIZE;
        for (; x < segmentEnd; x++, t++, s++) {
          if (coverage !== null && coverage[s] === 0) continue;
          const dx = x + 0.5 - cx;
          const d2 = dx * dx + dy2;
          let value = full;
          if (d2 > solid2) {
            if (d2 >= reach2) continue;
            value = Math.round(profile.coverage(Math.sqrt(d2)) * scale);
            if (value === 0) continue;
          }
          if (tile === undefined) {
            tile = new Uint8Array(TILE_SIZE * TILE_SIZE);
            tiles.set(column, row, tile);
          }
          if (value <= tile[t]) continue;
          tile[t] = value;
          if (x < x0) x0 = x;
          if (x > x1) x1 = x;
          if (y < y0) y0 = y;
          if (y > y1) y1 = y;
        }
      }
    }
    return x1 < x0 ? null : { x: x0, y: y0, width: x1 - x0 + 1, height: y1 - y0 + 1 };
  }

  /** Calls `visit` for each tile stamped so far, with its column and row. */
  forEachTile(visit: (tile: Uint8Array, column: number, row: number) => void): void {
    this.tiles.forEachTile(visit);
  }
}
