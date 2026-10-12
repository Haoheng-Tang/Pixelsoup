import { isValidImageSize } from './document';
import type { Point, Rect } from './geometry';
import { intersectRects, unionRects } from './geometry';
import { assertNever } from './layer';
import type { Orientation } from './orientation';
import { orientPixels, orientRect, orientedSize } from './orientation';
import type { Affine } from './resample/affine';
import { multiply, translation } from './resample/affine';
import type { Interpolation } from './resample/kernels';
import { transformMask } from './resample/transform';

/** How a new shape combines with the existing selection. */
export type SelectionMode = 'replace' | 'add' | 'subtract' | 'intersect';

/** Coverage from which a pixel counts as selected when drawing outlines: more than 50%. */
export const SELECTED_THRESHOLD = 128;

/**
 * Sub-rows sampled per pixel row when computing the coverage of ellipses and polygons.
 * Coverage along each sub-row is exact, so edges are anti-aliased with at least this many
 * levels.
 */
const SUBROWS = 16;

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
    const coverage = new RowCoverage(width);
    for (let y = top; y < bottom; y++) {
      for (let k = 0; k < SUBROWS; k++) {
        const dy = (y + (k + 0.5) / SUBROWS - cy) / ry;
        const t = 1 - dy * dy;
        if (t <= 0) continue;
        const half = rx * Math.sqrt(t);
        coverage.add(cx - half, cx + half);
      }
      coverage.flush(mask, y);
    }
    return new Selection(width, height, mask, coverage.bounds(mask, top, bottom));
  }

  /**
   * The polygon through `points` (document coordinates, may be fractional and extend past
   * the canvas), closed from the last point back to the first, with anti-aliased edges
   * measured like an ellipse's. A pixel is inside where the polygon's winding number is
   * non-zero, so a path that crosses itself, like a loosely drawn lasso, fills every loop,
   * including loops it winds round twice. Empty for fewer than three points or a point
   * that isn't finite.
   */
  static fromPolygon(width: number, height: number, points: readonly Point[]): Selection {
    assertSize(width, height);
    const n = points.length;
    let minY = Infinity;
    let maxY = -Infinity;
    for (const { x, y } of points) {
      if (!Number.isFinite(x) || !Number.isFinite(y)) return Selection.empty(width, height);
      minY = Math.min(minY, y);
      maxY = Math.max(maxY, y);
    }
    const top = Math.max(0, Math.floor(minY));
    const bottom = Math.min(height, Math.ceil(maxY));
    if (n < 3 || bottom <= top) return Selection.empty(width, height);

    // Edges run downwards from (edgeX, edgeTop) to edgeBottom; `winding` remembers which
    // way the polygon went. Horizontal edges cross no sub-row and are left out.
    const edgeX = new Float64Array(n);
    const edgeTop = new Float64Array(n);
    const edgeBottom = new Float64Array(n);
    const slope = new Float64Array(n);
    const winding = new Int8Array(n);
    let edges = 0;
    for (let i = 0; i < n; i++) {
      const a = points[i];
      const b = points[(i + 1) % n];
      if (a.y === b.y) continue;
      const [upper, lower] = a.y < b.y ? [a, b] : [b, a];
      edgeX[edges] = upper.x;
      edgeTop[edges] = upper.y;
      edgeBottom[edges] = lower.y;
      slope[edges] = (lower.x - upper.x) / (lower.y - upper.y);
      winding[edges] = a.y < b.y ? 1 : -1;
      edges++;
    }
    const byTop = Uint32Array.from({ length: edges }, (_, i) => i).sort(
      (i, j) => edgeTop[i] - edgeTop[j],
    );

    // Edges crossing the current sub-row, kept sorted by where they cross it. An edge
    // crosses sub-rows from its top (inclusive) to its bottom (exclusive), so a vertex
    // between two edges is crossed once.
    const active = new Int32Array(edges);
    const crossing = new Float64Array(edges);
    let activeCount = 0;
    let nextEdge = 0;
    const mask = new Uint8ClampedArray(width * height);
    const coverage = new RowCoverage(width);
    for (let y = top; y < bottom; y++) {
      for (let k = 0; k < SUBROWS; k++) {
        const sy = y + (k + 0.5) / SUBROWS;
        while (nextEdge < edges && edgeTop[byTop[nextEdge]] <= sy) {
          active[activeCount++] = byTop[nextEdge++];
        }
        let kept = 0;
        for (let a = 0; a < activeCount; a++) {
          const e = active[a];
          if (edgeBottom[e] <= sy) continue;
          active[kept] = e;
          crossing[kept] = edgeX[e] + (sy - edgeTop[e]) * slope[e];
          kept++;
        }
        activeCount = kept;
        // Insertion sort: the order barely changes from one sub-row to the next.
        for (let a = 1; a < activeCount; a++) {
          const e = active[a];
          const x = crossing[a];
          let b = a - 1;
          for (; b >= 0 && crossing[b] > x; b--) {
            active[b + 1] = active[b];
            crossing[b + 1] = crossing[b];
          }
          active[b + 1] = e;
          crossing[b + 1] = x;
        }
        let wound = 0;
        let start = 0;
        for (let a = 0; a < activeCount; a++) {
          const before = wound;
          wound += winding[active[a]];
          if (before === 0) start = crossing[a];
          else if (wound === 0) coverage.add(start, crossing[a]);
        }
      }
      coverage.flush(mask, y);
    }
    return new Selection(width, height, mask, coverage.bounds(mask, top, bottom));
  }

  /** A selection with a copy of `mask` (one coverage value per canvas pixel, row-major). */
  static fromMask(width: number, height: number, mask: ArrayLike<number>): Selection {
    assertSize(width, height);
    if (mask.length !== width * height) {
      throw new RangeError(`Mask has ${mask.length} values, expected ${width * height}`);
    }
    const copy = mask instanceof Uint8ClampedArray ? mask.slice() : Uint8ClampedArray.from(mask);
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
    assertWholePixels(dx, dy);
    if (!this.box || (dx === 0 && dy === 0)) return this;
    return this.shifted(this.width, this.height, dx, dy);
  }

  /**
   * The selection on a canvas resized to `width` × `height`, with what was at (x, y) now
   * at (x + dx, y + dy). Coverage that ends up off the new canvas is dropped.
   */
  resizeCanvas(width: number, height: number, dx: number, dy: number): Selection {
    assertSize(width, height);
    assertWholePixels(dx, dy);
    if (width === this.width && height === this.height) return this.translate(dx, dy);
    return this.shifted(width, height, dx, dy);
  }

  /** The mask moved by (dx, dy) onto a `width` × `height` canvas. */
  private shifted(width: number, height: number, dx: number, dy: number): Selection {
    const box = this.box;
    const moved =
      box &&
      intersectRects(
        { x: box.x + dx, y: box.y + dy, width: box.width, height: box.height },
        { x: 0, y: 0, width, height },
      );
    if (!box || !moved) return Selection.empty(width, height);
    const mask = new Uint8ClampedArray(width * height);
    for (let y = moved.y; y < moved.y + moved.height; y++) {
      const from = (y - dy) * this.width + moved.x - dx;
      mask.set(this.mask.subarray(from, from + moved.width), y * width + moved.x);
    }
    // Unclipped, the bounds just move; clipped, the edge rows or columns left may be empty.
    const clipped = moved.width !== box.width || moved.height !== box.height;
    return new Selection(width, height, mask, clipped ? scanBounds(mask, width, moved) : moved);
  }

  /** The selection on the canvas turned or flipped by `orientation`, losslessly. */
  orient(orientation: Orientation): Selection {
    const size = orientedSize(orientation, this.width, this.height);
    if (!this.box) return Selection.empty(size.width, size.height);
    const mask = orientPixels(orientation, this.mask, this.width, this.height, 1);
    const box = orientRect(orientation, this.box, this.width, this.height);
    return new Selection(size.width, size.height, mask, box);
  }

  /**
   * The selection mapped through `m` (document coordinates), with its coverage resampled
   * the way `transformPixels` resamples a layer's pixels, so a floating selection's outline
   * keeps matching its pixels. Coverage that ends up off the canvas is dropped.
   */
  transform(m: Affine, interpolation: Interpolation): Selection {
    const box = this.box;
    if (!box) return this;
    const region = new Uint8ClampedArray(box.width * box.height);
    for (let y = 0; y < box.height; y++) {
      const from = (box.y + y) * this.width + box.x;
      region.set(this.mask.subarray(from, from + box.width), y * box.width);
    }
    const canvas = { x: 0, y: 0, width: this.width, height: this.height };
    const moved = transformMask(
      region,
      box.width,
      box.height,
      multiply(m, translation(box.x, box.y)),
      interpolation,
      canvas,
    );
    if (!moved) return Selection.empty(this.width, this.height);
    const { data, area } = moved;
    const mask = new Uint8ClampedArray(this.width * this.height);
    for (let y = 0; y < area.height; y++) {
      mask.set(
        data.subarray(y * area.width, (y + 1) * area.width),
        (area.y + y) * this.width + area.x,
      );
    }
    return new Selection(this.width, this.height, mask, scanBounds(mask, this.width, area));
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

function assertWholePixels(dx: number, dy: number): void {
  if (!Number.isInteger(dx) || !Number.isInteger(dy)) {
    throw new RangeError(`Selections move by whole pixels, not ${dx}, ${dy}`);
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

/**
 * Turns the horizontal spans a shape covers on each of a pixel row's `SUBROWS` sub-rows
 * into the row's coverage: the fraction of each pixel the spans cover, exact along each
 * sub-row. One per shape, reused for every row.
 */
class RowCoverage {
  /** Difference array of the pixels a sub-row covers completely. */
  private readonly whole: Float64Array;
  /** The partly covered pixels at the ends of spans. */
  private readonly part: Float64Array;
  /** The current row's spans touch columns [lo, hi). */
  private lo: number;
  private hi = 0;
  /** Every row so far touches columns [left, right). */
  private left: number;
  private right = 0;

  constructor(private readonly width: number) {
    this.whole = new Float64Array(width + 1);
    this.part = new Float64Array(width + 1);
    this.lo = width;
    this.left = width;
  }

  /** Adds the span [l, r) of one sub-row, clipped to the canvas. */
  add(l: number, r: number): void {
    const { width, whole, part } = this;
    if (l < 0) l = 0;
    if (r > width) r = width;
    if (!(r > l)) return;
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
    if (il < this.lo) this.lo = il;
    const end = Math.min(width, ir + 1);
    if (end > this.hi) this.hi = end;
  }

  /** Writes the row's coverage into row `y` of `mask` and clears it for the next row. */
  flush(mask: Uint8ClampedArray, y: number): void {
    const { whole, part, lo, hi } = this;
    let covered = 0;
    const row = y * this.width;
    for (let x = lo; x < hi; x++) {
      covered += whole[x];
      // Uint8ClampedArray rounds and clamps.
      mask[row + x] = ((covered + part[x]) * 255) / SUBROWS;
      whole[x] = 0;
      part[x] = 0;
    }
    whole[hi] = 0;
    part[hi] = 0;
    this.left = Math.min(this.left, lo);
    this.right = Math.max(this.right, hi);
    this.lo = this.width;
    this.hi = 0;
  }

  /** Bounds of the coverage written to rows [top, bottom) of `mask`, or null if none. */
  bounds(mask: Uint8ClampedArray, top: number, bottom: number): Rect | null {
    const { left, right } = this;
    if (right <= left) return null;
    return scanBounds(mask, this.width, {
      x: left,
      y: top,
      width: right - left,
      height: bottom - top,
    });
  }
}
