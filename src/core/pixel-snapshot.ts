import type { Rect } from './geometry';
import { intersectRects } from './geometry';
import type { PixelBuffer } from './pixel-buffer';

/**
 * A copy of part of a pixel buffer, so that a command can put those pixels back exactly.
 *
 * This is how pixel-editing commands undo themselves: on their first apply they snapshot
 * the layer-space rect they are about to change, and only that rect; revert restores the
 * snapshot, and redo recomputes the edit from the restored pixels. Very large or repeated
 * edits may later need tiled or compressed storage, which can live behind this class.
 */
export class PixelSnapshot {
  private constructor(
    /** The copied area in the buffer's own coordinates, or null if nothing was copied. */
    readonly rect: Rect | null,
    private readonly bufferWidth: number,
    private readonly bufferHeight: number,
    private readonly data: Uint8ClampedArray<ArrayBuffer>,
  ) {}

  /** Copies the pixels of `buffer` inside `rect` (buffer coordinates), clipped to the buffer. */
  static capture(buffer: PixelBuffer, rect: Rect): PixelSnapshot {
    const { width, height } = buffer;
    const area = intersectRects(rect, { x: 0, y: 0, width, height });
    if (!area) return new PixelSnapshot(null, width, height, new Uint8ClampedArray(0));
    const data = new Uint8ClampedArray(area.width * area.height * 4);
    const rowBytes = area.width * 4;
    for (let row = 0; row < area.height; row++) {
      const start = ((area.y + row) * width + area.x) * 4;
      data.set(buffer.data.subarray(start, start + rowBytes), row * rowBytes);
    }
    return new PixelSnapshot(area, width, height, data);
  }

  /**
   * Writes the copied pixels back where they came from. `buffer` must be the size of the
   * buffer they were copied from (normally the same buffer); pixels outside the rect are
   * left alone.
   */
  restore(buffer: PixelBuffer): void {
    if (buffer.width !== this.bufferWidth || buffer.height !== this.bufferHeight) {
      throw new RangeError(
        `Snapshot is of a ${this.bufferWidth}x${this.bufferHeight} buffer, not ${buffer.width}x${buffer.height}`,
      );
    }
    const area = this.rect;
    if (!area) return;
    const rowBytes = area.width * 4;
    for (let row = 0; row < area.height; row++) {
      const start = ((area.y + row) * buffer.width + area.x) * 4;
      buffer.data.set(this.data.subarray(row * rowBytes, (row + 1) * rowBytes), start);
    }
  }
}
