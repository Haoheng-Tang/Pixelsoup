import { describe, expect, it } from 'vitest';
import { createDocument, createLayerId } from '../document';
import type { RasterLayer } from '../layer';
import { createRasterLayer } from '../layer';
import type { PixelBuffer, Rgba } from '../pixel-buffer';
import { createPixelBuffer, fillRect, getPixel, setPixel } from '../pixel-buffer';
import { canvasPixels, floodRegion, floodSelection } from './flood-region';

const PALETTE: Readonly<Record<string, Rgba>> = {
  w: [255, 255, 255, 255],
  k: [0, 0, 0, 255],
  r: [255, 0, 0, 255],
  // Transparent pixels that still hold colours, which a flood fill ignores.
  '.': [0, 0, 0, 0],
  t: [255, 0, 0, 0],
};

/** An image from rows of palette letters. */
function image(rows: string[]): PixelBuffer {
  const buffer = createPixelBuffer(rows[0].length, rows.length);
  rows.forEach((row, y) => {
    [...row].forEach((c, x) => setPixel(buffer, x, y, PALETTE[c]));
  });
  return buffer;
}

/** A one-row image of opaque pixels. */
function strip(colors: Rgba[]): PixelBuffer {
  const buffer = createPixelBuffer(colors.length, 1);
  colors.forEach((color, x) => setPixel(buffer, x, 0, color));
  return buffer;
}

const gray = (v: number): Rgba => [v, v, v, 255];

/** A mask as rows of '#' (255), '.' (0) and '+' (anything between). */
function rowsOf(mask: Uint8ClampedArray, width: number): string[] {
  const rows: string[] = [];
  for (let i = 0; i < mask.length; i += width) {
    rows.push(
      [...mask.subarray(i, i + width)].map((v) => (v === 255 ? '#' : v ? '+' : '.')).join(''),
    );
  }
  return rows;
}

describe('floodRegion', () => {
  it('matches pixels whose channels are all within the tolerance, inclusively', () => {
    const pixels = strip([gray(100), gray(131), gray(132), gray(133), gray(68), gray(67)]);
    const flood = (tolerance: number) =>
      rowsOf(floodRegion(pixels, { x: 0, y: 0 }, tolerance, false), 6)[0];
    expect(flood(0)).toBe('#.....');
    expect(flood(31)).toBe('##....');
    expect(flood(32)).toBe('###.#.');
    expect(flood(33)).toBe('######');
    expect(flood(255)).toBe('######');
  });

  it('compares the largest difference of any one channel, alpha included', () => {
    const pixels = strip([
      [100, 100, 100, 255],
      [100, 100, 140, 255],
      [120, 80, 120, 255],
      [100, 100, 100, 200],
    ]);
    expect(rowsOf(floodRegion(pixels, { x: 0, y: 0 }, 32, false), 4)).toEqual(['#.#.']);
    expect(rowsOf(floodRegion(pixels, { x: 0, y: 0 }, 55, false), 4)).toEqual(['####']);
  });

  it('keeps a contiguous region to pixels connected to the start', () => {
    const pixels = image(['wwkww', 'wwkww', 'kkkww']);
    expect(rowsOf(floodRegion(pixels, { x: 0, y: 0 }, 0, true), 5)).toEqual([
      '##...',
      '##...',
      '.....',
    ]);
    expect(rowsOf(floodRegion(pixels, { x: 0, y: 0 }, 0, false), 5)).toEqual([
      '##.##',
      '##.##',
      '...##',
    ]);
    expect(rowsOf(floodRegion(pixels, { x: 4.5, y: 2.9 }, 0, true), 5)).toEqual([
      '...##',
      '...##',
      '...##',
    ]);
  });

  it("doesn't leak through diagonal gaps", () => {
    const pixels = image(['wwwk', 'wwkw', 'wkww', 'kwww']);
    expect(rowsOf(floodRegion(pixels, { x: 0, y: 0 }, 0, true), 4)).toEqual([
      '###.',
      '##..',
      '#...',
      '....',
    ]);
    // The black diagonal is four separate regions.
    expect(rowsOf(floodRegion(pixels, { x: 3, y: 0 }, 0, true), 4)).toEqual([
      '...#',
      '....',
      '....',
      '....',
    ]);
  });

  it('follows winding paths, back up and round', () => {
    const pixels = image(['wwwww', 'kkkkw', 'wwwkw', 'wkwkw', 'wkwww']);
    expect(rowsOf(floodRegion(pixels, { x: 0, y: 0 }, 0, true), 5)).toEqual([
      '#####',
      '....#',
      '###.#',
      '#.#.#',
      '#.###',
    ]);
  });

  it('treats every fully transparent pixel as (0, 0, 0, 0)', () => {
    const pixels = image(['.t.', 'twk']);
    expect(rowsOf(floodRegion(pixels, { x: 1, y: 0 }, 0, true), 3)).toEqual(['###', '#..']);
    // Opaque black is 255 away from transparent, in alpha.
    expect(rowsOf(floodRegion(pixels, { x: 2, y: 1 }, 254, false), 3)).toEqual(['...', '..#']);
    expect(rowsOf(floodRegion(pixels, { x: 2, y: 1 }, 255, false), 3)).toEqual(['###', '###']);
    const faint = strip([
      [0, 0, 0, 0],
      [10, 10, 10, 10],
      [255, 0, 0, 0],
    ]);
    expect(rowsOf(floodRegion(faint, { x: 0, y: 0 }, 10, true), 3)).toEqual(['###']);
    expect(rowsOf(floodRegion(faint, { x: 0, y: 0 }, 9, true), 3)).toEqual(['#..']);
  });

  it('softens the edge by a pixel when anti-aliased', () => {
    const pixels = image(['kkkkk', 'kwwwk', 'kwwwk', 'kwwwk', 'kkkkk']);
    expect(rowsOf(floodRegion(pixels, { x: 2, y: 2 }, 0, true), 5)).toEqual([
      '.....',
      '.###.',
      '.###.',
      '.###.',
      '.....',
    ]);
    // 255 × n / 8 for n of the eight neighbours in the region: a corner touches one
    // (31.875, so 32), the pixels beside it two (63.75, so 64) and the middles three
    // (95.625, so 96).
    // prettier-ignore
    expect([...floodRegion(pixels, { x: 2, y: 2 }, 0, true, true)]).toEqual([
      32, 64, 96, 64, 32,
      64, 255, 255, 255, 64,
      96, 255, 255, 255, 96,
      64, 255, 255, 255, 64,
      32, 64, 96, 64, 32,
    ]);
  });

  it('fills a one-pixel hole when anti-aliased, and stops at the image edge', () => {
    const pixels = image(['www', 'wkw', 'www']);
    expect(rowsOf(floodRegion(pixels, { x: 0, y: 0 }, 0, true), 3)).toEqual(['###', '#.#', '###']);
    expect([...floodRegion(pixels, { x: 0, y: 0 }, 0, true, true)]).toEqual(
      new Array<number>(9).fill(255),
    );
  });

  it('handles a 1×1 image and a uniform one', () => {
    const one = image(['r']);
    expect([...floodRegion(one, { x: 0, y: 0 }, 0, true, true)]).toEqual([255]);
    const uniform = image(['www', 'www']);
    for (const contiguous of [true, false]) {
      expect([...floodRegion(uniform, { x: 1, y: 1 }, 0, contiguous, true)]).toEqual(
        new Array<number>(6).fill(255),
      );
    }
  });

  it('is empty from a start outside the image, and rejects tolerances outside 0–255', () => {
    const pixels = image(['ww', 'ww']);
    for (const start of [
      { x: -1, y: 0 },
      { x: 2, y: 0 },
      { x: 0, y: 2 },
      { x: NaN, y: 0 },
    ]) {
      expect([...floodRegion(pixels, start, 0, true)]).toEqual([0, 0, 0, 0]);
    }
    expect(() => floodRegion(pixels, { x: 0, y: 0 }, -1, true)).toThrow(RangeError);
    expect(() => floodRegion(pixels, { x: 0, y: 0 }, 256, true)).toThrow(RangeError);
  });

  it('floods 2000 × 2000 pixels well within a second', () => {
    const uniform = createPixelBuffer(2000, 2000);
    fillRect(uniform, { x: 0, y: 0, width: 2000, height: 2000 }, PALETTE.w);
    // A comb: every other column is a wall below the first row, so the fill runs down
    // and back up a thousand teeth.
    const comb = createPixelBuffer(2000, 2000);
    fillRect(comb, { x: 0, y: 0, width: 2000, height: 2000 }, PALETTE.w);
    for (let x = 1; x < 2000; x += 2)
      fillRect(comb, { x, y: 1, width: 1, height: 1999 }, PALETTE.k);

    const started = Date.now();
    const all = floodRegion(uniform, { x: 1000, y: 1000 }, 32, true, true);
    const teeth = floodRegion(comb, { x: 0, y: 1999 }, 32, true, true);
    const elapsed = Date.now() - started;

    expect(all.every((v) => v === 255)).toBe(true);
    expect(teeth[1999 * 2000 + 1998]).toBe(255);
    // The wall's bottom corner touches the region up-left and left: 255 × 2 / 8 = 63.75.
    expect(teeth[1999 * 2000 + 1999]).toBe(64);
    expect(elapsed).toBeLessThan(1000);
  });
});

/**
 * A 4×3 canvas: a white background, under a 2×2 "Paint" layer at (1, 1) that is red on
 * its left column and transparent on its right.
 */
function setup() {
  const doc = createDocument(4, 3);
  const background = createRasterLayer({
    id: createLayerId(doc),
    name: 'Background',
    width: 4,
    height: 3,
  });
  fillRect(background.pixels, { x: 0, y: 0, width: 4, height: 3 }, PALETTE.w);
  const paint: RasterLayer = createRasterLayer({
    id: createLayerId(doc),
    name: 'Paint',
    x: 1,
    y: 1,
    width: 2,
    height: 2,
  });
  fillRect(paint.pixels, { x: 0, y: 0, width: 1, height: 2 }, PALETTE.r);
  doc.layers.push(background, paint);
  return { doc, background, paint };
}

describe('canvasPixels', () => {
  it("places a layer's own pixels on a transparent canvas", () => {
    const { doc, paint } = setup();
    const pixels = canvasPixels(doc, { layerId: paint.id });
    expect(pixels).toMatchObject({ width: 4, height: 3 });
    expect(getPixel(pixels!, 1, 1)).toEqual(PALETTE.r);
    expect(getPixel(pixels!, 2, 1)).toEqual(PALETTE['.']);
    expect(getPixel(pixels!, 0, 0)).toEqual(PALETTE['.']);
    paint.x = 3;
    paint.y = -1;
    expect(getPixel(canvasPixels(doc, { layerId: paint.id })!, 3, 0)).toEqual(PALETTE.r);
    paint.x = 5;
    expect(canvasPixels(doc, { layerId: paint.id })!.data.every((v) => v === 0)).toBe(true);
  });

  it('shares the buffer of a layer that exactly covers the canvas', () => {
    const { doc, background } = setup();
    expect(canvasPixels(doc, { layerId: background.id })).toBe(background.pixels);
  });

  it('composites the visible layers, and is null for a missing layer', () => {
    const { doc, paint } = setup();
    expect(getPixel(canvasPixels(doc, 'composite')!, 1, 1)).toEqual(PALETTE.r);
    paint.visible = false;
    expect(getPixel(canvasPixels(doc, 'composite')!, 1, 1)).toEqual(PALETTE.w);
    expect(canvasPixels(doc, { layerId: 'missing' })).toBeNull();
  });
});

describe('floodSelection', () => {
  const options = { tolerance: 0, contiguous: true, antiAlias: false } as const;

  it('floods the composite when sampling all layers', () => {
    const { doc } = setup();
    const s = floodSelection(doc, 0.5, 0.5, { ...options, source: 'composite' });
    expect(rowsOf(s!.mask, 4)).toEqual(['####', '#.##', '#.##']);
  });

  it("floods one layer's own pixels", () => {
    const { doc, background, paint } = setup();
    const s = floodSelection(doc, 0, 0, { ...options, source: { layerId: background.id } });
    expect(rowsOf(s!.mask, 4)).toEqual(['####', '####', '####']);
    // The paint layer is transparent wherever it isn't red, on the canvas or not.
    const clear = floodSelection(doc, 2, 1, { ...options, source: { layerId: paint.id } });
    expect(rowsOf(clear!.mask, 4)).toEqual(['####', '#.##', '#.##']);
  });

  it('is null off the canvas or for a missing layer', () => {
    const { doc } = setup();
    expect(floodSelection(doc, -0.5, 0, { ...options, source: 'composite' })).toBeNull();
    expect(floodSelection(doc, 4, 0, { ...options, source: 'composite' })).toBeNull();
    expect(floodSelection(doc, 0, 0, { ...options, source: { layerId: 'missing' } })).toBeNull();
  });
});
