import type { Point, Rect } from '../geometry';
import type { Affine } from './affine';
import { multiply, transformPoint, transformedBounds, wholePixelBounds } from './affine';

/**
 * A projective transform (a homography): a 3 × 3 matrix, row by row, mapping (x, y) to
 * ((m0·x + m1·y + m2) / w, (m3·x + m4·y + m5) / w) with w = m6·x + m7·y + m8. Lines stay
 * straight but parallel lines may meet, so a rectangle can go to any convex quadrilateral:
 * Free Transform's Distort and Perspective. Any nonzero multiple of a matrix is the same
 * transform. With a bottom row of (0, 0, 1) it's affine (`isAffine`).
 */
export type Projective = readonly [
  m0: number,
  m1: number,
  m2: number,
  m3: number,
  m4: number,
  m5: number,
  m6: number,
  m7: number,
  m8: number,
];

/** Where a rectangle's top-left, top-right, bottom-right and bottom-left corners go. */
export type Quad = readonly [Point, Point, Point, Point];

/** How far a bottom row may be from (0, 0, 1) and still count as affine. */
const AFFINE_EPSILON = 1e-12;

/**
 * How sharply each corner of a quad must turn to count as a corner: the sine of the angle
 * between its edges. Smaller, three corners are as good as in line.
 */
const TURN_EPSILON = 1e-9;

/** `m` as a 3 × 3 matrix, with a bottom row of exactly (0, 0, 1). */
export function fromAffine(m: Affine): Projective {
  const [a, b, c, d, e, f] = m;
  return [a, c, e, b, d, f, 0, 0, 1];
}

/** True for a 3 × 3 matrix, false for an `Affine`. */
export function isProjective(m: Affine | Projective): m is Projective {
  return m.length === 9;
}

/** True if `m` is affine: an `Affine`, or a matrix whose bottom row is (0, 0, 1) within `epsilon`. */
export function isAffine(m: Affine | Projective, epsilon = AFFINE_EPSILON): boolean {
  if (!isProjective(m)) return true;
  return Math.abs(m[6]) <= epsilon && Math.abs(m[7]) <= epsilon && Math.abs(m[8] - 1) <= epsilon;
}

/**
 * `m` as an `Affine` if it is one (`isAffine`), else null. A matrix made by `fromAffine`
 * comes back exactly.
 */
export function toAffine(m: Affine | Projective): Affine | null {
  if (!isProjective(m)) return m;
  if (!isAffine(m)) return null;
  const [m0, m1, m2, m3, m4, m5, , , m8] = m;
  return [m0 / m8, m3 / m8, m1 / m8, m4 / m8, m2 / m8, m5 / m8];
}

/** The transform that applies `inner`, then `outer`. */
export function multiplyProjective(outer: Projective, inner: Projective): Projective {
  const [a0, a1, a2, a3, a4, a5, a6, a7, a8] = outer;
  const [b0, b1, b2, b3, b4, b5, b6, b7, b8] = inner;
  return [
    a0 * b0 + a1 * b3 + a2 * b6,
    a0 * b1 + a1 * b4 + a2 * b7,
    a0 * b2 + a1 * b5 + a2 * b8,
    a3 * b0 + a4 * b3 + a5 * b6,
    a3 * b1 + a4 * b4 + a5 * b7,
    a3 * b2 + a4 * b5 + a5 * b8,
    a6 * b0 + a7 * b3 + a8 * b6,
    a6 * b1 + a7 * b4 + a8 * b7,
    a6 * b2 + a7 * b5 + a8 * b8,
  ];
}

/**
 * The transform that undoes `m`, or null if `m` flattens the plane (or isn't finite). It's
 * the exact inverse, not a multiple of it, so where `m` gives w > 0 the inverse gives
 * 1 / w > 0 back; the inverse of an affine matrix is exactly affine.
 */
export function invertProjective(m: Projective): Projective | null {
  const [m0, m1, m2, m3, m4, m5, m6, m7, m8] = m;
  const c0 = m4 * m8 - m5 * m7;
  const c3 = m5 * m6 - m3 * m8;
  const c6 = m3 * m7 - m4 * m6;
  const det = m0 * c0 + m1 * c3 + m2 * c6;
  if (!Number.isFinite(det) || Math.abs(det) < 1e-12) return null;
  // `+ 0` turns -0 into 0, so an affine matrix's inverse has a bottom row of exactly (0, 0, 1).
  return [
    c0 / det,
    (m2 * m7 - m1 * m8) / det,
    (m1 * m5 - m2 * m4) / det,
    c3 / det,
    (m0 * m8 - m2 * m6) / det,
    (m2 * m3 - m0 * m5) / det,
    c6 / det + 0,
    (m1 * m6 - m0 * m7) / det + 0,
    (m0 * m4 - m1 * m3) / det,
  ];
}

/** Where `m` takes (x, y), after the perspective divide; not finite on its horizon (w = 0). */
export function projectPoint(m: Projective, x: number, y: number): [x: number, y: number] {
  const w = m[6] * x + m[7] * y + m[8];
  return [(m[0] * x + m[1] * y + m[2]) / w, (m[3] * x + m[4] * y + m[5]) / w];
}

/** Where either kind of transform takes (x, y). */
export function mapPoint(m: Affine | Projective, x: number, y: number): [x: number, y: number] {
  return isProjective(m) ? projectPoint(m, x, y) : transformPoint(m, x, y);
}

/** The transform that applies `inner`, then `outer`: an `Affine` when both are. */
export function compose(
  outer: Affine | Projective,
  inner: Affine | Projective,
): Affine | Projective {
  if (!isProjective(outer) && !isProjective(inner)) return multiply(outer, inner);
  return multiplyProjective(asProjective(outer), asProjective(inner));
}

function asProjective(m: Affine | Projective): Projective {
  return isProjective(m) ? m : fromAffine(m);
}

/** Where `area`'s top-left, top-right, bottom-right and bottom-left corners go. */
export function mapCorners(m: Affine | Projective, area: Rect): Quad {
  const right = area.x + area.width;
  const bottom = area.y + area.height;
  const corner = (x: number, y: number): Point => {
    const [px, py] = mapPoint(m, x, y);
    return { x: px, y: py };
  };
  return [
    corner(area.x, area.y),
    corner(right, area.y),
    corner(right, bottom),
    corner(area.x, bottom),
  ];
}

/**
 * The smallest whole-pixel rect containing `area` (a rect of pixel edges) after `m`, as
 * `transformedBounds` gives it for an affine `m`. Null if a projective `m` takes part of
 * `area` past its horizon (w isn't the same sign all over it), out to infinity.
 */
export function mappedBounds(m: Affine | Projective, area: Rect): Rect | null {
  if (!isProjective(m)) return transformedBounds(m, area);
  const affine = toAffine(m);
  if (affine) return transformedBounds(affine, area);
  const right = area.x + area.width;
  const bottom = area.y + area.height;
  let minW = Infinity;
  let maxW = -Infinity;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const [cx, cy] of [
    [area.x, area.y],
    [right, area.y],
    [right, bottom],
    [area.x, bottom],
  ] as const) {
    const w = m[6] * cx + m[7] * cy + m[8];
    minW = Math.min(minW, w);
    maxW = Math.max(maxW, w);
    const [x, y] = projectPoint(m, cx, cy);
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
  }
  // w is linear, so a sign it keeps at the corners it keeps all over the rect.
  if (!(minW > 0 || maxW < 0)) return null;
  if (!Number.isFinite(minX + minY + maxX + maxY)) return null;
  return wholePixelBounds(minX, minY, maxX, maxY);
}

/**
 * True if `quad` is a convex quadrilateral: it turns the same way at every corner, and by
 * more than a sliver, so no three corners are in line, no two coincide and no edges cross.
 * Either way round counts (a flipped quad turns the other way).
 */
export function isConvexQuad(quad: Quad): boolean {
  let turn = 0;
  for (let i = 0; i < 4; i++) {
    const p = quad[i];
    const q = quad[(i + 1) % 4];
    const r = quad[(i + 2) % 4];
    const ux = q.x - p.x;
    const uy = q.y - p.y;
    const vx = r.x - q.x;
    const vy = r.y - q.y;
    const cross = ux * vy - uy * vx;
    // Also false for edges of no length, and for anything not finite.
    if (!(Math.abs(cross) > TURN_EPSILON * Math.hypot(ux, uy) * Math.hypot(vx, vy))) return false;
    const sign = Math.sign(cross);
    if (turn !== 0 && sign !== turn) return false;
    turn = sign;
  }
  return true;
}

/** The unit square's corners, in `Quad` order. */
const UNIT_SQUARE = [
  [0, 0],
  [1, 0],
  [1, 1],
  [0, 1],
] as const;

/**
 * The projective transform taking `source`'s top-left, top-right, bottom-right and
 * bottom-left corners to the four points of `quad`, or null unless `source` has some area
 * and `quad` is convex (`isConvexQuad`): a concave, crossed or flattened quad has no such
 * transform that keeps the inside inside. It solves the usual 8 × 8 linear system for the
 * unit square and the quad scaled to about a unit across, which keeps it well conditioned,
 * then scales back. A parallelogram gives an affine matrix, its bottom row exactly
 * (0, 0, 1). The matrix gives w > 0 all over `source`.
 */
export function homographyFromQuad(source: Rect, quad: Quad): Projective | null {
  const { x, y, width, height } = source;
  if (!(width > 0 && height > 0) || !Number.isFinite(x + y + width + height)) return null;
  if (!isConvexQuad(quad)) return null;
  const cx = (quad[0].x + quad[1].x + quad[2].x + quad[3].x) / 4;
  const cy = (quad[0].y + quad[1].y + quad[2].y + quad[3].y) / 4;
  let size = 0;
  for (const p of quad) size = Math.max(size, Math.abs(p.x - cx), Math.abs(p.y - cy));
  // Rows for X = (h0·u + h1·v + h2) / (h6·u + h7·v + 1), and likewise Y with h3, h4, h5.
  const a = new Float64Array(64);
  const b = new Float64Array(8);
  UNIT_SQUARE.forEach(([u, v], i) => {
    const X = (quad[i].x - cx) / size;
    const Y = (quad[i].y - cy) / size;
    a.set([u, v, 1, 0, 0, 0, -u * X, -v * X], 16 * i);
    a.set([0, 0, 0, u, v, 1, -u * Y, -v * Y], 16 * i + 8);
    b[2 * i] = X;
    b[2 * i + 1] = Y;
  });
  const h = solveLinear(a, b, 8);
  if (!h) return null;
  // A parallelogram has no perspective: drop the rounding noise, so it's exactly affine.
  const perspective = Math.abs(h[6]) > AFFINE_EPSILON || Math.abs(h[7]) > AFFINE_EPSILON;
  const unit: Projective = [
    h[0],
    h[1],
    h[2],
    h[3],
    h[4],
    h[5],
    perspective ? h[6] : 0,
    perspective ? h[7] : 0,
    1,
  ];
  const toUnit: Projective = [1 / width, 0, -x / width, 0, 1 / height, -y / height, 0, 0, 1];
  const fromScaled: Projective = [size, 0, cx, 0, size, cy, 0, 0, 1];
  return multiplyProjective(fromScaled, multiplyProjective(unit, toUnit));
}

/**
 * The solution of the `n` × `n` system a·x = b (`a` row by row, both overwritten), by
 * Gaussian elimination with partial pivoting, or null if it's singular.
 */
function solveLinear(a: Float64Array, b: Float64Array, n: number): Float64Array | null {
  for (let col = 0; col < n; col++) {
    let pivot = col;
    for (let row = col + 1; row < n; row++) {
      if (Math.abs(a[row * n + col]) > Math.abs(a[pivot * n + col])) pivot = row;
    }
    const p = a[pivot * n + col];
    if (!(Math.abs(p) > 1e-12)) return null;
    if (pivot !== col) {
      for (let k = 0; k < n; k++) {
        const t = a[col * n + k];
        a[col * n + k] = a[pivot * n + k];
        a[pivot * n + k] = t;
      }
      const t = b[col];
      b[col] = b[pivot];
      b[pivot] = t;
    }
    for (let row = col + 1; row < n; row++) {
      const factor = a[row * n + col] / p;
      if (factor === 0) continue;
      for (let k = col; k < n; k++) a[row * n + k] -= factor * a[col * n + k];
      b[row] -= factor * b[col];
    }
  }
  const x = new Float64Array(n);
  for (let row = n - 1; row >= 0; row--) {
    let sum = b[row];
    for (let k = row + 1; k < n; k++) sum -= a[row * n + k] * x[k];
    x[row] = sum / a[row * n + row];
  }
  return x;
}
