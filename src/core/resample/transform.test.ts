import { describe, expect, it } from 'vitest';
import { OrientCanvasCommand } from '../commands/orientation-commands';
import { createDocument } from '../document';
import type { Rect } from '../geometry';
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
import type { Projective, Quad } from './projective';
import {
  fromAffine,
  homographyFromQuad,
  invertProjective,
  mappedBounds,
  projectPoint,
} from './projective';
import type { TransformedPixels } from './transform';
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

  it('maps coverage as transformPixels maps alpha through a perspective', () => {
    const mask = Uint8Array.from({ length: 48 }, (_, i) => (i * 53) % 256);
    const image = createPixelBuffer(8, 6);
    mask.forEach((coverage, i) => image.data.set([255, 255, 255, coverage], i * 4));
    const area = { x: 0, y: 0, width: 8, height: 6 };
    const m = homography(area, [
      { x: 2, y: 1 },
      { x: 9, y: -1 },
      { x: 11, y: 8 },
      { x: 0, y: 6 },
    ]);
    for (const interpolation of BOTH) {
      const moved = transformMask(mask, 8, 6, m, interpolation);
      const pixels = transformPixels(image, m, interpolation);
      expect(moved?.area).toEqual(mappedBounds(m, area));
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

describe('transformPixels through a projective matrix', () => {
  // A 40 × 40 square to a trapezoid narrower at the top: a perspective, not affine.
  const SQUARE: Rect = { x: 0, y: 0, width: 40, height: 40 };
  const TRAPEZOID: Quad = [
    { x: 10, y: 0 },
    { x: 50, y: 0 },
    { x: 60, y: 40 },
    { x: 0, y: 40 },
  ];

  it('gives exactly the affine path’s bytes for a matrix that is affine', () => {
    const source = pattern(7, 5);
    const m = multiply(aboutPivot(rotation(30), 3.5, 2.5), scaling(1.7, 0.6));
    for (const interpolation of BOTH) {
      const affine = transformPixels(source, m, interpolation);
      expect(affine).not.toBeNull();
      expect(transformPixels(source, fromAffine(m), interpolation)).toEqual(affine);
    }
  });

  it('keeps straight lines straight', () => {
    // Red counts the source's columns and green its rows, so red = green along its
    // diagonal, which must land on the straight line from (10, 0) to (60, 40). Mapping the
    // corners bilinearly instead would bow it by up to 5 px.
    const source = createPixelBuffer(40, 40);
    for (let y = 0; y < 40; y++) {
      for (let x = 0; x < 40; x++) source.data.set([6 * x, 6 * y, 0, 255], (y * 40 + x) * 4);
    }
    const out = transformed(source, homography(SQUARE, TRAPEZOID), 'bilinear');
    expect({ x: out.x, y: out.y, ...size(out.pixels) }).toEqual({
      x: 0,
      y: 0,
      width: 60,
      height: 40,
    });
    const off: string[] = [];
    // Rows close enough to the corners blend the diagonal with the outside.
    for (let y = 3; y < 37; y++) {
      const run = opaqueRun(out.pixels, y);
      const found = crossings(
        run.pixels.map(([r, g]) => r - g),
        0,
      ).map((x) => run.start + x);
      const expected = 10 + (50 / 40) * (y + 0.5);
      if (found.length !== 1 || Math.abs(found[0] - expected) > 0.3) {
        off.push(`${y}: ${found.join(' ')}`);
      }
    }
    expect(off).toEqual([]);
  });

  it('foreshortens: columns converge and further rows shrink', () => {
    // An 8 × 4 board of 8 px squares to a trapezoid half as wide at the top, whose sides
    // meet at (32, −32). Worked out from the corners, the source's row v lands at
    // y = 0.5v / (1 − v / 64), and each row is scaled across by (y + 32) / 64 about x = 32.
    const board = createPixelBuffer(64, 32);
    for (let y = 0; y < 32; y++) {
      for (let x = 0; x < 64; x++) {
        const value = ((x >> 3) + (y >> 3)) % 2 ? 0 : 255;
        board.data.set([value, value, value, 255], (y * 64 + x) * 4);
      }
    }
    const quad: Quad = [
      { x: 16, y: 0 },
      { x: 48, y: 0 },
      { x: 64, y: 32 },
      { x: 0, y: 32 },
    ];
    const out = transformed(
      board,
      homography({ x: 0, y: 0, width: 64, height: 32 }, quad),
      'bilinear',
    );
    // Down column 28, which stays in the board's fourth column: the squares' edges at
    // source rows 8, 16 and 24 land at 4.57, 10.67 and 19.2, so the rows of squares are
    // 4.57, 6.10, 8.53 and 12.8 px tall, growing towards the near (wide) side.
    const column = Array.from({ length: 32 }, (_, y) => getPixel(out.pixels, 28, y)[0]);
    const rows = crossings(column, 127.5);
    expect(rows).toHaveLength(3);
    [8, 16, 24].forEach((v, i) => {
      expect(Math.abs(rows[i] - (0.5 * v) / (1 - v / 64))).toBeLessThan(0.25);
    });
    // Along rows near the far and near sides, the columns' edges (source x = 8, 16, … 56)
    // are squeezed towards x = 32 by the row's scale: they converge on the vanishing point.
    for (const y of [1, 30]) {
      const run = opaqueRun(out.pixels, y);
      const edges = crossings(
        run.pixels.map(([r]) => r),
        127.5,
      ).map((x) => run.start + x);
      const scale = (y + 0.5 + 32) / 64;
      expect(edges).toHaveLength(7);
      edges.forEach((x, i) => {
        expect(Math.abs(x - (32 + (8 * (i + 1) - 32) * scale))).toBeLessThan(0.25);
      });
    }
  });

  it('anti-aliases edges against transparency without darkening them', () => {
    const out = transformed(filled(40, 40, RED), homography(SQUARE, TRAPEZOID), 'bilinear');
    const { data } = out.pixels;
    let soft = 0;
    const darkened: number[] = [];
    for (let i = 0; i < data.length; i += 4) {
      if (data[i + 3] > 0 && data[i + 3] < 255) soft++;
      const [r, g, b] = data[i + 3] === 0 ? [0, 0, 0] : [255, 0, 0];
      if (data[i] !== r || data[i + 1] !== g || data[i + 2] !== b) darkened.push(i / 4);
    }
    expect(soft).toBeGreaterThan(0);
    expect(darkened).toEqual([]);
  });

  it('picks the pixel under each centre mapped back, with nearest neighbour', () => {
    const source = pattern(12, 9);
    const m = homography({ x: 0, y: 0, width: 12, height: 9 }, [
      { x: 3, y: 2 },
      { x: 14, y: 0 },
      { x: 17, y: 12 },
      { x: 0, y: 9 },
    ]);
    const inverse = invertProjective(m);
    if (!inverse) throw new Error('Singular');
    const out = transformed(source, m, 'nearest');
    const wrong: string[] = [];
    for (let y = 0; y < out.pixels.height; y++) {
      for (let x = 0; x < out.pixels.width; x++) {
        const [sx, sy] = projectPoint(inverse, out.x + x + 0.5, out.y + y + 0.5);
        const inside = sx >= 0 && sy >= 0 && sx < 12 && sy < 9;
        const expected = inside
          ? getPixel(source, Math.floor(sx + 1e-9), Math.floor(sy + 1e-9))
          : [0, 0, 0, 0];
        if (getPixel(out.pixels, x, y).join() !== expected.join()) wrong.push(`${x},${y}`);
      }
    }
    expect(wrong).toEqual([]);
  });

  it('treats any nonzero multiple of the matrix as the same transform', () => {
    const source = pattern(12, 9);
    const m = homography({ x: 0, y: 0, width: 12, height: 9 }, [
      { x: 1, y: 2 },
      { x: 13, y: 1 },
      { x: 10, y: 11 },
      { x: 2, y: 8 },
    ]);
    for (const interpolation of BOTH) {
      const out = transformed(source, m, interpolation);
      for (const k of [-1, 2]) {
        expect(transformPixels(source, scaled(m, k), interpolation)).toEqual(out);
      }
    }
  });

  it('cuts the output to the clip rect, matching the same pixels uncut', () => {
    const source = pattern(40, 40);
    // Wide enough to step past more than one anchor along each row.
    const m = homography(SQUARE, [
      { x: 20, y: 0 },
      { x: 120, y: 0 },
      { x: 150, y: 40 },
      { x: 0, y: 40 },
    ]);
    const clip = { x: 50, y: 5, width: 90, height: 20 };
    for (const interpolation of BOTH) {
      const whole = transformed(source, m, interpolation);
      const clipped = transformPixels(source, m, interpolation, clip);
      expect(clipped).toMatchObject({ x: 50, y: 5 });
      expect(clipped?.pixels.data).toEqual(
        copyPixels(whole.pixels, { ...clip, x: clip.x - whole.x, y: clip.y - whole.y }).data,
      );
    }
  });

  it('is null when part of the source would cross the horizon', () => {
    // w = 1 − x / 10 is 0 at x = 10, inside the 20 px wide source.
    const m: Projective = [1, 0, 0, 0, 1, 0, -0.1, 0, 1];
    expect(transformPixels(filled(20, 4, RED), m, 'bilinear')).toBeNull();
    expect(transformMask(new Uint8Array(80), 20, 4, m, 'nearest')).toBeNull();
    // Just short of it, there's a (very stretched) image.
    expect(transformPixels(filled(9, 4, RED), m, 'bilinear')).not.toBeNull();
  });
});

/**
 * A buffer whose pixel (x, y) is [10x, 20y, n mod 256, alpha], n counting from 1 in reading
 * order and alpha varying, so that neighbours differ in every channel.
 */
function pattern(width: number, height: number): PixelBuffer {
  const buffer = createPixelBuffer(width, height);
  for (let i = 0; i < width * height; i++) {
    const x = i % width;
    const y = Math.floor(i / width);
    buffer.data.set([(10 * x) % 256, (20 * y) % 256, (i + 1) % 256, 255 - ((7 * i) % 200)], i * 4);
  }
  return buffer;
}

/** The homography taking `source`'s corners to `quad`'s, which must be convex. */
function homography(source: Rect, quad: Quad): Projective {
  const m = homographyFromQuad(source, quad);
  if (!m) throw new Error('Not a convex quad');
  return m;
}

function scaled(m: Projective, k: number): Projective {
  const [m0, m1, m2, m3, m4, m5, m6, m7, m8] = m;
  return [k * m0, k * m1, k * m2, k * m3, k * m4, k * m5, k * m6, k * m7, k * m8];
}

function transformed(
  source: PixelBuffer,
  m: Affine | Projective,
  interpolation: Interpolation,
): TransformedPixels {
  const out = transformPixels(source, m, interpolation);
  if (!out) throw new Error('Nothing to transform');
  return out;
}

/** Row `y`'s pixels from its first fully opaque one to the end of that opaque run. */
function opaqueRun(pixels: PixelBuffer, y: number): { start: number; pixels: Rgba[] } {
  const row = Array.from({ length: pixels.width }, (_, x) => getPixel(pixels, x, y));
  const start = row.findIndex((pixel) => pixel[3] === 255);
  if (start < 0) return { start: 0, pixels: [] };
  let end = start;
  while (end < row.length && row[end][3] === 255) end++;
  return { start, pixels: row.slice(start, end) };
}

/**
 * Where a row of values crosses `level`, in pixel-edge coordinates (value i is at i + 0.5),
 * interpolating linearly between the values on either side.
 */
function crossings(values: readonly number[], level: number): number[] {
  const found: number[] = [];
  for (let i = 1; i < values.length; i++) {
    const a = values[i - 1] - level;
    const b = values[i] - level;
    if (a < 0 !== b < 0) found.push(i - 0.5 + a / (a - b));
  }
  return found;
}

function size(buffer: PixelBuffer) {
  return { width: buffer.width, height: buffer.height };
}
