import { assertNever } from '../layer';

/**
 * How resampling finds values between pixel centres. Nearest neighbour copies whole
 * pixels; the others weight nearby pixels with a kernel. Adding bicubic means adding its
 * name here and its kernel to `kernelFor`: resizing and transforms take any kernel.
 */
export type Interpolation = 'nearest' | 'bilinear';

/**
 * A separable filter: the weight of a source pixel whose centre lies `distance` pixels
 * from the sample point, along one axis. Zero at `support` and beyond. Kernels with
 * negative lobes are fine; results are clamped to 0–255.
 */
export interface Kernel {
  readonly support: number;
  weight(distance: number): number;
}

/** Bilinear interpolation's kernel: weights fall linearly to zero one pixel away. */
const TRIANGLE: Kernel = {
  support: 1,
  weight: (distance) => Math.max(0, 1 - Math.abs(distance)),
};

/** The kernel for `interpolation`, or null for nearest neighbour. */
export function kernelFor(interpolation: Interpolation): Kernel | null {
  switch (interpolation) {
    case 'nearest':
      return null;
    case 'bilinear':
      return TRIANGLE;
    default:
      return assertNever(interpolation);
  }
}

/**
 * Writes one straight-alpha RGBA pixel at `o` from premultiplied sums: `alpha` = Σw·a and
 * `red`, `green`, `blue` = Σw·a·c, with the weights w summing to 1. Alpha rounds to the
 * nearest level, and colour is the alpha-weighted mean, so transparent pixels lend no colour
 * and edges next to them never darken. Leaves a fully transparent result as it is: `out`
 * must be zeroed. Overshoot from kernels with negative lobes is clamped.
 */
export function storePremultiplied(
  out: Uint8Array | Uint8ClampedArray,
  o: number,
  alpha: number,
  red: number,
  green: number,
  blue: number,
): void {
  const a = toByte(alpha);
  if (a === 0) return;
  out[o] = toByte(red / alpha);
  out[o + 1] = toByte(green / alpha);
  out[o + 2] = toByte(blue / alpha);
  out[o + 3] = a;
}

/**
 * `value` rounded to the nearest whole number (halves up) and clamped to 0–255. Assigning
 * to a Uint8ClampedArray would round halves to even, and a Uint8Array would wrap.
 */
export function toByte(value: number): number {
  return value <= 0 ? 0 : value >= 255 ? 255 : Math.round(value);
}
