import { describe, expect, it } from 'vitest';
import type { Rgba } from '../pixel-buffer';
import { createPixelBuffer, getPixel, setPixel } from '../pixel-buffer';
import type { PixelBuffer } from '../pixel-buffer';
import { resizePixels } from './resize';

function bufferOf(width: number, pixels: readonly Rgba[]): PixelBuffer {
  const buffer = createPixelBuffer(width, pixels.length / width);
  pixels.forEach((color, i) => setPixel(buffer, i % width, Math.floor(i / width), color));
  return buffer;
}

function pixelsOf(buffer: PixelBuffer): Rgba[] {
  const out: Rgba[] = [];
  for (let y = 0; y < buffer.height; y++) {
    for (let x = 0; x < buffer.width; x++) out.push(getPixel(buffer, x, y));
  }
  return out;
}

/** A buffer whose pixel (x, y) is [x, y, n, 255], n counting from 1 in reading order. */
function numbered(width: number, height: number): PixelBuffer {
  const buffer = createPixelBuffer(width, height);
  for (let i = 0; i < width * height; i++) {
    buffer.data.set([i % width, Math.floor(i / width), i + 1, 255], i * 4);
  }
  return buffer;
}

const RED: Rgba = [255, 0, 0, 255];
const CLEAR_GREEN: Rgba = [0, 255, 0, 0];

describe('resizePixels: nearest neighbour', () => {
  it('repeats pixels exactly at whole-number scales', () => {
    const source = numbered(2, 2);
    const out = resizePixels(source, 6, 4, 'nearest');
    for (let y = 0; y < 4; y++) {
      for (let x = 0; x < 6; x++) {
        expect(getPixel(out, x, y)).toEqual(getPixel(source, Math.floor(x / 3), Math.floor(y / 2)));
      }
    }
  });

  it('picks the pixel under each output centre when shrinking', () => {
    // Output centre i + 0.5 lands on source x = 2i + 1 at half size.
    const out = resizePixels(numbered(4, 4), 2, 2, 'nearest');
    expect(pixelsOf(out)).toEqual([
      [1, 1, 6, 255],
      [3, 1, 8, 255],
      [1, 3, 14, 255],
      [3, 3, 16, 255],
    ]);
  });
});

describe('resizePixels: bilinear', () => {
  // Opaque corners: black, red 200, green 100 and blue 40.
  const corners = bufferOf(2, [
    [0, 0, 0, 255],
    [200, 0, 0, 255],
    [0, 100, 0, 255],
    [0, 0, 40, 255],
  ]);

  it('interpolates between pixel centres at 2×', () => {
    // Doubling, output centres fall a quarter of a pixel either side of the source's:
    // per axis the weights are 1, ¾ ¼, ¼ ¾, 1 (the outer ones clamped at the edges).
    const out = resizePixels(corners, 4, 4, 'bilinear');
    expect(getPixel(out, 0, 0)).toEqual([0, 0, 0, 255]);
    expect(getPixel(out, 3, 0)).toEqual([200, 0, 0, 255]);
    expect(getPixel(out, 0, 3)).toEqual([0, 100, 0, 255]);
    expect(getPixel(out, 3, 3)).toEqual([0, 0, 40, 255]);
    // ¾ black + ¼ green down the left edge: 25 green.
    expect(getPixel(out, 0, 1)).toEqual([0, 25, 0, 255]);
    // Weights 9/16 black, 3/16 red, 3/16 green, 1/16 blue:
    // red 37.5 → 38, green 18.75 → 19, blue 2.5 → 3.
    expect(getPixel(out, 1, 1)).toEqual([38, 19, 3, 255]);
    // Weights 3/16 black, 9/16 red, 1/16 green, 3/16 blue:
    // red 112.5 → 113, green 6.25 → 6, blue 7.5 → 8.
    expect(getPixel(out, 2, 1)).toEqual([113, 6, 8, 255]);
  });

  it('lends no colour from transparent pixels', () => {
    // Averaging straight alpha would give dark red, [128, 0, 0, 128] and worse further out:
    // premultiplied, the colour stays red and only the alpha falls.
    const pair = bufferOf(2, [RED, CLEAR_GREEN]);
    expect(pixelsOf(resizePixels(pair, 1, 1, 'bilinear'))).toEqual([[255, 0, 0, 128]]);
    // Alphas 255, ¾ × 255 = 191.25 → 191, ¼ × 255 = 63.75 → 64, and none.
    expect(pixelsOf(resizePixels(pair, 4, 1, 'bilinear'))).toEqual([
      [255, 0, 0, 255],
      [255, 0, 0, 191],
      [255, 0, 0, 64],
      [0, 0, 0, 0],
    ]);
  });

  it('keeps a uniform image uniform when shrinking', () => {
    const color: Rgba = [10, 200, 30, 180];
    const source = createPixelBuffer(7, 5);
    for (let i = 0; i < 35; i++) source.data.set(color, i * 4);
    for (const [width, height] of [
      [3, 2],
      [1, 1],
      [6, 4],
    ]) {
      for (const interpolation of ['bilinear', 'nearest'] as const) {
        const out = resizePixels(source, width, height, interpolation);
        expect(new Set(pixelsOf(out).map(String))).toEqual(new Set([String(color)]));
      }
    }
  });

  it('averages every source pixel when shrinking', () => {
    // Alpha 0, 0, 255, 255 halved. Plain bilinear would only blend the two pixels nearest
    // each output centre, giving alpha 0 and 255; the kernel stretched to the reduction
    // reaches the pixels in between.
    const row = bufferOf(4, [[255, 255, 255, 0], [255, 255, 255, 0], RED, RED]);
    const out = resizePixels(row, 2, 1, 'bilinear');
    // Output 0 centres on source x = 0.5 and reaches 2 pixels either side: weights ¾ ¾ ¼
    // for x = 0, 1, 2 (sum 1.75), so alpha 255 × ¼ / 1.75 = 36.4 → 36. Output 1 mirrors it:
    // 255 × 1.5 / 1.75 = 218.6 → 219.
    expect(pixelsOf(out)).toEqual([
      [255, 0, 0, 36],
      [255, 0, 0, 219],
    ]);
  });
});

describe('resizePixels', () => {
  it('copies the buffer at the same size', () => {
    const source = numbered(3, 2);
    const out = resizePixels(source, 3, 2, 'bilinear');
    expect(out).not.toBe(source);
    expect(out.data).toEqual(source.data);
  });

  it('refuses invalid sizes', () => {
    const source = numbered(3, 2);
    expect(() => resizePixels(source, 0, 2, 'bilinear')).toThrow(RangeError);
    expect(() => resizePixels(source, 2.5, 2, 'nearest')).toThrow(RangeError);
  });
});
