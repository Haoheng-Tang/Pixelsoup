import { describe, expect, it } from 'vitest';
import type { ImageDocument } from '../document';
import { createDocument } from '../document';
import { rect } from '../geometry';
import type { RasterLayer } from '../layer';
import { createRasterLayer } from '../layer';
import type { Rgba } from '../pixel-buffer';
import { fillRect, getPixel, setPixel } from '../pixel-buffer';
import { CpuCompositor } from './cpu-compositor';

const T: Rgba = [0, 0, 0, 0];
const RED: Rgba = [255, 0, 0, 255];
const BLUE: Rgba = [0, 0, 255, 255];
const WHITE: Rgba = [255, 255, 255, 255];

interface SolidOptions {
  width?: number;
  height?: number;
  x?: number;
  y?: number;
  opacity?: number;
  visible?: boolean;
}

/** A layer filled with one color; defaults to covering the whole 4x4 test canvas. */
function solid(color: Rgba, options: SolidOptions = {}): RasterLayer {
  const width = options.width ?? 4;
  const height = options.height ?? 4;
  const layer = createRasterLayer({
    name: 'solid',
    width,
    height,
    x: options.x ?? 0,
    y: options.y ?? 0,
    opacity: options.opacity ?? 1,
    visible: options.visible ?? true,
  });
  fillRect(layer.pixels, rect(0, 0, width, height), color);
  return layer;
}

function doc(layers: RasterLayer[], width = 4, height = 4): ImageDocument {
  const d = createDocument(width, height);
  d.layers.push(...layers);
  return d;
}

function render(d: ImageDocument): CpuCompositor {
  const compositor = new CpuCompositor(d.width, d.height);
  compositor.composite(d);
  return compositor;
}

function pixelAt(d: ImageDocument, x = 0, y = 0): Rgba {
  return getPixel(render(d).output, x, y);
}

describe('CpuCompositor', () => {
  describe('basics', () => {
    it('produces a fully transparent image for a document without layers', () => {
      const out = render(doc([])).output;
      expect(out.data.every((v) => v === 0)).toBe(true);
    });

    it('copies a single opaque layer exactly', () => {
      expect(pixelAt(doc([solid([12, 34, 56, 255])]), 2, 3)).toEqual([12, 34, 56, 255]);
    });

    it('keeps straight-alpha colour of a translucent pixel over transparency', () => {
      expect(pixelAt(doc([solid([200, 100, 50, 128])]))).toEqual([200, 100, 50, 128]);
    });

    it('stacks layers bottom to top', () => {
      expect(pixelAt(doc([solid(RED), solid(BLUE)]))).toEqual(BLUE);
      expect(pixelAt(doc([solid(BLUE), solid(RED)]))).toEqual(RED);
    });

    it('rejects a document whose size differs from the compositor', () => {
      expect(() => new CpuCompositor(2, 2).composite(doc([]))).toThrow(/4x4/);
    });
  });

  describe('opacity', () => {
    it('scales alpha of an opaque layer over transparency', () => {
      expect(pixelAt(doc([solid(RED, { opacity: 0.5 })]))).toEqual([255, 0, 0, 128]);
      expect(pixelAt(doc([solid(RED, { opacity: 0.25 })]))).toEqual([255, 0, 0, 64]);
    });

    it('mixes a half-opacity layer with an opaque layer beneath', () => {
      // 255 * 0.5 = 127.5 for both channels, rounded half up.
      expect(pixelAt(doc([solid(BLUE), solid(RED, { opacity: 0.5 })]))).toEqual([128, 0, 128, 255]);
    });

    it('multiplies layer opacity with per-pixel alpha', () => {
      expect(pixelAt(doc([solid([10, 20, 30, 200], { opacity: 0.5 })]))).toEqual([10, 20, 30, 100]);
    });

    it('treats opacity 0 as invisible', () => {
      expect(pixelAt(doc([solid(BLUE), solid(RED, { opacity: 0 })]))).toEqual(BLUE);
    });

    it('treats opacity 1 as fully covering', () => {
      expect(pixelAt(doc([solid(BLUE), solid(RED, { opacity: 1 })]))).toEqual(RED);
    });
  });

  describe('visibility', () => {
    it('skips hidden layers', () => {
      expect(pixelAt(doc([solid(BLUE), solid(RED, { visible: false })]))).toEqual(BLUE);
      expect(pixelAt(doc([solid(RED, { visible: false })]))).toEqual(T);
    });
  });

  describe('alpha blending (Normal)', () => {
    it('blends a 50% alpha pixel over opaque white', () => {
      // sa = 128/255; each channel = src*sa + 255*(1 - sa)
      expect(pixelAt(doc([solid(WHITE), solid([0, 255, 0, 128])]))).toEqual([127, 255, 127, 255]);
    });

    it('blends translucent over translucent', () => {
      // sa = da = 128/255 ≈ 0.50196
      // outA = sa + da(1-sa) ≈ 0.75196  -> 191.75 -> 192
      // outR = 255*sa / outA ≈ 170.22 -> 170; outB = 255*da(1-sa) / outA ≈ 84.78 -> 85
      expect(pixelAt(doc([solid([0, 0, 255, 128]), solid([255, 0, 0, 128])]))).toEqual([
        170, 0, 85, 192,
      ]);
    });

    it('leaves the backdrop untouched under fully transparent pixels', () => {
      expect(pixelAt(doc([solid([1, 2, 3, 77]), solid([255, 255, 255, 0])]))).toEqual([
        1, 2, 3, 77,
      ]);
    });

    it('is order-independent for a stack of identical opaque layers', () => {
      expect(pixelAt(doc([solid(RED), solid(RED), solid(RED)]))).toEqual(RED);
    });
  });

  describe('layer offsets', () => {
    it('places a layer at its positive offset', () => {
      const d = doc([solid(RED, { width: 2, height: 2, x: 3, y: 1 })], 6, 4);
      const out = render(d).output;
      expect(getPixel(out, 2, 1)).toEqual(T);
      expect(getPixel(out, 3, 1)).toEqual(RED);
      expect(getPixel(out, 4, 2)).toEqual(RED);
      expect(getPixel(out, 5, 2)).toEqual(T);
      expect(getPixel(out, 3, 3)).toEqual(T);
    });

    it('maps layer pixels correctly for negative offsets and clips at the canvas edge', () => {
      const layer = solid(T, { width: 4, height: 4, x: -2, y: -2 });
      setPixel(layer.pixels, 2, 2, [9, 8, 7, 255]);
      setPixel(layer.pixels, 3, 3, [1, 2, 3, 255]);
      setPixel(layer.pixels, 0, 0, RED); // off-canvas
      const out = render(doc([layer])).output;
      expect(getPixel(out, 0, 0)).toEqual([9, 8, 7, 255]);
      expect(getPixel(out, 1, 1)).toEqual([1, 2, 3, 255]);
      expect(getPixel(out, 2, 2)).toEqual(T);
      for (let y = 0; y < 4; y++) {
        for (let x = 0; x < 4; x++) expect(getPixel(out, x, y)).not.toEqual(RED);
      }
    });

    it('ignores layers that lie completely outside the canvas', () => {
      const d = doc([solid(BLUE), solid(RED, { x: 10, y: 0 }), solid(RED, { x: 0, y: -4 })]);
      expect(render(d).output.data).toEqual(render(doc([solid(BLUE)])).output.data);
    });

    it('blends an offset layer only where it overlaps', () => {
      const d = doc([solid(BLUE), solid(RED, { width: 1, height: 1, x: 1, y: 1, opacity: 0.5 })]);
      const out = render(d).output;
      expect(getPixel(out, 1, 1)).toEqual([128, 0, 128, 255]);
      expect(getPixel(out, 0, 0)).toEqual(BLUE);
      expect(getPixel(out, 2, 2)).toEqual(BLUE);
    });
  });

  describe('dirty rectangles', () => {
    it('only recomposites the requested regions', () => {
      const top = solid(RED);
      const d = doc([solid(BLUE), top]);
      const compositor = render(d);

      top.visible = false; // mutate directly to observe what the compositor re-reads
      const updated = compositor.composite(d, [rect(1, 1, 2, 1)]);

      expect(updated).toEqual([rect(1, 1, 2, 1)]);
      expect(getPixel(compositor.output, 1, 1)).toEqual(BLUE);
      expect(getPixel(compositor.output, 2, 1)).toEqual(BLUE);
      expect(getPixel(compositor.output, 0, 1)).toEqual(RED);
      expect(getPixel(compositor.output, 3, 1)).toEqual(RED);
      expect(getPixel(compositor.output, 1, 0)).toEqual(RED);
      expect(getPixel(compositor.output, 1, 2)).toEqual(RED);
    });

    it('handles several regions and clips them to the canvas', () => {
      const d = doc([solid(RED)]);
      const compositor = new CpuCompositor(4, 4);
      const updated = compositor.composite(d, [
        rect(-2, -2, 3, 3),
        rect(3, 3, 5, 5),
        rect(9, 9, 1, 1),
      ]);
      expect(updated).toEqual([rect(0, 0, 1, 1), rect(3, 3, 1, 1)]);
      expect(getPixel(compositor.output, 0, 0)).toEqual(RED);
      expect(getPixel(compositor.output, 3, 3)).toEqual(RED);
      expect(getPixel(compositor.output, 1, 1)).toEqual(T);
    });

    it('rounds fractional regions outward to whole pixels', () => {
      const compositor = new CpuCompositor(4, 4);
      expect(compositor.composite(doc([solid(RED)]), [rect(0.5, 0.5, 1, 1)])).toEqual([
        rect(0, 0, 2, 2),
      ]);
    });

    it('recomposites the whole canvas when no regions are given', () => {
      const compositor = new CpuCompositor(4, 4);
      expect(compositor.composite(doc([solid(RED)]))).toEqual([rect(0, 0, 4, 4)]);
    });
  });
});
