import type { Rect } from '../geometry';
import { intersectRects } from '../geometry';
import type { PixelBuffer } from '../pixel-buffer';
import { createPixelBuffer } from '../pixel-buffer';
import type { Affine } from './affine';
import { invert, transformedBounds } from './affine';
import type { Interpolation, Kernel } from './kernels';
import { kernelFor, storePremultiplied, toByte } from './kernels';

/** Pixels produced by a transform, with the document position of their top-left pixel. */
export interface TransformedPixels {
  readonly pixels: PixelBuffer;
  readonly x: number;
  readonly y: number;
}

/**
 * `source` mapped through `m`, where `m` maps the source's pixel-edge coordinates (pixel
 * (0, 0) spans [0, 1) × [0, 1)) to the output's. The output covers the transformed
 * corners' whole-pixel bounds, cut to `clip` when given. Each output pixel samples the
 * source at its centre mapped back through `m`; outside the source counts as transparent,
 * so edges are anti-aliased against nothing rather than smeared. Interpolation runs on
 * premultiplied values, so transparent pixels lend no colour. Null when `m` is singular or
 * nothing is left inside `clip`.
 */
export function transformPixels(
  source: PixelBuffer,
  m: Affine,
  interpolation: Interpolation,
  clip?: Rect,
): TransformedPixels | null {
  const sampler = Sampler.create(source.width, source.height, m, interpolation, clip);
  if (!sampler) return null;
  const { area } = sampler;
  const pixels = createPixelBuffer(area.width, area.height);
  sampler.run(source.data, pixels.data, 4);
  return { pixels, x: area.x, y: area.y };
}

/** A transformed 8-bit mask (a selection's coverage): one byte per pixel, row by row. */
export interface TransformedMask {
  readonly data: Uint8ClampedArray<ArrayBuffer>;
  /** Where `data` lies, in the output's coordinates. */
  readonly area: Rect;
}

/**
 * A `width` × `height` coverage mask mapped through `m`, as `transformPixels` maps pixels:
 * coverage is interpolated directly, with outside the mask counting as 0. Null when `m` is
 * singular or nothing is left inside `clip`.
 */
export function transformMask(
  mask: Uint8Array | Uint8ClampedArray,
  width: number,
  height: number,
  m: Affine,
  interpolation: Interpolation,
  clip?: Rect,
): TransformedMask | null {
  if (mask.length !== width * height) throw new RangeError('Mask size mismatch');
  const sampler = Sampler.create(width, height, m, interpolation, clip);
  if (!sampler) return null;
  const { area } = sampler;
  const data = new Uint8ClampedArray(area.width * area.height);
  sampler.run(mask, data, 1);
  return { data, area };
}

/** Ties land on the higher pixel, as in `resizePixels`, despite rounding noise. */
const NEAREST_EPSILON = 1e-9;

/**
 * Maps each output pixel's centre back into a `width` × `height` source through the
 * inverse transform and filters what it lands on: with nearest neighbour, the pixel it falls
 * in; with a kernel, every pixel within its support, stretched by how much the transform
 * shrinks so that shrinking anti-aliases. Kernel weights are normalised over all their
 * taps, inside the source or not, so the outside counts as transparent.
 */
class Sampler {
  static create(
    width: number,
    height: number,
    m: Affine,
    interpolation: Interpolation,
    clip: Rect | undefined,
  ): Sampler | null {
    if (width < 1 || height < 1) return null;
    const inverse = invert(m);
    if (!inverse) return null;
    const bounds = transformedBounds(m, { x: 0, y: 0, width, height });
    const area = clip ? intersectRects(bounds, clip) : bounds;
    if (!area || area.width < 1 || area.height < 1) return null;
    return new Sampler(width, height, inverse, kernelFor(interpolation), area);
  }

  private constructor(
    private readonly width: number,
    private readonly height: number,
    private readonly inverse: Affine,
    private readonly kernel: Kernel | null,
    /** The output's document rect. */
    readonly area: Rect,
  ) {}

  /**
   * Fills `out` (the area's pixels, zeroed) from `source`, `channels` bytes a pixel: 4 for
   * straight-alpha RGBA, interpolated premultiplied, or 1 for coverage.
   */
  run(
    source: Uint8Array | Uint8ClampedArray,
    out: Uint8Array | Uint8ClampedArray,
    channels: 1 | 4,
  ): void {
    if (this.kernel) this.filter(this.kernel, source, out, channels);
    else this.nearest(source, out, channels);
  }

  private nearest(
    source: Uint8Array | Uint8ClampedArray,
    out: Uint8Array | Uint8ClampedArray,
    channels: 1 | 4,
  ): void {
    const { width, height, area } = this;
    const [a, b, c, d, e, f] = this.inverse;
    let o = 0;
    for (let y = 0; y < area.height; y++) {
      const oy = area.y + y + 0.5;
      const rowX = c * oy + e + NEAREST_EPSILON;
      const rowY = d * oy + f + NEAREST_EPSILON;
      for (let x = 0; x < area.width; x++, o += channels) {
        const ox = area.x + x + 0.5;
        const sx = Math.floor(a * ox + rowX);
        const sy = Math.floor(b * ox + rowY);
        if (sx < 0 || sy < 0 || sx >= width || sy >= height) continue;
        const i = (sy * width + sx) * channels;
        for (let k = 0; k < channels; k++) out[o + k] = source[i + k];
      }
    }
  }

  private filter(
    kernel: Kernel,
    source: Uint8Array | Uint8ClampedArray,
    out: Uint8Array | Uint8ClampedArray,
    channels: 1 | 4,
  ): void {
    const { width, height, area } = this;
    const [a, b, c, d, e, f] = this.inverse;
    // How many source pixels one output pixel spans along each source axis, at least 1.
    const stretchX = Math.max(1, Math.hypot(a, c));
    const stretchY = Math.max(1, Math.hypot(b, d));
    const radiusX = kernel.support * stretchX;
    const radiusY = kernel.support * stretchY;
    const weightsX = new Float64Array(2 * Math.ceil(radiusX) + 2);
    const weightsY = new Float64Array(2 * Math.ceil(radiusY) + 2);
    let o = 0;
    for (let y = 0; y < area.height; y++) {
      const oy = area.y + y + 0.5;
      // Shifted by half a pixel, so that source pixel j's centre is at j.
      const rowX = c * oy + e - 0.5;
      const rowY = d * oy + f - 0.5;
      for (let x = 0; x < area.width; x++, o += channels) {
        const ox = area.x + x + 0.5;
        const cx = a * ox + rowX;
        const cy = b * ox + rowY;
        const x0 = Math.ceil(cx - radiusX);
        const y0 = Math.ceil(cy - radiusY);
        const xn = Math.floor(cx + radiusX) - x0 + 1;
        const yn = Math.floor(cy + radiusY) - y0 + 1;
        if (x0 >= width || y0 >= height || x0 + xn <= 0 || y0 + yn <= 0) continue;
        let totalX = 0;
        for (let k = 0; k < xn; k++) {
          const w = kernel.weight((x0 + k - cx) / stretchX);
          weightsX[k] = w;
          totalX += w;
        }
        let totalY = 0;
        for (let k = 0; k < yn; k++) {
          const w = kernel.weight((y0 + k - cy) / stretchY);
          weightsY[k] = w;
          totalY += w;
        }
        const total = totalX * totalY;
        if (!(total > 0)) continue;
        // The taps inside the source.
        const kx0 = Math.max(0, -x0);
        const kx1 = Math.min(xn, width - x0);
        const ky0 = Math.max(0, -y0);
        const ky1 = Math.min(yn, height - y0);
        if (channels === 1) {
          let sum = 0;
          for (let ky = ky0; ky < ky1; ky++) {
            const wy = weightsY[ky];
            let i = (y0 + ky) * width + x0 + kx0;
            for (let kx = kx0; kx < kx1; kx++, i++) sum += wy * weightsX[kx] * source[i];
          }
          out[o] = toByte(sum / total);
          continue;
        }
        let sa = 0;
        let sr = 0;
        let sg = 0;
        let sb = 0;
        for (let ky = ky0; ky < ky1; ky++) {
          const wy = weightsY[ky];
          let i = ((y0 + ky) * width + x0 + kx0) * 4;
          for (let kx = kx0; kx < kx1; kx++, i += 4) {
            const wa = wy * weightsX[kx] * source[i + 3];
            sa += wa;
            sr += wa * source[i];
            sg += wa * source[i + 1];
            sb += wa * source[i + 2];
          }
        }
        storePremultiplied(out, o, sa / total, sr / total, sg / total, sb / total);
      }
    }
  }
}
