import { inflateSync, zlibSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import type { PixelBuffer } from '../../core';
import { UnsupportedPngError, crc32, decodePng, encodePng } from './png';

const SIGNATURE = [137, 80, 78, 71, 13, 10, 26, 10];

function bytesOf(text: string): number[] {
  return Array.from(text, (char) => char.charCodeAt(0));
}

function u32(value: number): number[] {
  return [value >>> 24, (value >>> 16) & 0xff, (value >>> 8) & 0xff, value & 0xff];
}

function chunk(type: string, data: ArrayLike<number>): number[] {
  const body = Uint8Array.from([...bytesOf(type), ...Array.from(data)]);
  return [...u32(data.length), ...body, ...u32(crc32(body))];
}

function ihdr(width: number, height: number, depth: number, colorType: number, interlace = 0) {
  return chunk('IHDR', [...u32(width), ...u32(height), depth, colorType, 0, 0, interlace]);
}

/** IDAT holding `rows`, each already prefixed with its filter-type byte. */
function idat(rows: number[][]): number[] {
  return chunk('IDAT', zlibSync(Uint8Array.from(rows.flat())));
}

function png(...chunks: number[][]): Uint8Array {
  return Uint8Array.from([...SIGNATURE, ...chunks.flat(), ...chunk('IEND', [])]);
}

function pixelsFrom(width: number, height: number, rgba: number[]): PixelBuffer {
  return { width, height, data: Uint8ClampedArray.from(rgba) };
}

function base64(text: string): Uint8Array {
  return Uint8Array.from(atob(text), (char) => char.charCodeAt(0));
}

/** Deterministic pseudo-random bytes (xorshift32). */
function randomBytes(length: number, seed: number): number[] {
  let state = seed;
  return Array.from({ length }, () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return state & 0xff;
  });
}

describe('crc32', () => {
  it('matches the standard check values', () => {
    expect(crc32(Uint8Array.from(bytesOf('123456789')))).toBe(0xcbf43926);
    expect(crc32(Uint8Array.from(bytesOf('IEND')))).toBe(0xae426082);
    expect(crc32(new Uint8Array())).toBe(0);
  });
});

describe('encodePng', () => {
  it('writes an 8-bit RGBA header, sRGB tag and IEND', () => {
    const out = encodePng(pixelsFrom(3, 2, new Array<number>(24).fill(9)));
    expect(Array.from(out.subarray(0, 8))).toEqual(SIGNATURE);
    // Length 13, "IHDR", width 3, height 2, depth 8, colour type 6, then three zeros.
    expect(Array.from(out.subarray(8, 29))).toEqual([
      ...u32(13),
      ...bytesOf('IHDR'),
      ...u32(3),
      ...u32(2),
      8,
      6,
      0,
      0,
      0,
    ]);
    expect(Array.from(out.subarray(33, 46))).toEqual([
      ...u32(1),
      ...bytesOf('sRGB'),
      0,
      0xae,
      0xce,
      0x1c,
      0xe9,
    ]);
    expect(Array.from(out.subarray(-12))).toEqual([
      ...u32(0),
      ...bytesOf('IEND'),
      0xae,
      0x42,
      0x60,
      0x82,
    ]);
  });

  it('round-trips every alpha value and colour exactly', () => {
    const width = 16;
    const height = 20;
    const rgba = randomBytes(width * height * 4, 0x9e3779b9);
    // Make sure every alpha value, including the ones canvases round badly, is present.
    for (let i = 0; i < 256; i++) rgba[i * 4 + 3] = i;
    const pixels = pixelsFrom(width, height, rgba);
    expect(decodePng(encodePng(pixels))).toEqual(pixels);
  });

  it('round-trips a 1×1 image', () => {
    const pixels = pixelsFrom(1, 1, [1, 2, 3, 4]);
    expect(decodePng(encodePng(pixels))).toEqual(pixels);
  });

  it('chooses a filter per row', () => {
    // Row 0 is a horizontal ramp (Sub turns it into a constant), row 1 repeats it (Up
    // turns it into zeros).
    const ramp = Array.from({ length: 8 }, (_, x) => [x * 20, x * 20, x * 20, 255]).flat();
    const out = encodePng(pixelsFrom(8, 2, [...ramp, ...ramp]));
    const idatStart = 8 + 25 + 13;
    const length = new DataView(out.buffer).getUint32(idatStart);
    const raw = inflateSync(out.subarray(idatStart + 8 + 2, idatStart + 8 + length - 4));
    expect([raw[0], raw[33]]).toEqual([1, 2]);
  });

  it('rejects empty and oversized images', () => {
    expect(() => encodePng(pixelsFrom(0, 0, []))).toThrow(RangeError);
    expect(() => encodePng({ width: 8193, height: 1, data: new Uint8ClampedArray(0) })).toThrow(
      /8192/,
    );
  });
});

describe('decodePng', () => {
  it('decodes a PNG written by Chromium (split across two IDAT chunks)', () => {
    // 3×2 canvas: red, green, blue / (10,20,30), transparent, (250,128,7).
    const chromium = base64(
      'iVBORw0KGgoAAAANSUhEUgAAAAMAAAACCAYAAACddGYaAAAAH0lEQVR4AWL6z8DwHwwZ/v9n4haRY2BgZGD8' +
        '1cDBAAAAAP//GqGPigAAAAZJREFUAwB6BgfAYkgDUwAAAABJRU5ErkJggg==',
    );
    expect(decodePng(chromium)).toEqual(
      pixelsFrom(3, 2, [
        ...[255, 0, 0, 255, 0, 255, 0, 255, 0, 0, 255, 255],
        ...[10, 20, 30, 255, 0, 0, 0, 0, 250, 128, 7, 255],
      ]),
    );
  });

  // 2×2 RGB image (10,20,30) (40,50,60) / (15,25,35) (100,0,200), stored with each
  // filter. Filtered bytes are x - prediction mod 256, worked out by hand.
  const expected = pixelsFrom(2, 2, [
    ...[10, 20, 30, 255, 40, 50, 60, 255],
    ...[15, 25, 35, 255, 100, 0, 200, 255],
  ]);
  const filtered: Record<string, number[][]> = {
    // Predicts nothing.
    none: [
      [0, 10, 20, 30, 40, 50, 60],
      [0, 15, 25, 35, 100, 0, 200],
    ],
    // Predicts the pixel to the left: 40-10=30 …; 100-15=85, 0-25=-25→231, 200-35=165.
    sub: [
      [1, 10, 20, 30, 30, 30, 30],
      [1, 15, 25, 35, 85, 231, 165],
    ],
    // Predicts the pixel above: 15-10=5 …; 100-40=60, 0-50=-50→206, 200-60=140.
    up: [
      [2, 10, 20, 30, 40, 50, 60],
      [2, 5, 5, 5, 60, 206, 140],
    ],
    // Predicts floor((left + above) / 2): 40-floor(10/2)=35 …; 15-floor(10/2)=10 …;
    // 100-floor((15+40)/2)=73, 0-37=-37→219, 200-47=153.
    average: [
      [3, 10, 20, 30, 35, 40, 45],
      [3, 10, 15, 20, 73, 219, 153],
    ],
    // Paeth picks left on row 0, then above for both pixels of row 1 (for the second,
    // p = a+b-c = (45,55,65) is closest to b = (40,50,60)).
    paeth: [
      [4, 10, 20, 30, 30, 30, 30],
      [4, 5, 5, 5, 60, 206, 140],
    ],
  };
  for (const [name, rows] of Object.entries(filtered)) {
    it(`reverses the ${name} filter`, () => {
      expect(decodePng(png(ihdr(2, 2, 8, 2), idat(rows)))).toEqual(expected);
    });
  }

  it('decodes greyscale with a transparent key colour', () => {
    // tRNS gives the transparent grey as a 16-bit value: 128.
    const out = decodePng(png(ihdr(2, 1, 8, 0), chunk('tRNS', [0, 128]), idat([[0, 0, 128]])));
    expect(out).toEqual(pixelsFrom(2, 1, [0, 0, 0, 255, 128, 128, 128, 0]));
  });

  it('scales low bit depth greyscale to 0–255', () => {
    // 1-bit 1,0,1 packed as 0b101xxxxx; 4-bit 3, 15 packed as 0x3f (3×17=51).
    expect(decodePng(png(ihdr(3, 1, 1, 0), idat([[0, 0b10100000]]))).data).toEqual(
      Uint8ClampedArray.from([255, 255, 255, 255, 0, 0, 0, 255, 255, 255, 255, 255]),
    );
    expect(decodePng(png(ihdr(2, 1, 4, 0), idat([[0, 0x3f]]))).data).toEqual(
      Uint8ClampedArray.from([51, 51, 51, 255, 255, 255, 255, 255]),
    );
  });

  it('decodes a 2-bit palette with per-entry alpha', () => {
    // Indices 0, 1, 2 packed as 0b00_01_10_00; tRNS covers only the first two entries.
    const out = decodePng(
      png(
        ihdr(3, 1, 2, 3),
        chunk('PLTE', [255, 0, 0, 0, 255, 0, 0, 0, 255]),
        chunk('tRNS', [255, 128]),
        idat([[0, 0b00011000]]),
      ),
    );
    expect(out).toEqual(pixelsFrom(3, 1, [255, 0, 0, 255, 0, 255, 0, 128, 0, 0, 255, 255]));
  });

  it('decodes grey + alpha', () => {
    expect(decodePng(png(ihdr(1, 1, 8, 4), idat([[0, 200, 100]]))).data).toEqual(
      Uint8ClampedArray.from([200, 200, 200, 100]),
    );
  });

  it('rounds 16-bit samples to the nearest 8-bit value', () => {
    // round(v / 257): 0xffff→255, 0x807f (32895)→127.996→128, 0x0080 (128)→0.498→0,
    // 0x0081 (129)→0.502→1.
    const out = decodePng(
      png(ihdr(1, 1, 16, 6), idat([[0, 0xff, 0xff, 0x80, 0x7f, 0, 0x80, 0, 0x81]])),
    );
    expect(out.data).toEqual(Uint8ClampedArray.from([255, 128, 0, 1]));
  });

  it('applies a 16-bit RGB transparent key to raw samples', () => {
    // 0x1234→18, 0x5678→86, 0x9abc→154; the second pixel matches the key (0, 0, 0).
    const row = [0, 0x12, 0x34, 0x56, 0x78, 0x9a, 0xbc, 0, 0, 0, 0, 0, 0];
    const out = decodePng(png(ihdr(2, 1, 16, 2), chunk('tRNS', [0, 0, 0, 0, 0, 0]), idat([row])));
    expect(out.data).toEqual(Uint8ClampedArray.from([18, 86, 154, 255, 0, 0, 0, 0]));
  });

  it('reports interlaced PNGs and unknown critical chunks as unsupported', () => {
    expect(() => decodePng(png(ihdr(1, 1, 8, 6, 1), idat([[0, 0, 0, 0, 0]])))).toThrow(
      UnsupportedPngError,
    );
    expect(() =>
      decodePng(png(ihdr(1, 1, 8, 6), chunk('ABCD', []), idat([[0, 0, 0, 0, 0]]))),
    ).toThrow(UnsupportedPngError);
  });

  it('skips ancillary chunks it does not know', () => {
    const out = decodePng(
      png(ihdr(1, 1, 8, 6), chunk('tEXt', bytesOf('a\0b')), idat([[0, 1, 2, 3, 4]])),
    );
    expect(out.data).toEqual(Uint8ClampedArray.from([1, 2, 3, 4]));
  });

  it('rejects damaged data', () => {
    const good = png(ihdr(1, 1, 8, 6), idat([[0, 1, 2, 3, 4]]));
    expect(() => decodePng(Uint8Array.from(bytesOf('GIF89a')))).toThrow(/Not a PNG/);
    expect(() => decodePng(good.subarray(0, 30))).toThrow(/truncated/);

    const badCrc = good.slice();
    badCrc[20] ^= 1; // inside IHDR's height
    expect(() => decodePng(badCrc)).toThrow(/bad IHDR checksum/);

    expect(() => decodePng(png(ihdr(1, 1, 8, 6), idat([[5, 1, 2, 3, 4]])))).toThrow(/filter/);
    expect(() => decodePng(png(ihdr(2, 1, 8, 6), idat([[0, 1, 2, 3, 4]])))).toThrow(/truncated/);
    expect(() => decodePng(png(ihdr(1, 1, 8, 6), chunk('IDAT', [1, 2, 3])))).toThrow(/damaged/);
    expect(() => decodePng(png(ihdr(1, 1, 3, 6), idat([[0]])))).toThrow(/header/);
    expect(() => decodePng(png(ihdr(1, 1, 8, 3), idat([[0, 0]])))).toThrow(/no palette/);
    expect(() =>
      decodePng(png(ihdr(1, 1, 8, 3), chunk('PLTE', [1, 2, 3]), idat([[0, 1]]))),
    ).toThrow(/outside its palette/);
    expect(() => decodePng(png(ihdr(1, 1, 8, 6)))).toThrow(/no image data/);
  });

  it('rejects images larger than Pixelsoup supports before inflating them', () => {
    expect(() => decodePng(png(ihdr(9000, 1, 8, 6), idat([[0]])))).toThrow(RangeError);
    expect(() => decodePng(png(ihdr(9000, 1, 8, 6), idat([[0]])))).toThrow(/8192×8192/);
  });
});
