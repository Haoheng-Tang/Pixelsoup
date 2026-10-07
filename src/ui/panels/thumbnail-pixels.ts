import type { PixelBuffer } from '../../core';

/** Checkerboard behind transparent thumbnail pixels: the viewport's #ffffff and #cccccc. */
const CHECKER_LIGHT = 255;
const CHECKER_DARK = 204;
/** At most this many samples per axis are averaged into one thumbnail pixel. */
const MAX_SAMPLES = 4;

export interface Size {
  readonly width: number;
  readonly height: number;
}

/** An RGBA8 image to draw into, such as an `ImageData`. */
export interface RgbaImage extends Size {
  readonly data: Uint8ClampedArray;
}

/** The largest size with the aspect ratio of `width` × `height` that fits the box, at least 1 × 1. */
export function fitSize(width: number, height: number, maxWidth: number, maxHeight: number): Size {
  const scale = Math.min(maxWidth / width, maxHeight / height);
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

/**
 * Draws `pixels` scaled to fill `out`, opaque, over a checkerboard of `checkerSize`-pixel
 * squares. Shrinking averages up to 4 × 4 evenly spread samples per output pixel, weighted
 * by alpha so the colour of transparent pixels doesn't bleed in; enlarging repeats pixels.
 */
export function renderThumbnail(pixels: PixelBuffer, out: RgbaImage, checkerSize: number): void {
  const xs = samplePositions(pixels.width, out.width);
  const ys = samplePositions(pixels.height, out.height);
  const nx = xs.length / out.width;
  const ny = ys.length / out.height;
  // Colour sums are colour × alpha, so dividing by samples × 255 gives premultiplied 0–255.
  const full = nx * ny * 255;
  const src = pixels.data;
  const dst = out.data;
  let o = 0;
  for (let oy = 0; oy < out.height; oy++) {
    const checkerRow = Math.floor(oy / checkerSize);
    for (let ox = 0; ox < out.width; ox++) {
      let a = 0;
      let r = 0;
      let g = 0;
      let b = 0;
      for (let j = 0; j < ny; j++) {
        const row = ys[oy * ny + j] * pixels.width;
        for (let i = 0; i < nx; i++) {
          const s = (row + xs[ox * nx + i]) * 4;
          const alpha = src[s + 3];
          a += alpha;
          r += src[s] * alpha;
          g += src[s + 1] * alpha;
          b += src[s + 2] * alpha;
        }
      }
      const light = (checkerRow + Math.floor(ox / checkerSize)) % 2 === 0;
      const behind = (light ? CHECKER_LIGHT : CHECKER_DARK) * (full - a);
      dst[o] = Math.round((r + behind) / full);
      dst[o + 1] = Math.round((g + behind) / full);
      dst[o + 2] = Math.round((b + behind) / full);
      dst[o + 3] = 255;
      o += 4;
    }
  }
}

/** For each of `size` output pixels, the source positions it samples, evenly spread. */
function samplePositions(source: number, size: number): Int32Array {
  const step = source / size;
  const count = Math.min(MAX_SAMPLES, Math.max(1, Math.ceil(step)));
  const positions = new Int32Array(size * count);
  for (let p = 0; p < size; p++) {
    for (let i = 0; i < count; i++) {
      positions[p * count + i] = Math.min(source - 1, Math.floor((p + (i + 0.5) / count) * step));
    }
  }
  return positions;
}
