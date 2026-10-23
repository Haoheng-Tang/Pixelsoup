import type { Rect } from '../geometry';
import { intersectRects } from '../geometry';
import type { PixelBuffer } from '../pixel-buffer';
import { createPixelBuffer } from '../pixel-buffer';
import type { Affine } from './affine';
import { invert, transformedBounds } from './affine';
import type { Interpolation, Kernel } from './kernels';
import { kernelFor, storePremultiplied, toByte } from './kernels';
import type { Projective } from './projective';
import { invertProjective, isProjective, mappedBounds, projectPoint, toAffine } from './projective';

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
 * premultiplied values, so transparent pixels lend no colour. A projective `m` maps back
 * with the perspective divide; one that is affine (`isAffine`) gives exactly the bytes its
 * `Affine` would. Null when `m` is singular, takes part of the source past its horizon, or
 * nothing is left inside `clip`.
 */
export function transformPixels(
  source: PixelBuffer,
  m: Affine | Projective,
  interpolation: Interpolation,
  clip?: Rect,
): TransformedPixels | null {
  const sampler = createSampler(source.width, source.height, m, interpolation, clip);
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
 * singular, takes part of the mask past its horizon, or nothing is left inside `clip`.
 */
export function transformMask(
  mask: Uint8Array | Uint8ClampedArray,
  width: number,
  height: number,
  m: Affine | Projective,
  interpolation: Interpolation,
  clip?: Rect,
): TransformedMask | null {
  if (mask.length !== width * height) throw new RangeError('Mask size mismatch');
  const sampler = createSampler(width, height, m, interpolation, clip);
  if (!sampler) return null;
  const { area } = sampler;
  const data = new Uint8ClampedArray(area.width * area.height);
  sampler.run(mask, data, 1);
  return { data, area };
}

/** Ties land on the higher pixel, as in `resizePixels`, despite rounding noise. */
const NEAREST_EPSILON = 1e-9;

/**
 * A projective sampler steps its homogeneous coordinates along each row, restarting them
 * at output columns that are multiples of this. So each output pixel's sample point
 * depends on where it is, not on where the output starts: an output cut to a clip rect
 * matches the same pixels uncut, and a selection's mask stays aligned with its pixels.
 * Restarting also keeps rounding from building up along long rows.
 */
const ANCHOR_SPACING = 64;

/**
 * Maps each output pixel's centre back into a `width` × `height` source through the
 * inverse transform and filters what it lands on: with nearest neighbour, the pixel it falls
 * in; with a kernel, every pixel within its support, stretched by how much the transform
 * shrinks so that shrinking anti-aliases. Kernel weights are normalised over all their
 * taps, inside the source or not, so the outside counts as transparent.
 */
interface Sampler {
  /** The output's document rect. */
  readonly area: Rect;
  /**
   * Fills `out` (the area's pixels, zeroed) from `source`, `channels` bytes a pixel: 4 for
   * straight-alpha RGBA, interpolated premultiplied, or 1 for coverage.
   */
  run(
    source: Uint8Array | Uint8ClampedArray,
    out: Uint8Array | Uint8ClampedArray,
    channels: 1 | 4,
  ): void;
}

function createSampler(
  width: number,
  height: number,
  m: Affine | Projective,
  interpolation: Interpolation,
  clip: Rect | undefined,
): Sampler | null {
  if (width < 1 || height < 1) return null;
  const affine = toAffine(m);
  if (affine) return AffineSampler.create(width, height, affine, interpolation, clip);
  return isProjective(m) ? ProjectiveSampler.create(width, height, m, interpolation, clip) : null;
}

/** A `Sampler` for affine transforms, under which a kernel stretches the same everywhere. */
class AffineSampler implements Sampler {
  static create(
    width: number,
    height: number,
    m: Affine,
    interpolation: Interpolation,
    clip: Rect | undefined,
  ): AffineSampler | null {
    const inverse = invert(m);
    if (!inverse) return null;
    const bounds = transformedBounds(m, { x: 0, y: 0, width, height });
    const area = clip ? intersectRects(bounds, clip) : bounds;
    if (!area || area.width < 1 || area.height < 1) return null;
    return new AffineSampler(width, height, inverse, kernelFor(interpolation), area);
  }

  private constructor(
    private readonly width: number,
    private readonly height: number,
    private readonly inverse: Affine,
    private readonly kernel: Kernel | null,
    readonly area: Rect,
  ) {}

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

/**
 * A `Sampler` for projective transforms. Each output pixel's centre goes back through the
 * inverse with the perspective divide: its homogeneous coordinates step along each row by
 * the inverse's first column (restarting every `ANCHOR_SPACING` pixels), so a pixel costs
 * three additions and a division before filtering. A kernel stretches by how much the
 * transform shrinks at that pixel (from the inverse's derivatives there), so a
 * perspective's far side anti-aliases as a shrink does. Output pixels whose centres map
 * back past the horizon (w ≤ 0) stay transparent.
 */
class ProjectiveSampler implements Sampler {
  static create(
    width: number,
    height: number,
    m: Projective,
    interpolation: Interpolation,
    clip: Rect | undefined,
  ): ProjectiveSampler | null {
    const bounds = mappedBounds(m, { x: 0, y: 0, width, height });
    const inverse = invertProjective(m);
    if (!bounds || !inverse) return null;
    const area = clip ? intersectRects(bounds, clip) : bounds;
    if (!area || area.width < 1 || area.height < 1) return null;
    // m has w of one sign all over the source (or no bounds), which is m[8]'s, at its
    // corner (0, 0). Where m's w is positive, its exact inverse's is too.
    const positive = m[8] > 0 ? inverse : negated(inverse);
    const kernel = kernelFor(interpolation);
    const limits = kernel ? stretchLimits(m, positive, width, height) : { x: 1, y: 1 };
    return new ProjectiveSampler(width, height, positive, kernel, area, limits.x, limits.y);
  }

  private constructor(
    private readonly width: number,
    private readonly height: number,
    /** Gives w > 0 at every output point that some source point maps to. */
    private readonly inverse: Projective,
    private readonly kernel: Kernel | null,
    readonly area: Rect,
    /** The most a kernel stretches along each source axis. */
    private readonly limitX: number,
    private readonly limitY: number,
  ) {}

  /** Scratch for `anchor`: homogeneous coordinates x, y and w. */
  private readonly start = new Float64Array(3);

  /**
   * Sets `start` to the homogeneous coordinates of output pixel `column`'s centre, in the
   * row whose centre is at `oy`, stepped from the anchor at or before it (`ANCHOR_SPACING`),
   * and returns how many pixels on the next anchor is.
   */
  private anchor(column: number, oy: number): number {
    const [p0, p1, p2, p3, p4, p5, p6, p7, p8] = this.inverse;
    const from = Math.floor(column / ANCHOR_SPACING) * ANCHOR_SPACING;
    let hx = p0 * (from + 0.5) + p1 * oy + p2;
    let hy = p3 * (from + 0.5) + p4 * oy + p5;
    let hw = p6 * (from + 0.5) + p7 * oy + p8;
    for (let k = from; k < column; k++) {
      hx += p0;
      hy += p3;
      hw += p6;
    }
    this.start[0] = hx;
    this.start[1] = hy;
    this.start[2] = hw;
    return from + ANCHOR_SPACING - column;
  }

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
    const { width, height, area, start } = this;
    const [p0, , , p3, , , p6] = this.inverse;
    let o = 0;
    for (let y = 0; y < area.height; y++) {
      const oy = area.y + y + 0.5;
      let hx = 0;
      let hy = 0;
      let hw = 0;
      let untilAnchor = 0;
      for (
        let x = 0;
        x < area.width;
        x++, o += channels, hx += p0, hy += p3, hw += p6, untilAnchor--
      ) {
        if (untilAnchor === 0) {
          untilAnchor = this.anchor(area.x + x, oy);
          hx = start[0];
          hy = start[1];
          hw = start[2];
        }
        if (!(hw > 0)) continue;
        const sx = Math.floor(hx / hw + NEAREST_EPSILON);
        const sy = Math.floor(hy / hw + NEAREST_EPSILON);
        if (!(sx >= 0 && sy >= 0 && sx < width && sy < height)) continue;
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
    const { width, height, area, limitX, limitY, start } = this;
    const [p0, p1, , p3, p4, , p6, p7] = this.inverse;
    // A sample point further than this from the source reaches none of it.
    const reachX = kernel.support * limitX;
    const reachY = kernel.support * limitY;
    const weightsX = new Float64Array(2 * Math.ceil(reachX) + 2);
    const weightsY = new Float64Array(2 * Math.ceil(reachY) + 2);
    let o = 0;
    for (let y = 0; y < area.height; y++) {
      const oy = area.y + y + 0.5;
      let hx = 0;
      let hy = 0;
      let hw = 0;
      let untilAnchor = 0;
      for (
        let x = 0;
        x < area.width;
        x++, o += channels, hx += p0, hy += p3, hw += p6, untilAnchor--
      ) {
        if (untilAnchor === 0) {
          untilAnchor = this.anchor(area.x + x, oy);
          hx = start[0];
          hy = start[1];
          hw = start[2];
        }
        if (!(hw > 0)) continue;
        const inverseW = 1 / hw;
        const sx = hx * inverseW;
        const sy = hy * inverseW;
        // Shifted by half a pixel, so that source pixel j's centre is at j.
        const cx = sx - 0.5;
        const cy = sy - 0.5;
        if (!(cx > -reachX && cy > -reachY && cx < width - 1 + reachX && cy < height - 1 + reachY))
          continue;
        // How far the source point moves per output pixel: the inverse's derivatives here.
        const dxx = (p0 - sx * p6) * inverseW;
        const dxy = (p1 - sx * p7) * inverseW;
        const dyx = (p3 - sy * p6) * inverseW;
        const dyy = (p4 - sy * p7) * inverseW;
        const stretchX = Math.min(limitX, Math.max(1, Math.sqrt(dxx * dxx + dxy * dxy)));
        const stretchY = Math.min(limitY, Math.max(1, Math.sqrt(dyx * dyx + dyy * dyy)));
        const radiusX = kernel.support * stretchX;
        const radiusY = kernel.support * stretchY;
        const x0 = Math.ceil(cx - radiusX);
        const y0 = Math.ceil(cy - radiusY);
        const xn = Math.floor(cx + radiusX) - x0 + 1;
        const yn = Math.floor(cy + radiusY) - y0 + 1;
        if (x0 >= width || y0 >= height || x0 + xn <= 0 || y0 + yn <= 0) continue;
        // From here on as AffineSampler.filter, with this pixel's stretch.
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

function negated(m: Projective): Projective {
  const [m0, m1, m2, m3, m4, m5, m6, m7, m8] = m;
  return [-m0, -m1, -m2, -m3, -m4, -m5, -m6, -m7, -m8];
}

/** How much more a kernel may stretch than anywhere on the source's image. */
const STRETCH_HEADROOM = 2;

/**
 * Caps on a kernel's stretch under a projective transform: a little more than the most it
 * stretches over the source's image, sampled at its corners, edge midpoints and centre.
 * Near the horizon (outside that image) the derivatives grow without bound; capped, the
 * kernels there stay small and reach none of the source, as they shouldn't.
 */
function stretchLimits(
  m: Projective,
  inverse: Projective,
  width: number,
  height: number,
): { x: number; y: number } {
  const [p0, p1, p2, p3, p4, p5, p6, p7, p8] = inverse;
  let x = 1;
  let y = 1;
  for (const u of [0, 0.5, 1]) {
    for (const v of [0, 0.5, 1]) {
      const [ox, oy] = projectPoint(m, u * width, v * height);
      const w = p6 * ox + p7 * oy + p8;
      const sx = (p0 * ox + p1 * oy + p2) / w;
      const sy = (p3 * ox + p4 * oy + p5) / w;
      x = Math.max(x, Math.hypot((p0 - sx * p6) / w, (p1 - sx * p7) / w));
      y = Math.max(y, Math.hypot((p3 - sy * p6) / w, (p4 - sy * p7) / w));
    }
  }
  return { x: STRETCH_HEADROOM * x, y: STRETCH_HEADROOM * y };
}
