import type { Rect } from './geometry';
import { assertNever } from './layer';

/**
 * A lossless change of orientation: a quarter or half turn, or a mirror image. Each one
 * moves pixels without resampling them, so applying one and then its inverse gives back
 * exactly the pixels it started with.
 */
export type Orientation =
  'rotate-cw' | 'rotate-ccw' | 'rotate-180' | 'flip-horizontal' | 'flip-vertical';

/** The orientation that undoes `orientation`. */
export function inverseOrientation(orientation: Orientation): Orientation {
  switch (orientation) {
    case 'rotate-cw':
      return 'rotate-ccw';
    case 'rotate-ccw':
      return 'rotate-cw';
    case 'rotate-180':
    case 'flip-horizontal':
    case 'flip-vertical':
      return orientation;
    default:
      return assertNever(orientation);
  }
}

/** True for the quarter turns, which swap width and height. */
export function swapsSize(orientation: Orientation): boolean {
  return orientation === 'rotate-cw' || orientation === 'rotate-ccw';
}

/** The size of a `width` × `height` image after `orientation`. */
export function orientedSize(
  orientation: Orientation,
  width: number,
  height: number,
): { width: number; height: number } {
  return swapsSize(orientation) ? { width: height, height: width } : { width, height };
}

/**
 * Where `area` on a `canvasWidth` × `canvasHeight` canvas ends up when the canvas is
 * re-oriented. A clockwise turn takes the canvas's top-left pixel to the top-right.
 */
export function orientRect(
  orientation: Orientation,
  area: Rect,
  canvasWidth: number,
  canvasHeight: number,
): Rect {
  const { x, y, width, height } = area;
  switch (orientation) {
    case 'rotate-cw':
      return { x: canvasHeight - y - height, y: x, width: height, height: width };
    case 'rotate-ccw':
      return { x: y, y: canvasWidth - x - width, width: height, height: width };
    case 'rotate-180':
      return { x: canvasWidth - x - width, y: canvasHeight - y - height, width, height };
    case 'flip-horizontal':
      return { x: canvasWidth - x - width, y, width, height };
    case 'flip-vertical':
      return { x, y: canvasHeight - y - height, width, height };
    default:
      return assertNever(orientation);
  }
}

/**
 * A re-oriented copy of a `width` × `height` image stored row-major with `channels` bytes
 * per pixel (4 for RGBA, 1 for a mask).
 */
export function orientPixels(
  orientation: Orientation,
  source: Uint8ClampedArray,
  width: number,
  height: number,
  channels: number,
): Uint8ClampedArray<ArrayBuffer> {
  const length = width * height;
  if (source.length !== length * channels) {
    throw new RangeError(`Expected ${length * channels} bytes, got ${source.length}`);
  }
  const out = new Uint8ClampedArray(source.length);
  if (length === 0) return out;
  const { width: outWidth, height: outHeight } = orientedSize(orientation, width, height);
  // The output is written in order; the source pixel for output (u, v) is
  // start + u·stepU + v·stepV, in pixels.
  let start: number;
  let stepU: number;
  let stepV: number;
  switch (orientation) {
    case 'rotate-cw': // output (u, v) is source (v, h − 1 − u)
      [start, stepU, stepV] = [(height - 1) * width, -width, 1];
      break;
    case 'rotate-ccw': // source (w − 1 − v, u)
      [start, stepU, stepV] = [width - 1, width, -1];
      break;
    case 'rotate-180': // source (w − 1 − u, h − 1 − v)
      [start, stepU, stepV] = [length - 1, -1, -width];
      break;
    case 'flip-horizontal': // source (w − 1 − u, v)
      [start, stepU, stepV] = [width - 1, -1, width];
      break;
    case 'flip-vertical': // source (u, h − 1 − v)
      [start, stepU, stepV] = [(height - 1) * width, 1, -width];
      break;
    default:
      return assertNever(orientation);
  }
  if (channels === 4 && source.byteOffset % 4 === 0) {
    // One 32-bit word per pixel moves all four channels at once.
    const from = new Uint32Array(source.buffer, source.byteOffset, length);
    const to = new Uint32Array(out.buffer, 0, length);
    remap(from, to, outWidth, outHeight, start, stepU, stepV);
  } else if (channels === 1) {
    remap(source, out, outWidth, outHeight, start, stepU, stepV);
  } else {
    let o = 0;
    for (let v = 0; v < outHeight; v++) {
      let s = start + v * stepV;
      for (let u = 0; u < outWidth; u++, s += stepU) {
        for (let c = 0; c < channels; c++) out[o++] = source[s * channels + c];
      }
    }
  }
  return out;
}

/** Writes `to` in order from `from`, one element per pixel. */
function remap(
  from: Uint8ClampedArray | Uint32Array,
  to: Uint8ClampedArray | Uint32Array,
  outWidth: number,
  outHeight: number,
  start: number,
  stepU: number,
  stepV: number,
): void {
  let o = 0;
  for (let v = 0; v < outHeight; v++) {
    let s = start + v * stepV;
    for (let u = 0; u < outWidth; u++, s += stepU) to[o++] = from[s];
  }
}
