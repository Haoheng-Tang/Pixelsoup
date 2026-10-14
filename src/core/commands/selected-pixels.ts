import { compositeLayers } from '../compositor/composite-layers';
import type { ImageDocument } from '../document';
import { findLayer } from '../document';
import type { Rect } from '../geometry';
import { intersectRects } from '../geometry';
import { assertNever } from '../layer';
import type { PixelSource } from '../paint/flood-region';
import type { PixelBuffer } from '../pixel-buffer';
import { createPixelBuffer } from '../pixel-buffer';
import type { Selection } from '../selection';

/** Pixels with a place on the canvas: a raster layer, or a buffer and its position. */
export interface PlacedPixels {
  readonly pixels: PixelBuffer;
  /** Canvas-space position of the buffer's top-left pixel. */
  readonly x: number;
  readonly y: number;
}

/**
 * Splits the source's pixels under the selection by coverage, as lifting a floating
 * selection, Layer via Copy or Cut and Copy do: with coverage c, a pixel with alpha a puts
 * alpha round(a × c / 255) into `target` (when given), its colour unchanged (in straight
 * alpha, weighting a pixel scales only its alpha). With `cut` the source keeps the rest,
 * which is also round(a × (255 − c) / 255), and a pixel left with no alpha becomes
 * transparent black, as the eraser and Clear leave it.
 *
 * `target` must cover the selection's bounds where they meet the source, and be
 * transparent there. Returns the canvas-space area the split went through (the selection's
 * bounds within the source), or null if they don't meet.
 */
export function splitSelectedPixels(
  source: PlacedPixels,
  selection: Selection,
  target: PlacedPixels | null,
  cut: boolean,
): Rect | null {
  const bounds = selection.bounds();
  const src = source.pixels;
  const area =
    bounds &&
    intersectRects(bounds, { x: source.x, y: source.y, width: src.width, height: src.height });
  if (!area) return null;
  const mask = selection.mask;
  const data = src.data;
  const out = target?.pixels.data;
  const outWidth = target?.pixels.width ?? 0;
  for (let y = area.y; y < area.y + area.height; y++) {
    let m = y * selection.width + area.x;
    let s = ((y - source.y) * src.width + area.x - source.x) * 4;
    let t = target ? ((y - target.y) * outWidth + area.x - target.x) * 4 : 0;
    for (let n = 0; n < area.width; n++, m++, s += 4, t += 4) {
      const c = mask[m];
      const a = data[s + 3];
      if (c === 0 || a === 0) continue;
      // There are no .5 ties (2·a·c is even, 255 odd), so a − taken also equals
      // round(a × (255 − c) / 255): the two parts are both correctly rounded.
      const taken = c === 255 ? a : Math.round((a * c) / 255);
      if (out && taken > 0) {
        out[t] = data[s];
        out[t + 1] = data[s + 1];
        out[t + 2] = data[s + 2];
        out[t + 3] = taken;
      }
      if (!cut) continue;
      if (taken === a) data[s] = data[s + 1] = data[s + 2] = data[s + 3] = 0;
      else data[s + 3] = a - taken;
    }
  }
  return area;
}

/**
 * The selected pixels of `source`, weighted by coverage as `splitSelectedPixels` weights
 * them, in a new buffer covering the selection's bounds: transparent wherever the source
 * doesn't reach. Null if nothing is selected.
 */
export function copySelectedPixels(
  source: PlacedPixels,
  selection: Selection,
): PlacedPixels | null {
  const bounds = selection.bounds();
  if (!bounds) return null;
  const copy = { pixels: createPixelBuffer(bounds.width, bounds.height), x: bounds.x, y: bounds.y };
  splitSelectedPixels(source, selection, copy, false);
  return copy;
}

/**
 * What Copy takes from the document: the selected pixels of one layer, hidden or not, or
 * of the composite of the visible layers (Copy Merged), weighted by coverage and covering
 * the selection's bounds. Null without a selection, or if there's no such layer.
 */
export function copySelection(doc: ImageDocument, source: PixelSource): PlacedPixels | null {
  const selection = doc.selection;
  const bounds = selection?.bounds() ?? null;
  if (!selection || !bounds) return null;
  if (source === 'composite') {
    const composite = { pixels: compositeLayers(doc.layers, bounds), x: bounds.x, y: bounds.y };
    return copySelectedPixels(composite, selection);
  }
  const layer = findLayer(doc, source.layerId);
  if (!layer) return null;
  switch (layer.kind) {
    case 'raster':
      return copySelectedPixels(layer, selection);
    default:
      return assertNever(layer.kind);
  }
}
