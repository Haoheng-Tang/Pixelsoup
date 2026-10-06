import { describe, expect, it } from 'vitest';
import { createPixelBuffer, flattenOnto, getPixel, setPixel } from './pixel-buffer';

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
