import { createDocument } from '../document';
import type { Rect } from '../geometry';
import type { Layer } from '../layer';
import { assertNever } from '../layer';
import type { PixelBuffer } from '../pixel-buffer';
import { CpuCompositor } from './cpu-compositor';

/**
 * Composites `layers` (bottom first) exactly as the document compositor does, hidden ones
 * contributing nothing, into a new buffer covering the canvas-space `area` (1–8192 px a
 * side). The layers are left untouched and may extend past the area.
 */
export function compositeLayers(layers: readonly Layer[], area: Rect): PixelBuffer {
  const doc = createDocument(area.width, area.height);
  for (const layer of layers) doc.layers.push(translated(layer, -area.x, -area.y));
  const compositor = new CpuCompositor(area.width, area.height);
  compositor.composite(doc);
  return compositor.output;
}

/** A copy of `layer` moved by (dx, dy) that shares its pixels. */
function translated(layer: Layer, dx: number, dy: number): Layer {
  switch (layer.kind) {
    case 'raster':
      return { ...layer, x: layer.x + dx, y: layer.y + dy };
    default:
      return assertNever(layer.kind);
  }
}
