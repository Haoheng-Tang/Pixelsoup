/**
 * Exact integer math for painting into straight-alpha RGBA8 pixels.
 *
 * Each pixel is painted with a weight `w` out of FULL_WEIGHT: the product of the stroke's
 * mask (0–255), the selection's coverage there (0–255, 255 without a selection) and the
 * stroke's opacity in OPACITY_STEPS. Every value stays well below 2^53, so the arithmetic
 * is exact in doubles and each result is correctly rounded (halves up).
 */

/** Stroke opacity is applied in steps of 1 / OPACITY_STEPS. */
export const OPACITY_STEPS = 10000;

/** The weight of a fully painted pixel. */
export const FULL_WEIGHT = 255 * 255 * OPACITY_STEPS;

/** Stroke opacity (0–1) in whole OPACITY_STEPS. */
export function opacitySteps(opacity: number): number {
  return Math.round(Math.min(Math.max(opacity, 0), 1) * OPACITY_STEPS);
}

/**
 * Paints the opaque colour (r, g, b) with weight w over the pixel at `src[j]`, writing the
 * result to `out[i]`: the "over" operator in straight alpha. With p = w / FULL_WEIGHT,
 * alpha becomes 255p + a(1 − p) and each channel (255p·C + a(1 − p)·c) / that alpha.
 */
export function paintPixel(
  out: Uint8ClampedArray,
  i: number,
  src: Uint8ClampedArray,
  j: number,
  r: number,
  g: number,
  b: number,
  w: number,
): void {
  const keep = src[j + 3] * (FULL_WEIGHT - w);
  const paint = 255 * w;
  // Alpha × FULL_WEIGHT, and the channels × alpha × FULL_WEIGHT.
  const alpha = paint + keep;
  const a = Math.floor((2 * alpha + FULL_WEIGHT) / (2 * FULL_WEIGHT));
  if (a === 0) {
    out[i] = src[j];
    out[i + 1] = src[j + 1];
    out[i + 2] = src[j + 2];
    out[i + 3] = 0;
    return;
  }
  const twice = 2 * alpha;
  out[i] = Math.floor((2 * (r * paint + src[j] * keep) + alpha) / twice);
  out[i + 1] = Math.floor((2 * (g * paint + src[j + 1] * keep) + alpha) / twice);
  out[i + 2] = Math.floor((2 * (b * paint + src[j + 2] * keep) + alpha) / twice);
  out[i + 3] = a;
}

/**
 * Erases the pixel at `src[j]` with weight w, writing the result to `out[i]`: alpha
 * becomes a(1 − w / FULL_WEIGHT), the colour stays, and a pixel left with no alpha
 * becomes transparent black.
 */
export function erasePixel(
  out: Uint8ClampedArray,
  i: number,
  src: Uint8ClampedArray,
  j: number,
  w: number,
): void {
  const a = Math.floor((2 * src[j + 3] * (FULL_WEIGHT - w) + FULL_WEIGHT) / (2 * FULL_WEIGHT));
  if (a === 0) {
    out[i] = out[i + 1] = out[i + 2] = out[i + 3] = 0;
    return;
  }
  out[i] = src[j];
  out[i + 1] = src[j + 1];
  out[i + 2] = src[j + 2];
  out[i + 3] = a;
}
