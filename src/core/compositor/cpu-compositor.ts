import type { ImageDocument } from '../document';
import { documentBounds } from '../document';
import type { Rect } from '../geometry';
import { intersectRects, roundRectOut } from '../geometry';
import type { RasterLayer } from '../layer';
import { assertNever } from '../layer';
import type { PixelBuffer } from '../pixel-buffer';
import { createPixelBuffer } from '../pixel-buffer';
import type { Compositor } from './compositor';

/**
 * Reference compositor in plain TypeScript. Writes an 8-bit straight-alpha sRGB
 * `output` buffer the size of the canvas.
 *
 * Works one row at a time: each row of a dirty region is accumulated bottom-to-top in
 * a float, premultiplied scratch row, then rounded to 8 bits once. Blending happens on
 * the sRGB-encoded values directly (no linearisation), matching common editors.
 */
export class CpuCompositor implements Compositor {
  readonly output: PixelBuffer;
  /** Premultiplied accumulator for one row: RGB in 0–255 scale, alpha in 0–1. */
  private readonly row: Float32Array;

  constructor(
    readonly width: number,
    readonly height: number,
  ) {
    this.output = createPixelBuffer(width, height);
    this.row = new Float32Array(width * 4);
  }

  composite(doc: ImageDocument, dirty?: readonly Rect[]): Rect[] {
    if (doc.width !== this.width || doc.height !== this.height) {
      throw new Error(
        `Document is ${doc.width}x${doc.height} but compositor is ${this.width}x${this.height}`,
      );
    }
    const canvas = documentBounds(doc);
    const updated: Rect[] = [];
    for (const region of dirty ?? [canvas]) {
      const area = intersectRects(roundRectOut(region), canvas);
      if (!area) continue;
      this.compositeArea(doc, area);
      updated.push(area);
    }
    return updated;
  }

  private compositeArea(doc: ImageDocument, area: Rect): void {
    const acc = this.row;
    const out = this.output.data;
    const span = area.width * 4;
    for (let y = area.y; y < area.y + area.height; y++) {
      acc.fill(0, 0, span);
      for (const layer of doc.layers) {
        if (!layer.visible || layer.opacity <= 0) continue;
        switch (layer.kind) {
          case 'raster':
            this.blendRasterRow(layer, y, area.x, area.width);
            break;
          default:
            assertNever(layer.kind);
        }
      }
      let o = (y * this.width + area.x) * 4;
      for (let i = 0; i < span; i += 4, o += 4) {
        const alpha = acc[i + 3];
        if (alpha <= 0) {
          out[o] = out[o + 1] = out[o + 2] = out[o + 3] = 0;
          continue;
        }
        out[o] = Math.round(acc[i] / alpha);
        out[o + 1] = Math.round(acc[i + 1] / alpha);
        out[o + 2] = Math.round(acc[i + 2] / alpha);
        out[o + 3] = Math.round(alpha * 255);
      }
    }
  }

  /** Blends the part of `layer` on canvas row `y`, columns [x0, x0 + width), into the row. */
  private blendRasterRow(layer: RasterLayer, y: number, x0: number, width: number): void {
    const { pixels } = layer;
    const ly = y - layer.y;
    if (ly < 0 || ly >= pixels.height) return;
    const start = Math.max(x0, layer.x);
    const end = Math.min(x0 + width, layer.x + pixels.width);
    if (start >= end) return;

    const src = pixels.data;
    const alphaScale = layer.opacity / 255;
    const s = (ly * pixels.width + (start - layer.x)) * 4;
    const a = (start - x0) * 4;
    switch (layer.blendMode) {
      case 'normal':
        blendNormal(src, s, this.row, a, end - start, alphaScale);
        break;
      default:
        assertNever(layer.blendMode);
    }
  }
}

/**
 * Porter-Duff "source over" of `count` straight-alpha source pixels onto the
 * premultiplied accumulator, with source alpha scaled by `alphaScale` (opacity / 255).
 */
function blendNormal(
  src: Uint8ClampedArray,
  srcIndex: number,
  acc: Float32Array,
  accIndex: number,
  count: number,
  alphaScale: number,
): void {
  for (let n = 0; n < count; n++, srcIndex += 4, accIndex += 4) {
    const sa = src[srcIndex + 3] * alphaScale;
    if (sa <= 0) continue;
    const keep = 1 - sa;
    acc[accIndex] = src[srcIndex] * sa + acc[accIndex] * keep;
    acc[accIndex + 1] = src[srcIndex + 1] * sa + acc[accIndex + 1] * keep;
    acc[accIndex + 2] = src[srcIndex + 2] * sa + acc[accIndex + 2] * keep;
    acc[accIndex + 3] = sa + acc[accIndex + 3] * keep;
  }
}
