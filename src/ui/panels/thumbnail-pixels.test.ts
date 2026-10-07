import { describe, expect, it } from 'vitest';
import type { Rgba } from '../../core';
import { createPixelBuffer, setPixel } from '../../core';
import type { RgbaImage } from './thumbnail-pixels';
import { fitSize, renderThumbnail } from './thumbnail-pixels';

function image(width: number, height: number): RgbaImage {
  return { width, height, data: new Uint8ClampedArray(width * height * 4) };
}

function pixelsOf(out: RgbaImage): Rgba[] {
  const result: Rgba[] = [];
  for (let i = 0; i < out.data.length; i += 4) {
    result.push([out.data[i], out.data[i + 1], out.data[i + 2], out.data[i + 3]]);
  }
  return result;
}

describe('fitSize', () => {
  it('keeps the aspect ratio within the box', () => {
    expect(fitSize(1920, 1080, 64, 40)).toEqual({ width: 64, height: 36 });
    expect(fitSize(100, 1000, 64, 40)).toEqual({ width: 4, height: 40 });
    expect(fitSize(3, 3, 64, 40)).toEqual({ width: 40, height: 40 });
    expect(fitSize(2000, 10, 64, 40)).toEqual({ width: 64, height: 1 });
  });
});

describe('renderThumbnail', () => {
  it('averages opaque blocks when shrinking', () => {
    const pixels = createPixelBuffer(4, 2);
    // Left 2 × 2 block: black, dark red, green, dark blue. Right block: white.
    setPixel(pixels, 0, 0, [0, 0, 0, 255]);
    setPixel(pixels, 1, 0, [100, 0, 0, 255]);
    setPixel(pixels, 0, 1, [0, 200, 0, 255]);
    setPixel(pixels, 1, 1, [0, 0, 40, 255]);
    for (const [x, y] of [
      [2, 0],
      [3, 0],
      [2, 1],
      [3, 1],
    ]) {
      setPixel(pixels, x, y, [255, 255, 255, 255]);
    }
    const out = image(2, 1);
    renderThumbnail(pixels, out, 8);
    // Left: (0 + 100 + 0 + 0) / 4 = 25, 200 / 4 = 50, 40 / 4 = 10.
    expect(pixelsOf(out)).toEqual([
      [25, 50, 10, 255],
      [255, 255, 255, 255],
    ]);
  });

  it('spreads at most four samples per axis over a large footprint', () => {
    const pixels = createPixelBuffer(16, 1);
    for (let x = 0; x < 16; x++) setPixel(pixels, x, 0, [x * 10, 0, 0, 255]);
    const out = image(1, 1);
    renderThumbnail(pixels, out, 8);
    // Samples at x = 2, 6, 10, 14: (20 + 60 + 100 + 140) / 4 = 80.
    expect(pixelsOf(out)).toEqual([[80, 0, 0, 255]]);
  });

  it('shows the checkerboard through transparent pixels', () => {
    const out = image(2, 2);
    renderThumbnail(createPixelBuffer(2, 2), out, 1);
    expect(pixelsOf(out)).toEqual([
      [255, 255, 255, 255],
      [204, 204, 204, 255],
      [204, 204, 204, 255],
      [255, 255, 255, 255],
    ]);
  });

  it('blends translucent pixels over the checkerboard, repeating them when enlarging', () => {
    const pixels = createPixelBuffer(1, 1);
    setPixel(pixels, 0, 0, [255, 0, 0, 128]);
    const out = image(2, 1);
    renderThumbnail(pixels, out, 1);
    // Light: 255 × 128/255 + 255 × 127/255 = 255; 255 × 127/255 = 127.
    // Dark: 128 + 204 × 127/255 = 229.6 → 230; 204 × 127/255 = 101.6 → 102.
    expect(pixelsOf(out)).toEqual([
      [255, 127, 127, 255],
      [230, 102, 102, 255],
    ]);
  });

  it('weights samples by alpha, so transparent colours do not bleed in', () => {
    const pixels = createPixelBuffer(2, 1);
    setPixel(pixels, 0, 0, [255, 0, 0, 255]);
    setPixel(pixels, 1, 0, [0, 255, 0, 0]);
    const out = image(1, 1);
    renderThumbnail(pixels, out, 8);
    // Half red, half light checker: R = (255 + 255) / 2, G = B = 255 / 2 = 127.5 → 128.
    expect(pixelsOf(out)).toEqual([[255, 128, 128, 255]]);
  });
});
