import { isValidImageSize } from './document';
import type { Rect } from './geometry';
import { intersectRects, unionRects } from './geometry';
import { assertNever } from './layer';

/** How a new shape combines with the existing selection. */
export type SelectionMode = 'replace' | 'add' | 'subtract' | 'intersect';

/** Coverage from which a pixel counts as selected when drawing outlines: more than 50%. */
export const SELECTED_THRESHOLD = 128;

/**
 * Sub-rows sampled per pixel row when computing ellipse coverage. Coverage along each
 * sub-row is exact, so edges are anti-aliased with at least this many levels.
 */
const ELLIPSE_SUBROWS = 16;

/**
 * Which canvas pixels are selected: an 8-bit coverage mask the size of the canvas.
 * 0 = not selected, 255 = fully selected, values in between = partially selected
 * (anti-aliased or feathered edges). Row-major, one byte per canvas pixel.
 *
 * Immutable: every operation returns a selection and leaves its inputs alone, and
 * selections may share masks, so `mask` must never be written to. The bounding rect of
 * the selected pixels is computed once, when the selection is made.
 *
 * Set operations treat coverage as fuzzy membership: union is the maximum, intersection
 * the minimum, and subtraction intersects with the inverse. They are exact for hard
 * (0 or 255) masks and keep anti-aliased edges smooth.
 */
export class Selection {
  private constructor(
    readonly width: number,
    readonly height: number,
    /** Coverage (0–255) per canvas pixel, row-major. Read-only. */
    readonly mask: Uint8ClampedArray<ArrayBuffer>,
    private readonly box: Rect | null,
  ) {}

  /** Nothing selected. */
  static empty(width: number, height: number): Selection {
    assertSize(width, height);
    return new Selection(width, height, new Uint8ClampedArray(width * height), null);
  }

  /** The whole canvas selected. */
  static selectAll(width: number, height: number): Selection {
    assertSize(width, height);
    const mask = new Uint8ClampedArray(width * height).fill(255);
    return new Selection(width, height, mask, { x: 0, y: 0, width, height });
  }

  /**
   * The pixels inside `area` (document coordinates), fully selected and clipped to the
   * canvas. Edges are rounded to whole pixels; negative sizes are allowed.
   */
  static fromRect(width: number, height: number, area: Rect): Selection {
    assertSize(width, height);
    const [x0, x1] = roundedSpan(area.x, area.width, width);
    const [y0, y1] = roundedSpan(area.y, area.height, height);
    if (x1 <= x0 || y1 <= y0) return Selection.empty(width, height);
    const mask = new Uint8ClampedArray(width * height);
    for (let y = y0; y < y1; y++) mask.fill(255, y * width + x0, y * width + x1);
    return new Selection(width, height, mask, { x: x0, y: y0, width: x1 - x0, height: y1 - y0 });
  }

  /**
   * The ellipse inscribed in `area` (document coordinates, may be fractional and extend
   * past the canvas), with anti-aliased edges: each pixel's coverage is the fraction of
   * it inside the ellipse.
   */
  static fromEllipse(width: number, height: number, area: Rect): Selection {
    assertSize(width, height);
    const rx = Math.abs(area.width) / 2;
    const ry = Math.abs(area.height) / 2;
    const cx = area.x + area.width / 2;
    const cy = area.y + area.height / 2;
    if (!(rx > 0 && ry > 0) || !Number.isFinite(cx + cy + rx + ry)) {
      return Selection.empty(width, height);
    }
    const mask = new Uint8ClampedArray(width * height);
    const top = Math.max(0, Math.floor(cy - ry));
    const bottom = Math.min(height, Math.ceil(cy + ry));
    // Per-row scratch, reset after each row. `whole` is a difference array of pixels a
    // sub-row covers completely; `part` holds the partly covered pixels at span ends.
    const whole = new Float64Array(width + 1);
    const part = new Float64Array(width + 1);
    let left = width;
    let right = 0;

    for (let y = top; y < bottom; y++) {
      let lo = width;
      let hi = 0;
      for (let k = 0; k < ELLIPSE_SUBROWS; k++) {
        const dy = (y + (k + 0.5) / ELLIPSE_SUBROWS - cy) / ry;
        const t = 1 - dy * dy;
        if (t <= 0) continue;
        const half = rx * Math.sqrt(t);
        const l = Math.max(0, cx - half);
        const r = Math.min(width, cx + half);
        if (r <= l) continue;
        const il = Math.floor(l);
        const ir = Math.floor(r);
        if (il === ir) {
          part[il] += r - l;
        } else {
          part[il] += il + 1 - l;
          whole[il + 1] += 1;
          whole[ir] -= 1;
          if (ir < width) part[ir] += r - ir;
        }
        lo = Math.min(lo, il);
        hi = Math.max(hi, Math.min(width, ir + 1));
      }
      let covered = 0;
      const row = y * width;
      for (let x = lo; x < hi; x++) {
        covered += whole[x];
        // Uint8ClampedArray rounds and clamps.
        mask[row + x] = ((covered + part[x]) * 255) / ELLIPSE_SUBROWS;
        whole[x] = 0;
        part[x] = 0;
      }
      whole[hi] = 0;
      part[hi] = 0;
      left = Math.min(left, lo);
      right = Math.max(right, hi);
    }
    const scanned =
      right > left ? { x: left, y: top, width: right - left, height: bottom - top } : null;
    return new Selection(width, height, mask, scanned && scanBounds(mask, width, scanned));
  }

  /** A selection with a copy of `mask` (one coverage value per canvas pixel, row-major). */
  static fromMask(width: number, height: number, mask: ArrayLike<number>): Selection {
    assertSize(width, height);
    if (mask.length !== width * height) {
      throw new RangeError(`Mask has ${mask.length} values, expected ${width * height}`);
    }
    const copy = Uint8ClampedArray.from(mask);
    return new Selection(
      width,
      height,
      copy,
      scanBounds(copy, width, { x: 0, y: 0, width, height }),
    );
  }

  /** True if no pixel is selected at all. */
  get isEmpty(): boolean {
    return this.box === null;
  }

  /** Smallest rect containing every pixel with non-zero coverage, or null if empty. */
  bounds(): Rect | null {
    return this.box;
  }

  /** Coverage (0–255) of the pixel at (x, y); 0 outside the canvas. */
  coverageAt(x: number, y: number): number {
    const px = Math.floor(x);
    const py = Math.floor(y);
    if (px < 0 || py < 0 || px >= this.width || py >= this.height) return 0;
    return this.mask[py * this.width + px];
  }

  /** Pixels selected in either: the maximum coverage of the two. */
  union(other: Selection): Selection {
    this.assertSameSize(other);
    if (!other.box) return this;
    if (!this.box) return other;
    const mask = this.mask.slice();
    const src = other.mask;
    const { x, y, width, height } = other.box;
    for (let row = y; row < y + height; row++) {
      const end = row * this.width + x + width;
      for (let i = end - width; i < end; i++) if (src[i] > mask[i]) mask[i] = src[i];
    }
    return new Selection(this.width, this.height, mask, unionRects(this.box, other.box));
  }

  /** Pixels selected in this but not in `other`: min(this, 255 − other). */
  subtract(other: Selection): Selection {
    this.assertSameSize(other);
    const overlap = this.box && other.box && intersectRects(this.box, other.box);
    if (!this.box || !overlap) return this;
    const mask = this.mask.slice();
    const src = other.mask;
    const { x, y, width, height } = overlap;
    for (let row = y; row < y + height; row++) {
      const end = row * this.width + x + width;
      for (let i = end - width; i < end; i++) {
        const remaining = 255 - src[i];
        if (remaining < mask[i]) mask[i] = remaining;
      }
    }
    return new Selection(this.width, this.height, mask, scanBounds(mask, this.width, this.box));
  }

  /** Pixels selected in both: the minimum coverage of the two. */
  intersect(other: Selection): Selection {
    this.assertSameSize(other);
    const overlap = this.box && other.box && intersectRects(this.box, other.box);
    if (!overlap) return Selection.empty(this.width, this.height);
    const mask = new Uint8ClampedArray(this.mask.length);
    const a = this.mask;
    const b = other.mask;
    const { x, y, width, height } = overlap;
    for (let row = y; row < y + height; row++) {
      const end = row * this.width + x + width;
      for (let i = end - width; i < end; i++) mask[i] = a[i] < b[i] ? a[i] : b[i];
    }
    return new Selection(this.width, this.height, mask, scanBounds(mask, this.width, overlap));
  }

  /** Every pixel's coverage flipped: 255 − coverage. */
  invert(): Selection {
    const mask = new Uint8ClampedArray(this.mask.length);
    // For bytes, 255 − v equals NOT v, so flip four pixels at a time. Masks are always
    // whole, freshly allocated buffers, so the word views line up with them.
    const words = mask.length >> 2;
    const src = new Uint32Array(this.mask.buffer, 0, words);
    const out = new Uint32Array(mask.buffer, 0, words);
    for (let i = 0; i < words; i++) out[i] = ~src[i];
    for (let i = words << 2; i < mask.length; i++) mask[i] = 255 - this.mask[i];
    const all = { x: 0, y: 0, width: this.width, height: this.height };
    return new Selection(this.width, this.height, mask, scanBounds(mask, this.width, all));
  }

  /**
   * The selection moved by whole pixels. Coverage moved off the canvas is dropped, and
   * moving back doesn't restore it, so to follow a moving shape translate the original
   * by the total offset rather than step by step.
   */
  translate(dx: number, dy: number): Selection {
    if (!Number.isInteger(dx) || !Number.isInteger(dy)) {
      throw new RangeError(`Selections move by whole pixels, not ${dx}, ${dy}`);
    }
    const box = this.box;
    if (!box || (dx === 0 && dy === 0)) return this;
    const { width, height } = this;
    const moved = intersectRects(
      { x: box.x + dx, y: box.y + dy, width: box.width, height: box.height },
      { x: 0, y: 0, width, height },
    );
    if (!moved) return Selection.empty(width, height);
    const mask = new Uint8ClampedArray(this.mask.length);
    for (let y = moved.y; y < moved.y + moved.height; y++) {
      const from = (y - dy) * width + moved.x - dx;
      mask.set(this.mask.subarray(from, from + moved.width), y * width + moved.x);
    }
    // Unclipped, the bounds just move; clipped, the edge rows or columns left may be empty.
    const clipped = moved.width !== box.width || moved.height !== box.height;
    return new Selection(width, height, mask, clipped ? scanBounds(mask, width, moved) : moved);
  }

  /** True if both select exactly the same pixels with the same coverage. */
  equals(other: Selection): boolean {
    if (other === this) return true;
    if (other.width !== this.width || other.height !== this.height) return false;
    const a = this.box;
    const b = other.box;
    if (!a || !b) return a === b;
    if (a.x !== b.x || a.y !== b.y || a.width !== b.width || a.height !== b.height) return false;
    for (let y = a.y; y < a.y + a.height; y++) {
      const start = y * this.width + a.x;
      for (let i = start; i < start + a.width; i++) {
        if (this.mask[i] !== other.mask[i]) return false;
      }
    }
    return true;
  }

  private assertSameSize(other: Selection): void {
    if (other.width !== this.width || other.height !== this.height) {
      throw new RangeError(
        `Selection sizes differ: ${this.width}x${this.height} and ${other.width}x${other.height}`,
      );
    }
  }
}

/**
 * Combines `shape` with the current selection (`base`, null for none) as a selection
 * tool does. Returns null when nothing ends up selected, including subtracting from or
 * intersecting with no selection.
 */
export function combineSelections(
  base: Selection | null,
  shape: Selection,
  mode: SelectionMode,
): Selection | null {
  let result: Selection | null;
  switch (mode) {
    case 'replace':
      result = shape;
      break;
    case 'add':
      result = base ? base.union(shape) : shape;
      break;
    case 'subtract':
      result = base && base.subtract(shape);
      break;
    case 'intersect':
      result = base && base.intersect(shape);
      break;
    default:
      return assertNever(mode);
  }
  return result && !result.isEmpty ? result : null;
}

function assertSize(width: number, height: number): void {
  if (!isValidImageSize(width, height)) {
    throw new RangeError(`Invalid selection size ${width}x${height}`);
  }
}

/** Rounds the span [start, start + size) to whole pixels and clips it to [0, limit]. */
function roundedSpan(start: number, size: number, limit: number): [number, number] {
  const a = Math.round(start);
  const b = Math.round(start + size);
  return [clamp(Math.min(a, b), limit), clamp(Math.max(a, b), limit)];
}

function clamp(value: number, limit: number): number {
  return Math.min(limit, Math.max(0, value));
}

/** Smallest rect within `area` containing every non-zero coverage value, or null. */
function scanBounds(mask: Uint8ClampedArray, width: number, area: Rect): Rect | null {
  let minX = Infinity;
  let maxX = -1;
  let minY = -1;
  let maxY = -1;
  const x0 = area.x;
  const x1 = area.x + area.width;
  for (let y = area.y; y < area.y + area.height; y++) {
    const row = y * width;
    let first = x0;
    while (first < x1 && mask[row + first] === 0) first++;
    if (first === x1) continue;
    let last = x1 - 1;
    while (mask[row + last] === 0) last--;
    if (minY < 0) minY = y;
    maxY = y;
    if (first < minX) minX = first;
    if (last > maxX) maxX = last;
  }
  if (minY < 0) return null;
  return { x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1 };
}
