import { describe, expect, it } from 'vitest';
import {
  copyPixels,
  createPixelBuffer,
  flattenOnto,
  getPixel,
  pastePixels,
  setPixel,
} from './pixel-buffer';

describe('copyPixels and pastePixels', () => {
  it('copy a rect out of a buffer and paste a buffer into another at a position', () => {
    const buffer = createPixelBuffer(4, 3);
    for (let i = 0; i < 12; i++) buffer.data.set([i, 0, 0, 255], i * 4);
    const part = copyPixels(buffer, { x: 1, y: 1, width: 2, height: 2 });
    expect([part.width, part.height]).toEqual([2, 2]);
    expect([0, 1, 2, 3].map((i) => part.data[i * 4])).toEqual([5, 6, 9, 10]);

    const target = createPixelBuffer(3, 3);
    pastePixels(target, part, 1, 0);
    expect(Array.from({ length: 9 }, (_, i) => target.data[i * 4 + 3])).toEqual([
      0, 255, 255, 0, 255, 255, 0, 0, 0,
    ]);
    expect(getPixel(target, 2, 1)).toEqual([10, 0, 0, 255]);
  });
});

describe('flattenOnto', () => {
  it('blends translucent pixels over the colour and makes everything opaque', () => {
    const buffer = createPixelBuffer(3, 1);
    setPixel(buffer, 0, 0, [10, 20, 30, 255]);
    setPixel(buffer, 1, 0, [99, 99, 99, 0]);
    setPixel(buffer, 2, 0, [200, 0, 100, 128]);
    flattenOnto(buffer, [255, 255, 255]);
    expect(getPixel(buffer, 0, 0)).toEqual([10, 20, 30, 255]);
    expect(getPixel(buffer, 1, 0)).toEqual([255, 255, 255, 255]);
    // (c·128 + 255·127) / 255: 57985/255 = 227.4, 32385/255 = 127, 45185/255 = 177.2.
    expect(getPixel(buffer, 2, 0)).toEqual([227, 127, 177, 255]);
  });

  it('uses the given colour', () => {
    const buffer = createPixelBuffer(1, 1);
    setPixel(buffer, 0, 0, [200, 0, 100, 128]);
    flattenOnto(buffer, [0, 0, 0]);
    // c·128 / 255: 25600/255 = 100.4, 12800/255 = 50.2.
    expect(getPixel(buffer, 0, 0)).toEqual([100, 0, 50, 255]);
  });
});
