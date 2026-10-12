import type { ImageDocument } from '../document';
import { MAX_IMAGE_SIZE, documentBounds } from '../document';
import type { Rect } from '../geometry';
import { intersectRects, unionRects } from '../geometry';
import type { RasterLayer } from '../layer';
import { rasterBounds } from '../layer';
import type { PixelBuffer } from '../pixel-buffer';
import { createPixelBuffer } from '../pixel-buffer';

/**
 * Where a raster layer's pixels sit: its buffer and its canvas position. Growing a layer
 * replaces both, and undo puts the old placement back.
 */
export interface Placement {
  readonly pixels: PixelBuffer;
  readonly x: number;
  readonly y: number;
}

export function placementOf(layer: RasterLayer): Placement {
  return { pixels: layer.pixels, x: layer.x, y: layer.y };
}

export function place(layer: RasterLayer, placement: Placement): void {
  layer.pixels = placement.pixels;
  layer.x = placement.x;
  layer.y = placement.y;
}

/**
 * Canvas-space area a layer grows to so that it covers both `a` and `b`: their union, or
 * the canvas should that exceed the maximum image size. Merging layers and committing a
 * floating selection past its source's edges grow layers this way.
 */
export function growthArea(doc: ImageDocument, a: Rect | null, b: Rect | null): Rect {
  const area = unionRects(a, b) ?? documentBounds(doc);
  return area.width > MAX_IMAGE_SIZE || area.height > MAX_IMAGE_SIZE ? documentBounds(doc) : area;
}

/**
 * The layer's pixels in a new, otherwise transparent buffer covering the canvas-space
 * `area` (from `growthArea`); pixels outside `area` are dropped. Painting and filling past
 * a layer's edges grow it this way.
 */
export function grownPlacement(layer: RasterLayer, area: Rect): Placement {
  const pixels = createPixelBuffer(area.width, area.height);
  const overlap = intersectRects(rasterBounds(layer), area);
  if (overlap) {
    const { width, data } = layer.pixels;
    for (let y = overlap.y; y < overlap.y + overlap.height; y++) {
      const from = ((y - layer.y) * width + overlap.x - layer.x) * 4;
      const to = ((y - area.y) * area.width + overlap.x - area.x) * 4;
      pixels.data.set(data.subarray(from, from + overlap.width * 4), to);
    }
  }
  return { pixels, x: area.x, y: area.y };
}
