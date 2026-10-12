import { compositeLayers } from '../compositor/composite-layers';
import type { ImageDocument } from '../document';
import { documentBounds, findLayer } from '../document';
import type { Point } from '../geometry';
import { intersectRects } from '../geometry';
import type { LayerId } from '../layer';
import { assertNever, rasterBounds } from '../layer';
import type { PixelBuffer } from '../pixel-buffer';
import { createPixelBuffer } from '../pixel-buffer';
import { Selection } from '../selection';

/** Pixels to sample: the composite of the visible layers, or one layer's own pixels. */
export type PixelSource = 'composite' | { readonly layerId: LayerId };

/** How a flood fill picks its region; see `floodRegion`. */
export interface FloodOptions {
  /** How far (0–255) each channel may be from the start pixel's. */
  readonly tolerance: number;
  /** Only pixels connected to the start, rather than every matching pixel. */
  readonly contiguous: boolean;
  /** Soften the region's edge by a pixel. */
  readonly antiAlias: boolean;
  /** The pixels compared. */
  readonly source: PixelSource;
}

/**
 * The pixels a flood fill from `start` reaches in `pixels`, as a coverage mask the size of
 * the buffer (0–255 per pixel, row-major): 255 in the region, 0 outside.
 *
 * A pixel matches when each of its channels (R, G, B and A, straight alpha) is within
 * `tolerance` (0–255) of the start pixel's; fully transparent pixels count as
 * (0, 0, 0, 0), whatever colour they hold. Contiguous, the region is the matching pixels
 * connected to the start through their edges (diagonal neighbours don't connect);
 * otherwise it's every matching pixel.
 *
 * Anti-aliased, the region's edge is softened by a pixel: each pixel outside the region
 * is covered in proportion to how many of its eight neighbours are in it (255 × n / 8,
 * rounded). The region itself stays fully covered, so filling it leaves no fringe of the
 * old colour.
 *
 * All zero if `start` is outside the buffer.
 */
export function floodRegion(
  pixels: PixelBuffer,
  start: Point,
  tolerance: number,
  contiguous: boolean,
  antiAlias = false,
): Uint8ClampedArray<ArrayBuffer> {
  if (!(tolerance >= 0 && tolerance <= 255)) {
    throw new RangeError(`Tolerance must be from 0 to 255, not ${tolerance}`);
  }
  const { width, height, data } = pixels;
  const mask = new Uint8ClampedArray(width * height);
  const sx = Math.floor(start.x);
  const sy = Math.floor(start.y);
  if (!(sx >= 0 && sy >= 0 && sx < width && sy < height)) return mask;

  const seed = (sy * width + sx) * 4;
  const a = data[seed + 3];
  const r = a === 0 ? 0 : data[seed];
  const g = a === 0 ? 0 : data[seed + 1];
  const b = a === 0 ? 0 : data[seed + 2];
  const transparentMatches = r <= tolerance && g <= tolerance && b <= tolerance && a <= tolerance;
  /** True if the pixel at byte offset `p` matches the start pixel. */
  const matches = (p: number): boolean => {
    const pa = data[p + 3];
    if (pa === 0) return transparentMatches;
    return (
      Math.abs(pa - a) <= tolerance &&
      Math.abs(data[p] - r) <= tolerance &&
      Math.abs(data[p + 1] - g) <= tolerance &&
      Math.abs(data[p + 2] - b) <= tolerance
    );
  };

  // The region is marked 255 in `mask` as it's found; its bounds limit the edge pass.
  let minX = sx;
  let maxX = sx;
  let minY = sy;
  let maxY = sy;
  if (contiguous) {
    // Scanline fill: fill the whole run of matching pixels through a seed, then push a
    // seed for each run of fillable pixels just above and below it.
    let stack = new Int32Array(1024);
    let top = 0;
    stack[top++] = sx;
    stack[top++] = sy;
    while (top > 0) {
      const y = stack[--top];
      const x = stack[--top];
      const row = y * width;
      if (mask[row + x] !== 0) continue;
      let left = x;
      while (left > 0 && mask[row + left - 1] === 0 && matches((row + left - 1) * 4)) left--;
      let right = x;
      while (right < width - 1 && mask[row + right + 1] === 0 && matches((row + right + 1) * 4)) {
        right++;
      }
      mask.fill(255, row + left, row + right + 1);
      if (left < minX) minX = left;
      if (right > maxX) maxX = right;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
      for (let ny = y - 1; ny <= y + 1; ny += 2) {
        if (ny < 0 || ny >= height) continue;
        const nrow = ny * width;
        let inRun = false;
        for (let nx = left; nx <= right; nx++) {
          const fillable = mask[nrow + nx] === 0 && matches((nrow + nx) * 4);
          if (fillable && !inRun) {
            if (top + 2 > stack.length) {
              const grown = new Int32Array(stack.length * 2);
              grown.set(stack);
              stack = grown;
            }
            stack[top++] = nx;
            stack[top++] = ny;
          }
          inRun = fillable;
        }
      }
    }
  } else {
    for (let y = 0; y < height; y++) {
      const row = y * width;
      for (let x = 0; x < width; x++) {
        if (!matches((row + x) * 4)) continue;
        mask[row + x] = 255;
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        maxY = y;
      }
    }
  }
  if (antiAlias) softenEdge(mask, width, height, minX, minY, maxX, maxY);
  return mask;
}

/**
 * Covers each pixel next to the region (255) in proportion to how many of its eight
 * neighbours are in it, within the region's bounds (inclusive) plus a pixel.
 *
 * Works in place: a pixel outside the region only ever reads neighbours that are in the
 * region or partly covered (< 255), because one that gets 255 has all eight neighbours in
 * the region.
 */
function softenEdge(
  mask: Uint8ClampedArray,
  width: number,
  height: number,
  minX: number,
  minY: number,
  maxX: number,
  maxY: number,
): void {
  const x0 = Math.max(0, minX - 1);
  const x1 = Math.min(width - 1, maxX + 1);
  const y0 = Math.max(0, minY - 1);
  const y1 = Math.min(height - 1, maxY + 1);
  for (let y = y0; y <= y1; y++) {
    const up = y > 0;
    const down = y < height - 1;
    for (let x = x0; x <= x1; x++) {
      const i = y * width + x;
      if (mask[i] === 255) continue;
      const left = x > 0;
      const right = x < width - 1;
      let n = 0;
      if (up) {
        const j = i - width;
        if (left && mask[j - 1] === 255) n++;
        if (mask[j] === 255) n++;
        if (right && mask[j + 1] === 255) n++;
      }
      if (left && mask[i - 1] === 255) n++;
      if (right && mask[i + 1] === 255) n++;
      if (down) {
        const j = i + width;
        if (left && mask[j - 1] === 255) n++;
        if (mask[j] === 255) n++;
        if (right && mask[j + 1] === 255) n++;
      }
      // round(255 × n / 8), halves up.
      if (n > 0) mask[i] = (255 * n + 4) >> 3;
    }
  }
}

/**
 * The canvas's pixels as `source` has them, in a canvas-sized buffer: the composite of the
 * visible layers, or one layer's own pixels in place, transparent where it doesn't reach
 * (hidden or not). Null if there's no such layer. A layer that exactly covers the canvas
 * gives its own buffer, so don't write to the result.
 */
export function canvasPixels(doc: ImageDocument, source: PixelSource): PixelBuffer | null {
  const canvas = documentBounds(doc);
  if (source === 'composite') return compositeLayers(doc.layers, canvas);
  const layer = findLayer(doc, source.layerId);
  if (!layer) return null;
  switch (layer.kind) {
    case 'raster': {
      const { pixels } = layer;
      if (
        layer.x === 0 &&
        layer.y === 0 &&
        pixels.width === doc.width &&
        pixels.height === doc.height
      ) {
        return pixels;
      }
      const out = createPixelBuffer(doc.width, doc.height);
      const overlap = intersectRects(canvas, rasterBounds(layer));
      if (!overlap) return out;
      const rowBytes = overlap.width * 4;
      for (let y = overlap.y; y < overlap.y + overlap.height; y++) {
        const from = ((y - layer.y) * pixels.width + overlap.x - layer.x) * 4;
        out.data.set(pixels.data.subarray(from, from + rowBytes), (y * doc.width + overlap.x) * 4);
      }
      return out;
    }
    default:
      return assertNever(layer.kind);
  }
}

/**
 * The region a flood fill from canvas pixel (x, y) covers (see `floodRegion`), as a
 * selection. Null off the canvas, or if the source layer doesn't exist.
 */
export function floodSelection(
  doc: ImageDocument,
  x: number,
  y: number,
  options: FloodOptions,
): Selection | null {
  const px = Math.floor(x);
  const py = Math.floor(y);
  if (!(px >= 0 && py >= 0 && px < doc.width && py < doc.height)) return null;
  const pixels = canvasPixels(doc, options.source);
  if (!pixels) return null;
  const { tolerance, contiguous, antiAlias } = options;
  const mask = floodRegion(pixels, { x: px, y: py }, tolerance, contiguous, antiAlias);
  return Selection.fromMask(doc.width, doc.height, mask);
}
