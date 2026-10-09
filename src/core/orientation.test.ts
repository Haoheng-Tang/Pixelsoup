import { describe, expect, it } from 'vitest';
import type { Rect } from './geometry';
import type { Orientation } from './orientation';
import { inverseOrientation, orientPixels, orientRect, orientedSize } from './orientation';

const ALL: readonly Orientation[] = [
  'rotate-cw',
  'rotate-ccw',
  'rotate-180',
  'flip-horizontal',
  'flip-vertical',
];

/** A one-byte-per-pixel image from rows of letters. */
function image(rows: string[]): Uint8ClampedArray<ArrayBuffer> {
  return Uint8ClampedArray.from([...rows.join('')].map((c) => c.charCodeAt(0)));
}

function rowsOf(data: ArrayLike<number>, width: number): string[] {
  const rows: string[] = [];
  for (let i = 0; i < data.length; i += width) {
    rows.push(String.fromCharCode(...Array.from({ length: width }, (_, k) => data[i + k])));
  }
  return rows;
}

/** Bounds of the non-zero pixels of a one-byte-per-pixel image. */
function boundsOf(data: ArrayLike<number>, width: number, height: number): Rect | null {
  let [minX, minY, maxX, maxY] = [Infinity, Infinity, -1, -1];
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (data[y * width + x] === 0) continue;
      [minX, minY] = [Math.min(minX, x), Math.min(minY, y)];
      [maxX, maxY] = [Math.max(maxX, x), Math.max(maxY, y)];
    }
  }
  return maxX < 0 ? null : { x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1 };
}

describe('orientPixels', () => {
  const abc = image(['abc', 'def']);

  it('turns and flips an image', () => {
    // A clockwise turn takes the top-left pixel to the top-right.
    expect(rowsOf(orientPixels('rotate-cw', abc, 3, 2, 1), 2)).toEqual(['da', 'eb', 'fc']);
    expect(rowsOf(orientPixels('rotate-ccw', abc, 3, 2, 1), 2)).toEqual(['cf', 'be', 'ad']);
    expect(rowsOf(orientPixels('rotate-180', abc, 3, 2, 1), 3)).toEqual(['fed', 'cba']);
    expect(rowsOf(orientPixels('flip-horizontal', abc, 3, 2, 1), 3)).toEqual(['cba', 'fed']);
    expect(rowsOf(orientPixels('flip-vertical', abc, 3, 2, 1), 3)).toEqual(['def', 'abc']);
  });

  it('moves every channel of a pixel together, however the bytes are laid out', () => {
    // Pixel p of the letters image becomes [p, p + 1, p + 2, p + 3] with four channels.
    const expand = (data: ArrayLike<number>, channels: number) =>
      Array.from(
        { length: data.length * channels },
        (_, i) => data[(i / channels) | 0] + (i % channels),
      );
    const rgba = Uint8ClampedArray.from(expand(abc, 4));
    const rgb = Uint8ClampedArray.from(expand(abc, 3));
    // An RGBA view that isn't 4-byte aligned can't be read as 32-bit words.
    const unaligned = new Uint8ClampedArray(rgba.length + 1).subarray(1);
    unaligned.set(rgba);
    for (const orientation of ALL) {
      const letters = orientPixels(orientation, abc, 3, 2, 1);
      expect(Array.from(orientPixels(orientation, rgba, 3, 2, 4))).toEqual(expand(letters, 4));
      expect(Array.from(orientPixels(orientation, unaligned, 3, 2, 4))).toEqual(expand(letters, 4));
      expect(Array.from(orientPixels(orientation, rgb, 3, 2, 3))).toEqual(expand(letters, 3));
    }
  });

  it('gives back the same bytes after the inverse, four quarter turns or two flips', () => {
    const rows = ['abcd', 'efgh', 'ijkl'];
    const data = image(rows);
    for (const orientation of ALL) {
      const size = orientedSize(orientation, 4, 3);
      const there = orientPixels(orientation, data, 4, 3, 1);
      const back = orientPixels(inverseOrientation(orientation), there, size.width, size.height, 1);
      expect(rowsOf(back, 4)).toEqual(rows);
    }
    let turned = data;
    for (let i = 0; i < 4; i++)
      turned = orientPixels('rotate-cw', turned, i % 2 ? 3 : 4, i % 2 ? 4 : 3, 1);
    expect(rowsOf(turned, 4)).toEqual(rows);
    const flippedTwice = orientPixels(
      'flip-vertical',
      orientPixels('flip-horizontal', data, 4, 3, 1),
      4,
      3,
      1,
    );
    expect(flippedTwice).toEqual(orientPixels('rotate-180', data, 4, 3, 1));
  });

  it('rejects data of the wrong length and handles empty images', () => {
    expect(() => orientPixels('rotate-cw', abc, 2, 2, 1)).toThrow(RangeError);
    expect(orientPixels('rotate-cw', new Uint8ClampedArray(0), 0, 5, 4)).toHaveLength(0);
  });
});

describe('orientRect', () => {
  it('maps a rect to where its pixels go', () => {
    const [width, height] = [5, 4];
    const area: Rect = { x: 1, y: 0, width: 3, height: 2 };
    const mask = new Uint8ClampedArray(width * height);
    for (let y = area.y; y < area.y + area.height; y++) {
      mask.fill(1, y * width + area.x, y * width + area.x + area.width);
    }
    for (const orientation of ALL) {
      const size = orientedSize(orientation, width, height);
      const turned = orientPixels(orientation, mask, width, height, 1);
      expect(orientRect(orientation, area, width, height)).toEqual(
        boundsOf(turned, size.width, size.height),
      );
    }
  });

  it('maps rects past the canvas edges the same way', () => {
    const area: Rect = { x: -2, y: 3, width: 4, height: 2 };
    expect(orientRect('rotate-cw', area, 5, 4)).toEqual({ x: -1, y: -2, width: 2, height: 4 });
    expect(orientRect('rotate-ccw', area, 5, 4)).toEqual({ x: 3, y: 3, width: 2, height: 4 });
    expect(orientRect('flip-horizontal', area, 5, 4)).toEqual({ x: 3, y: 3, width: 4, height: 2 });
  });
});
