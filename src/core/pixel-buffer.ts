import type { Rect } from './geometry';
import { intersectRects } from './geometry';

/** 8-bit sRGB color with straight (non-premultiplied) alpha, each channel 0–255. */
export type Rgba = readonly [r: number, g: number, b: number, a: number];

export const TRANSPARENT: Rgba = [0, 0, 0, 0];

/**
 * A block of RGBA pixels: 8 bits per channel, sRGB, straight alpha, row-major,
 * no row padding. `data` is a Uint8ClampedArray so it can back an ImageData directly.
 */
export interface PixelBuffer {
  readonly width: number;
  readonly height: number;
  readonly data: Uint8ClampedArray<ArrayBuffer>;
}

export function createPixelBuffer(width: number, height: number): PixelBuffer {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 0 || height < 0) {
    throw new RangeError(`Invalid pixel buffer size ${width}x${height}`);
  }
  return { width, height, data: new Uint8ClampedArray(width * height * 4) };
}

export function clonePixelBuffer(buffer: PixelBuffer): PixelBuffer {
  return { width: buffer.width, height: buffer.height, data: buffer.data.slice() };
}

export function getPixel(buffer: PixelBuffer, x: number, y: number): Rgba {
  if (x < 0 || y < 0 || x >= buffer.width || y >= buffer.height) return TRANSPARENT;
  const i = (y * buffer.width + x) * 4;
  const d = buffer.data;
  return [d[i], d[i + 1], d[i + 2], d[i + 3]];
}

export function setPixel(buffer: PixelBuffer, x: number, y: number, color: Rgba): void {
  if (x < 0 || y < 0 || x >= buffer.width || y >= buffer.height) return;
  buffer.data.set(color, (y * buffer.width + x) * 4);
}

/** Fills `area` (clipped to the buffer) with `color`. Replaces pixels; does not blend. */
export function fillRect(buffer: PixelBuffer, area: Rect, color: Rgba): void {
  const clipped = intersectRects(area, { x: 0, y: 0, width: buffer.width, height: buffer.height });
  if (!clipped) return;
  const [r, g, b, a] = color;
  const d = buffer.data;
  for (let y = clipped.y; y < clipped.y + clipped.height; y++) {
    let i = (y * buffer.width + clipped.x) * 4;
    for (let x = 0; x < clipped.width; x++, i += 4) {
      d[i] = r;
      d[i + 1] = g;
      d[i + 2] = b;
      d[i + 3] = a;
    }
  }
}

/**
 * Composites `buffer` in place over an opaque colour (Normal blend), leaving every pixel
 * opaque. Used for formats without alpha, such as JPEG.
 */
export function flattenOnto(buffer: PixelBuffer, [r, g, b]: readonly [number, number, number]) {
  const d = buffer.data;
  for (let i = 0; i < d.length; i += 4) {
    const a = d[i + 3];
    if (a === 255) continue;
    const inverse = 255 - a;
    // Uint8ClampedArray rounds the result to the nearest integer.
    d[i] = (d[i] * a + r * inverse) / 255;
    d[i + 1] = (d[i + 1] * a + g * inverse) / 255;
    d[i + 2] = (d[i + 2] * a + b * inverse) / 255;
    d[i + 3] = 255;
  }
}
