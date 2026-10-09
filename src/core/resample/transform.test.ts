import { describe, expect, it } from 'vitest';
import { OrientCanvasCommand } from '../commands/orientation-commands';
import { createDocument } from '../document';
import { createRasterLayer } from '../layer';
import type { Orientation } from '../orientation';
import type { PixelBuffer, Rgba } from '../pixel-buffer';
import { copyPixels, createPixelBuffer, fillRect, getPixel } from '../pixel-buffer';
import type { Affine } from './affine';
import {
  IDENTITY,
  aboutPivot,
  multiply,
  rotation,
  scaling,
  transformedBounds,
  translation,
} from './affine';
import type { Interpolation } from './kernels';
import { transformMask, transformPixels } from './transform';

const BOTH: readonly Interpolation[] = ['nearest', 'bilinear'];
const RED: Rgba = [255, 0, 0, 255];

/**
 * A buffer whose pixel (x, y) is [x, y, n, alpha], n counting from 1 in reading order and
 * alpha falling from 255 by 20 a pixel, so that no two pixels match.
 */
function numbered(width: number, height: number): PixelBuffer {
  const buffer = createPixelBuffer(width, height);
  for (let i = 0; i < width * height; i++) {
    buffer.data.set([i % width, Math.floor(i / width), i + 1, 255 - 20 * i], i * 4);
  }
  return buffer;
}

function filled(width: number, height: number, color: Rgba): PixelBuffer {
  const buffer = createPixelBuffer(width, height);
  fillRect(buffer, { x: 0, y: 0, width, height }, color);
  return buffer;
}

/** The largest difference between corresponding bytes of two equally sized buffers. */
function maxDifference(a: PixelBuffer, b: PixelBuffer): number {
  expect([a.width, a.height]).toEqual([b.width, b.height]);
  let max = 0;
  for (let i = 0; i < a.data.length; i++) max = Math.max(max, Math.abs(a.data[i] - b.data[i]));
  return max;
}

describe('transformPixels', () => {
  it('copies pixels exactly through whole-pixel moves', () => {
    const source = numbered(3, 2);
    for (const interpolation of BOTH) {
      const same = transformPixels(source, IDENTITY, interpolation);
      expect(same).toMatchObject({ x: 0, y: 0 });
      expect(same?.pixels.data).toEqual(source.data);
      const moved = transformPixels(source, translation(-4, 7), interpolation);
      expect(moved).toMatchObject({ x: -4, y: 7 });
      expect(moved?.pixels.data).toEqual(source.data);
    }
  });

  it('spreads a pixel moved by half a pixel over two, keeping its colour', () => {
    const out = transformPixels(filled(1, 1, RED), translation(0.5, 0), 'bilinear');
    expect(out).toMatchObject({ x: 0, y: 0 });
    // Each output pixel is half covered: alpha 127.5 → 128, and still pure red.
    expect(out && [getPixel(out.pixels, 0, 0), getPixel(out.pixels, 1, 0)]).toEqual([
      [255, 0, 0, 128],
      [255, 0, 0, 128],
    ]);
  });

  it('covers the bounds of the transformed corners', () => {
    const turned = transformPixels(numbered(4, 2), rotation(90), 'bilinear');
    expect(turned && { x: turned.x, y: turned.y, ...size(turned.pixels) }).toEqual({
      x: -2,
      y: 0,
      width: 2,
      height: 4,
    });
    const square = filled(10, 10, RED);
    const tilted = transformPixels(square, aboutPivot(rotation(45), 5, 5), 'bilinear');
    expect(tilted && { x: tilted.x, y: tilted.y, ...size(tilted.pixels) }).toEqual({
      x: -3,
      y: -3,
      width: 16,
      height: 16,
    });
  });

  it('anti-aliases rotated edges without darkening them', () => {
    const out = transformPixels(filled(6, 4, RED), aboutPivot(rotation(30), 3, 2), 'bilinear');
    expect(out).not.toBeNull();
    const pixels = out?.pixels ?? createPixelBuffer(0, 0);
    let soft = 0;
    for (let y = 0; y < pixels.height; y++) {
      for (let x = 0; x < pixels.width; x++) {
        const [r, g, b, a] = getPixel(pixels, x, y);
        if (a === 0) {
          expect([r, g, b]).toEqual([0, 0, 0]);
          continue;
        }
        if (a < 255) soft++;
        expect([r, g, b]).toEqual([255, 0, 0]);
      }
    }
    expect(soft).toBeGreaterThan(0);
  });

  it('shrinks uniform areas to the same colour', () => {
    const out = transformPixels(filled(8, 8, [10, 200, 30, 255]), scaling(0.5), 'bilinear');
    // The edges fade into the transparent outside; the middle stays as it was.
    expect(out && getPixel(out.pixels, 1, 1)).toEqual([10, 200, 30, 255]);
    expect(out && getPixel(out.pixels, 0, 0)[3]).toBeLessThan(255);
    expect(out && getPixel(out.pixels, 0, 0).slice(0, 3)).toEqual([10, 200, 30]);
  });

  it('cuts the output to the clip rect', () => {
    const source = numbered(4, 3);
    const whole = transformPixels(source, translation(1, 1), 'nearest');
    const clip = { x: 2, y: 0, width: 10, height: 3 };
    const clipped = transformPixels(source, translation(1, 1), 'nearest', clip);
    expect(clipped).toMatchObject({ x: 2, y: 1 });
    expect(clipped && whole && clipped.pixels.data).toEqual(
      whole && copyPixels(whole.pixels, { x: 1, y: 0, width: 3, height: 2 }).data,
    );
  });

  it('is null for a singular transform or nothing inside the clip', () => {
    const source = numbered(2, 2);
    expect(transformPixels(source, scaling(0, 1), 'bilinear')).toBeNull();
    expect(
      transformPixels(source, IDENTITY, 'bilinear', { x: 5, y: 5, width: 2, height: 2 }),
    ).toBeNull();
  });
});

describe('transformPixels against the lossless orientations', () => {
  const W = 5;
  const H = 4;
  /** Canvas turns as affine maps of a W × H canvas, worked out by hand. */
  const turns: [Orientation | null, Affine][] = [
    [null, rotation(0)],
    // (x, y) → (H − y, x)
    ['rotate-cw', multiply(translation(H, 0), rotation(90))],
    // (x, y) → (y, W − x)
    ['rotate-ccw', multiply(translation(0, W), rotation(-90))],
    // (x, y) → (W − x, H − y)
    ['rotate-180', multiply(translation(W, H), rotation(180))],
  ];

  for (const [orientation, canvasMap] of turns) {
    for (const interpolation of BOTH) {
      it(`matches ${orientation ?? 'no turn'} within 1 level, ${interpolation}`, () => {
        const doc = createDocument(W, H);
        const pixels = numbered(3, 2);
        const layer = createRasterLayer({ id: 'layer-1', name: 'Layer', x: 1, y: -1, pixels });
        doc.layers.push(layer);
        const out = transformPixels(
          pixels,
          multiply(canvasMap, translation(layer.x, layer.y)),
          interpolation,
        );
        if (orientation) new OrientCanvasCommand(orientation).apply(doc);
        expect(out && { x: out.x, y: out.y }).toEqual({ x: layer.x, y: layer.y });
        expect(
          maxDifference(out?.pixels ?? createPixelBuffer(0, 0), layer.pixels),
        ).toBeLessThanOrEqual(1);
      });
    }
  }
});

describe('transformMask', () => {
  it('maps coverage as transformPixels maps alpha', () => {
    // A 3 × 2 mask and an opaque white image with the mask as its alpha.
    const mask = Uint8Array.from([255, 128, 0, 64, 255, 32]);
    const image = createPixelBuffer(3, 2);
    mask.forEach((coverage, i) => image.data.set([255, 255, 255, coverage], i * 4));
    const m = aboutPivot(rotation(20), 1.5, 1);
    for (const interpolation of BOTH) {
      const moved = transformMask(mask, 3, 2, m, interpolation);
      const pixels = transformPixels(image, m, interpolation);
      expect(moved?.area).toEqual(transformedBounds(m, { x: 0, y: 0, width: 3, height: 2 }));
      expect(pixels && { x: pixels.x, y: pixels.y }).toEqual({
        x: moved?.area.x,
        y: moved?.area.y,
      });
      const alphas = Array.from(
        { length: moved?.data.length ?? 0 },
        (_, i) => pixels?.pixels.data[i * 4 + 3],
      );
      expect(Array.from(moved?.data ?? [])).toEqual(alphas);
    }
  });
});

function size(buffer: PixelBuffer) {
  return { width: buffer.width, height: buffer.height };
}
