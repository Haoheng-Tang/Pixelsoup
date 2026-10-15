import type { Rect } from '../geometry';

/**
 * A 2D affine transform [a, b, c, d, e, f], mapping (x, y) to (a·x + c·y + e, b·x + d·y + f):
 * the order canvas `setTransform` uses. Document space has y pointing down, so a positive
 * rotation turns clockwise on screen.
 */
export type Affine = readonly [a: number, b: number, c: number, d: number, e: number, f: number];

export const IDENTITY: Affine = [1, 0, 0, 1, 0, 0];

export function translation(tx: number, ty: number): Affine {
  return [1, 0, 0, 1, tx, ty];
}

export function scaling(sx: number, sy: number = sx): Affine {
  return [sx, 0, 0, sy, 0, 0];
}

/**
 * A rotation by `degrees` about the origin, clockwise on screen. Multiples of 90° are
 * exact, so quarter turns land pixel centres exactly on pixel centres.
 */
export function rotation(degrees: number): Affine {
  const turn = ((degrees % 360) + 360) % 360;
  let cos: number;
  let sin: number;
  if (turn % 90 === 0) {
    [cos, sin] = turn === 0 ? [1, 0] : turn === 90 ? [0, 1] : turn === 180 ? [-1, 0] : [0, -1];
  } else {
    const radians = (degrees * Math.PI) / 180;
    [cos, sin] = [Math.cos(radians), Math.sin(radians)];
  }
  return [cos, sin, -sin || 0, cos, 0, 0];
}

/** The transform that applies `inner`, then `outer`. */
export function multiply(outer: Affine, inner: Affine): Affine {
  const [a, b, c, d, e, f] = outer;
  const [p, q, r, s, t, u] = inner;
  return [
    a * p + c * q,
    b * p + d * q,
    a * r + c * s,
    b * r + d * s,
    a * t + c * u + e,
    b * t + d * u + f,
  ];
}

/** The transform that undoes `m`, or null if `m` flattens the plane (or isn't finite). */
export function invert(m: Affine): Affine | null {
  const [a, b, c, d, e, f] = m;
  const det = a * d - b * c;
  if (!Number.isFinite(det) || Math.abs(det) < 1e-12) return null;
  return [d / det, -b / det, -c / det, a / det, (c * f - d * e) / det, (b * e - a * f) / det];
}

/** `m` applied about the point (px, py) instead of the origin. */
export function aboutPivot(m: Affine, px: number, py: number): Affine {
  return multiply(translation(px, py), multiply(m, translation(-px, -py)));
}

export function transformPoint(m: Affine, x: number, y: number): [x: number, y: number] {
  return [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
}

/** Coordinates this close to a whole number count as whole, so rounding noise adds no pixels. */
const SNAP = 1e-6;

function snap(value: number): number {
  const whole = Math.round(value);
  return Math.abs(value - whole) < SNAP ? whole : value;
}

/** The smallest whole-pixel rect containing `area` (a rect of pixel edges) after `m`. */
export function transformedBounds(m: Affine, area: Rect): Rect {
  const { minX, minY, maxX, maxY } = cornerExtent(m, area);
  // `|| 0` turns -0 into 0.
  const x = Math.floor(snap(minX)) || 0;
  const y = Math.floor(snap(minY)) || 0;
  return { x, y, width: Math.ceil(snap(maxX)) - x, height: Math.ceil(snap(maxY)) - y };
}

/**
 * `m` followed by the smallest shift that puts the top-left of `area`'s transformed bounds
 * on a pixel corner. A quarter turn of a layer about its centre then lands every pixel
 * exactly on a pixel, whatever its size. A shift of half a pixel moves the bounds further
 * from `area`'s own top-left, so that turning them back brings them back where they were.
 */
export function alignToPixels(m: Affine, area: Rect): Affine {
  const { minX, minY } = cornerExtent(m, area);
  const x = area.x + roundHalfAway(minX - area.x);
  const y = area.y + roundHalfAway(minY - area.y);
  return multiply(translation(x - minX, y - minY), m);
}

/** `value` rounded to the nearest whole number, halves away from zero. */
function roundHalfAway(value: number): number {
  return Math.sign(value) * Math.round(Math.abs(value));
}

function cornerExtent(m: Affine, area: Rect) {
  const right = area.x + area.width;
  const bottom = area.y + area.height;
  const xs: number[] = [];
  const ys: number[] = [];
  for (const [cx, cy] of [
    [area.x, area.y],
    [right, area.y],
    [area.x, bottom],
    [right, bottom],
  ] as const) {
    const [x, y] = transformPoint(m, cx, cy);
    xs.push(x);
    ys.push(y);
  }
  return {
    minX: Math.min(...xs),
    minY: Math.min(...ys),
    maxX: Math.max(...xs),
    maxY: Math.max(...ys),
  };
}
