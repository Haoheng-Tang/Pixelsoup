import type { ImageDocument } from '../document';
import { MAX_IMAGE_SIZE, documentBounds } from '../document';
import type { Rect } from '../geometry';
import { unionRects } from '../geometry';
import type { RasterLayer } from '../layer';
import type { PixelBuffer } from '../pixel-buffer';

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
