import { compositeLayers } from '../compositor/composite-layers';
import type { ImageDocument } from '../document';
import { findLayer } from '../document';
import type { LayerId } from '../layer';
import { assertNever } from '../layer';
import type { Rgb } from '../pixel-buffer';
import { getPixel } from '../pixel-buffer';

/**
 * The colour at document pixel (x, y): of the composite of the visible layers, or of one
 * layer's own pixels (`{ layerId }`). Null off the canvas, where there's no such layer, or
 * where the pixel is fully transparent. A partly transparent pixel gives its colour
 * (straight alpha), without its transparency.
 */
export function sampleColor(
  doc: ImageDocument,
  x: number,
  y: number,
  source: 'composite' | { readonly layerId: LayerId },
): Rgb | null {
  if (!Number.isInteger(x) || !Number.isInteger(y)) return null;
  if (x < 0 || y < 0 || x >= doc.width || y >= doc.height) return null;
  let pixel;
  if (source === 'composite') {
    pixel = getPixel(compositeLayers(doc.layers, { x, y, width: 1, height: 1 }), 0, 0);
  } else {
    const layer = findLayer(doc, source.layerId);
    if (!layer) return null;
    switch (layer.kind) {
      case 'raster':
        pixel = getPixel(layer.pixels, x - layer.x, y - layer.y);
        break;
      default:
        return assertNever(layer.kind);
    }
  }
  const [r, g, b, a] = pixel;
  return a === 0 ? null : [r, g, b];
}
