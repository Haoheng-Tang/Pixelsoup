import type { PixelBuffer } from '../pixel-buffer';
import { clonePixelBuffer, createPixelBuffer } from '../pixel-buffer';
import type { Interpolation, Kernel } from './kernels';
import { kernelFor, storePremultiplied } from './kernels';

/**
 * `source` resampled to `width` × `height`, as a new buffer. Pixel centres line up with the
 * scaled source: output pixel i samples the source at (i + 0.5) · in / out. Shrinking
 * stretches the kernel by the reduction factor, so every source pixel contributes rather
 * than some being skipped. Kernels are cut at the source's edges and their weights
 * renormalised, so edge pixels keep their opacity. Interpolation runs on premultiplied
 * values: see `storePremultiplied`.
 */
export function resizePixels(
  source: PixelBuffer,
  width: number,
  height: number,
  interpolation: Interpolation,
): PixelBuffer {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1) {
    throw new RangeError(`Invalid size ${width}x${height}`);
  }
  if (source.width < 1 || source.height < 1) throw new RangeError('Nothing to resize');
  if (width === source.width && height === source.height) return clonePixelBuffer(source);
  const out = createPixelBuffer(width, height);
  const kernel = kernelFor(interpolation);
  if (kernel) resizeFiltered(source, out, kernel);
  else resizeNearest(source, out);
  return out;
}

/** Each output pixel copies the source pixel its centre falls in. */
function resizeNearest(source: PixelBuffer, out: PixelBuffer): void {
  const xs = nearestIndices(source.width, out.width);
  const ys = nearestIndices(source.height, out.height);
  const src = source.data;
  const dst = out.data;
  let o = 0;
  for (let y = 0; y < out.height; y++) {
    const row = ys[y] * source.width;
    for (let x = 0; x < out.width; x++, o += 4) {
      const i = (row + xs[x]) * 4;
      dst[o] = src[i];
      dst[o + 1] = src[i + 1];
      dst[o + 2] = src[i + 2];
      dst[o + 3] = src[i + 3];
    }
  }
}

/** floor((i + 0.5) · in / out) for each output index, in integers so it's exact. */
function nearestIndices(inSize: number, outSize: number): Int32Array {
  const indices = new Int32Array(outSize);
  for (let i = 0; i < outSize; i++) indices[i] = Math.floor(((2 * i + 1) * inSize) / (2 * outSize));
  return indices;
}

/** The source pixels and normalised weights each output index draws on, along one axis. */
interface AxisTaps {
  readonly first: Int32Array;
  readonly count: Int32Array;
  /** `stride` slots per output index. */
  readonly weights: Float64Array;
  readonly stride: number;
}

function axisTaps(inSize: number, outSize: number, kernel: Kernel): AxisTaps {
  const stretch = Math.max(1, inSize / outSize);
  const radius = kernel.support * stretch;
  const stride = 2 * Math.ceil(radius) + 1;
  const first = new Int32Array(outSize);
  const count = new Int32Array(outSize);
  const weights = new Float64Array(outSize * stride);
  for (let i = 0; i < outSize; i++) {
    // The sample point, in source coordinates where pixel j's centre is at j.
    const centre = ((i + 0.5) * inSize) / outSize - 0.5;
    const lo = Math.max(0, Math.ceil(centre - radius));
    const hi = Math.min(inSize - 1, Math.floor(centre + radius));
    let start = -1;
    let n = 0;
    let total = 0;
    for (let j = lo; j <= hi; j++) {
      const w = kernel.weight((j - centre) / stretch);
      if (w === 0 && start < 0) continue;
      if (start < 0) start = j;
      weights[i * stride + n++] = w;
      total += w;
    }
    while (n > 0 && weights[i * stride + n - 1] === 0) n--;
    if (n === 0 || total === 0) {
      // Unreachable for kernels positive near zero; fall back to the nearest pixel.
      start = Math.min(inSize - 1, Math.max(0, Math.round(centre)));
      n = 1;
      weights[i * stride] = total = 1;
    }
    for (let k = 0; k < n; k++) weights[i * stride + k] /= total;
    first[i] = start;
    count[i] = n;
  }
  return { first, count, weights, stride };
}

function resizeFiltered(source: PixelBuffer, out: PixelBuffer, kernel: Kernel): void {
  const xs = axisTaps(source.width, out.width, kernel);
  const ys = axisTaps(source.height, out.height, kernel);
  const src = source.data;
  const dst = out.data;
  const sw = source.width;
  let o = 0;
  for (let y = 0; y < out.height; y++) {
    const y0 = ys.first[y];
    const yn = ys.count[y];
    const yw = y * ys.stride;
    for (let x = 0; x < out.width; x++, o += 4) {
      const x0 = xs.first[x];
      const xn = xs.count[x];
      const xw = x * xs.stride;
      let a = 0;
      let r = 0;
      let g = 0;
      let b = 0;
      for (let j = 0; j < yn; j++) {
        const wy = ys.weights[yw + j];
        let i = ((y0 + j) * sw + x0) * 4;
        for (let k = 0; k < xn; k++, i += 4) {
          const wa = wy * xs.weights[xw + k] * src[i + 3];
          a += wa;
          r += wa * src[i];
          g += wa * src[i + 1];
          b += wa * src[i + 2];
        }
      }
      storePremultiplied(dst, o, a, r, g, b);
    }
  }
}
