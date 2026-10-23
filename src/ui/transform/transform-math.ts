import type { Affine, Orientation, Point, Projective, Quad, Rect } from '../../core';
import {
  aboutPivot,
  alignToPixels,
  assertNever,
  compose,
  homographyFromQuad,
  invert,
  invertProjective,
  isConvexQuad,
  isProjective,
  mapCorners,
  mappedBounds,
  mapPoint,
  multiply,
  rotation,
  scaling,
  toAffine,
  transformPoint,
  translation,
} from '../../core';
import type { CropHandle } from '../tools/crop-geometry';
import { HANDLE_GRID, HANDLE_REACH, HANDLE_SIDES } from '../tools/crop-geometry';
import type { ToolModifiers } from '../tools/tool';
import { distortCursor, perspectiveCursor, rotateCursor, skewCursor } from './transform-cursors';

/**
 * Free Transform itself, or one of Edit → Transform's modes, which change what a plain drag
 * on a handle does (see `hitTransform`): Scale has no rotate zone, Rotate turns from the
 * handles and everywhere outside, and Skew, Distort and Perspective do what they're named
 * for, with no rotate zone either. All of them move from inside.
 */
export type TransformMode = 'free' | 'scale' | 'rotate' | 'skew' | 'distort' | 'perspective';

/**
 * What a Free Transform session does to its layer: where the corners of the layer's bounds
 * go (`corners`: its top-left, top-right, bottom-right and bottom-left as they are on the
 * layer, in document coordinates) and where its centre goes (`pivot`). Every change is an
 * operation on the corners, which the box shows and the transform is fitted to.
 *
 * `angle`, in degrees clockwise in (−180, 180], is the turn the options bar reads the size
 * after: it tells a layer flipped left to right from one flipped upside down and turned
 * half round, whose corners are the same.
 */
export interface TransformState {
  readonly corners: Quad;
  readonly pivot: Point;
  readonly angle: number;
}

/**
 * How the options bar reads a box that's a parallelogram: the layer scaled by `scaleX`
 * and `scaleY` along its own axes (negative flips it), skewed by `skewX` and `skewY`,
 * turned `angle` degrees clockwise, all about its centre, and that centre (the pivot) put
 * at `x`, `y` in document coordinates.
 */
export interface TransformParams {
  readonly x: number;
  readonly y: number;
  readonly scaleX: number;
  readonly scaleY: number;
  /** Degrees clockwise, in (−180, 180]. */
  readonly angle: number;
  /** Horizontal skew: how far the layer's left and right edges lean, in degrees clockwise. */
  readonly skewX: number;
  /** Vertical skew: how far its top and bottom edges lean, in degrees clockwise. */
  readonly skewY: number;
}

/**
 * A handle on the transform box, named for where it is on the layer before the transform
 * (so a flipped layer's 'e' handle is on the left).
 */
export type TransformHandle = CropHandle;

/**
 * What dragging a handle does. Scale scales from the opposite handle and Rotate turns about
 * the pivot. Skew slides an edge along itself (a corner along one of its edges), Distort
 * moves a corner, or an edge's two, anywhere, and Perspective moves a corner along one of
 * its edges and the edge's other corner the same distance the opposite way; these three
 * keep the box convex.
 */
export type HandleOperation = 'scale' | 'rotate' | 'skew' | 'distort' | 'perspective';

/** What a press on the transform box does: something from a handle, or move the box. */
export type TransformHit =
  { readonly kind: HandleOperation; readonly handle: TransformHandle } | { readonly kind: 'move' };

/** How far beyond a corner handle's reach, in CSS pixels, a press rotates (Free Transform). */
export const ROTATE_REACH = 12;

/** Rotation steps with Shift held, in degrees. */
export const ROTATE_SNAP = 15;

/** The largest size, in pixels, and the furthest position the options bar accepts. */
export const MAX_FIELD_VALUE = 100000;

/** How far, in document pixels, corners may be from a parallelogram's and still make one. */
const PARALLELOGRAM_EPSILON = 1e-6;

/** How near to 0 or ±1 a linear part's entries must be to make a whole turn or flip. */
const WHOLE_TURN_EPSILON = 1e-9;

/**
 * How close, in document pixels, Skew, Distort and Perspective let a corner come to the
 * line through its two neighbours (no closer than it was, if it started closer), so the
 * box stays convex.
 */
const MIN_CLEARANCE = 1;

/** The layer's centre, which its transform turns and scales about. */
export function sourceCentre(source: Rect): Point {
  return { x: source.x + source.width / 2, y: source.y + source.height / 2 };
}

/** The params that leave the layer `source` covers where it is. */
export function identityParams(source: Rect): TransformParams {
  const { x, y } = sourceCentre(source);
  return { x, y, scaleX: 1, scaleY: 1, angle: 0, skewX: 0, skewY: 0 };
}

/** The state that leaves the layer `source` covers where it is. */
export function identityState(source: Rect): TransformState {
  const right = source.x + source.width;
  const bottom = source.y + source.height;
  return {
    corners: [
      { x: source.x, y: source.y },
      { x: right, y: source.y },
      { x: right, y: bottom },
      { x: source.x, y: bottom },
    ],
    pivot: sourceCentre(source),
    angle: 0,
  };
}

/** An angle in degrees, brought into (−180, 180]. */
export function normalizeAngle(degrees: number): number {
  let angle = degrees % 360;
  if (angle <= -180) angle += 360;
  else if (angle > 180) angle -= 360;
  return angle || 0;
}

/**
 * The skew the options bar's H and V fields set: the layer's vertical edges turned `h`
 * degrees clockwise and its horizontal edges `v`, each keeping its length across the
 * other axis (y down, so x′ = x − y·tan h and y′ = y + x·tan v).
 */
function skewing(h: number, v: number): Affine {
  const radians = Math.PI / 180;
  return [1, Math.tan(v * radians), -Math.tan(h * radians), 1, 0, 0];
}

/**
 * The state `params` describe for the layer covering `source`: its bounds scaled, skewed
 * and turned about its centre, and moved to put the centre at the pivot.
 */
export function stateFromParams(source: Rect, params: TransformParams): TransformState {
  const centre = sourceCentre(source);
  let shape = multiply(scaling(params.scaleX, params.scaleY), translation(-centre.x, -centre.y));
  if (params.skewX !== 0 || params.skewY !== 0) {
    shape = multiply(skewing(params.skewX, params.skewY), shape);
  }
  const m = multiply(translation(params.x, params.y), multiply(rotation(params.angle), shape));
  return {
    corners: mapCorners(m, source),
    pivot: { x: params.x, y: params.y },
    angle: normalizeAngle(params.angle),
  };
}

/** True if `a` and `b` are exactly the same state. */
export function sameState(a: TransformState, b: TransformState): boolean {
  const same = (p: Point, q: Point) => p.x === q.x && p.y === q.y;
  const [a0, a1, a2, a3] = a.corners;
  const [b0, b1, b2, b3] = b.corners;
  return (
    a === b ||
    (a.angle === b.angle &&
      same(a.pivot, b.pivot) &&
      same(a0, b0) &&
      same(a1, b1) &&
      same(a2, b2) &&
      same(a3, b3))
  );
}

/** True if the corners make a parallelogram, give or take rounding noise. */
function isParallelogram([topLeft, topRight, bottomRight, bottomLeft]: Quad): boolean {
  return (
    Math.abs(topLeft.x + bottomRight.x - topRight.x - bottomLeft.x) <= PARALLELOGRAM_EPSILON &&
    Math.abs(topLeft.y + bottomRight.y - topRight.y - bottomLeft.y) <= PARALLELOGRAM_EPSILON
  );
}

/**
 * The affine transform taking the layer's top-left, top-right and bottom-left corners to
 * `state`'s, and its centre to the pivot (which operations keep exact); while the corners
 * make a parallelogram it takes the bottom-right one there too.
 */
function stateAffine(source: Rect, state: TransformState): Affine {
  const [topLeft, topRight, , bottomLeft] = state.corners;
  const a = (topRight.x - topLeft.x) / source.width;
  const b = (topRight.y - topLeft.y) / source.width;
  const c = (bottomLeft.x - topLeft.x) / source.height;
  const d = (bottomLeft.y - topLeft.y) / source.height;
  const centre = sourceCentre(source);
  const { pivot } = state;
  return [
    a,
    b,
    c,
    d,
    pivot.x - (a * centre.x + c * centre.y),
    pivot.y - (b * centre.x + d * centre.y),
  ];
}

/**
 * The transform taking the layer's bounds to `state`'s box as it is: affine for a
 * parallelogram, else projective. Operations on the box work through it.
 */
function boxTransform(source: Rect, state: TransformState): Affine | Projective {
  if (isParallelogram(state.corners)) return stateAffine(source, state);
  return homographyFromQuad(source, state.corners) ?? stateAffine(source, state);
}

/**
 * The linear part of a whole turn or flip, made exact, if `m`'s is one give or take
 * rounding noise (turns of 15° that add up to 90°, say); else null.
 */
function wholeTurn([a, b, c, d]: Affine): [number, number, number, number] | null {
  const unit = (value: number) => Math.abs(Math.abs(value) - 1) <= WHOLE_TURN_EPSILON;
  const zero = (value: number) => Math.abs(value) <= WHOLE_TURN_EPSILON;
  if (unit(a) && zero(b) && zero(c) && unit(d)) return [Math.sign(a), 0, 0, Math.sign(d)];
  if (zero(a) && unit(b) && unit(c) && zero(d)) return [0, Math.sign(b), Math.sign(c), 0];
  return null;
}

/**
 * The transform `state` describes for the layer covering `source`, mapping canvas
 * coordinates to canvas coordinates as `TransformLayerCommand` takes them: affine while the
 * box is a parallelogram, else projective (`homographyFromQuad`). Whole turns and flips at
 * the layer's size are made exact and shifted by at most half a pixel onto the pixel grid,
 * so they copy pixels exactly.
 */
export function stateMatrix(source: Rect, state: TransformState): Affine | Projective {
  const m = boxTransform(source, state);
  if (isProjective(m)) return m;
  const exact = wholeTurn(m);
  if (!exact) return m;
  const [a, b, c, d] = exact;
  const centre = sourceCentre(source);
  const { pivot } = state;
  const e = pivot.x - (a * centre.x + c * centre.y);
  const f = pivot.y - (b * centre.x + d * centre.y);
  return alignToPixels([a, b, c, d, e, f], source);
}

/**
 * `value`, or the nearest millionth if it's within rounding noise of it, so that corners
 * worked out from a scale of 1.5 read back as 1.5 rather than 1.4999999999999998.
 */
function tidy(value: number): number {
  const rounded = Math.round(value * 1e6) / 1e6;
  return Math.abs(value - rounded) <= 1e-9 * Math.max(1, Math.abs(value)) ? rounded + 0 : value;
}

/**
 * How the options bar reads `state`: its size along the layer's own axes, skewed, turned
 * by its angle; or null if the box isn't a parallelogram.
 */
export function stateParams(source: Rect, state: TransformState): TransformParams | null {
  if (!isParallelogram(state.corners)) return null;
  // Unturned, the linear part is skewing × scaling: [a, b, c, d] =
  // [scaleX, tan(skewY)·scaleX, −tan(skewX)·scaleY, scaleY].
  const [a, b, c, d] = multiply(rotation(-state.angle), stateAffine(source, state));
  const degrees = (radians: number) => (radians * 180) / Math.PI;
  return {
    x: tidy(state.pivot.x),
    y: tidy(state.pivot.y),
    scaleX: tidy(a),
    scaleY: tidy(d),
    angle: state.angle,
    skewX: tidy(degrees(Math.atan(-c / d))),
    skewY: tidy(degrees(Math.atan(b / a))),
  };
}

/** True when `m` leaves everything where it is, give or take rounding noise. */
export function isIdentity(m: Affine | Projective): boolean {
  const affine = toAffine(m);
  if (!affine) return false;
  const [a, b, c, d, e, f] = affine;
  const near = (value: number, target: number) => Math.abs(value - target) < 1e-9;
  return near(a, 1) && near(b, 0) && near(c, 0) && near(d, 1) && near(e, 0) && near(f, 0);
}

/**
 * The distances from `point` to the lines through the box's top, right, bottom and left
 * edges (as they are on the layer), positive inside the box; null for a box with no area.
 */
function edgeDistances(corners: Quad, point: Point): [number, number, number, number] | null {
  let area = 0;
  for (let i = 0; i < 4; i++) {
    const p = corners[i];
    const q = corners[(i + 1) % 4];
    if (p && q) area += p.x * q.y - q.x * p.y;
  }
  if (!(Math.abs(area) > 0)) return null;
  // Clockwise on screen (y points down) the inside is on each edge's right.
  const inside = Math.sign(area);
  const distance = (p: Point, q: Point) => {
    const ex = q.x - p.x;
    const ey = q.y - p.y;
    return (inside * (ex * (point.y - p.y) - ey * (point.x - p.x))) / Math.hypot(ex, ey);
  };
  const [topLeft, topRight, bottomRight, bottomLeft] = corners;
  return [
    distance(topLeft, topRight),
    distance(topRight, bottomRight),
    distance(bottomRight, bottomLeft),
    distance(bottomLeft, topLeft),
  ];
}

/**
 * Which side of the box a point is on along one axis, from its distances inside the box's
 * two edges across that axis: −1 within `reach` of the first, 1 of the second (but at
 * most a third of the way across), 0 between them, or null beyond either edge's reach.
 */
function sideFrom(start: number, end: number, reach: number): -1 | 0 | 1 | null {
  if (start < -reach || end < -reach) return null;
  const inward = Math.min(reach, (start + end) / 3);
  if (start <= inward) return -1;
  if (end <= inward) return 1;
  return 0;
}

/** No modifier keys held. */
const NO_KEYS: ToolModifiers = { shiftKey: false, altKey: false, ctrlKey: false, metaKey: false };

/**
 * What dragging `handle` does in `mode` with `keys` held at the press. Ctrl (Cmd on a Mac)
 * distorts a corner, or with Alt and Shift too puts it in perspective, and skews an edge,
 * in any mode; otherwise the mode decides.
 */
function handleOperation(
  mode: TransformMode,
  handle: TransformHandle,
  keys: ToolModifiers,
): HandleOperation {
  const corner = isCornerHandle(handle);
  if (keys.ctrlKey || keys.metaKey) {
    if (!corner) return 'skew';
    return keys.altKey && keys.shiftKey ? 'perspective' : 'distort';
  }
  switch (mode) {
    case 'free':
    case 'scale':
      return 'scale';
    case 'rotate':
    case 'skew':
    case 'distort':
      return mode;
    case 'perspective':
      return corner ? 'perspective' : 'skew';
    default:
      return assertNever(mode);
  }
}

/**
 * What a press at `point` does to the transform box with `corners` (as `TransformOverlay`
 * has them), with `keys` held, or null if nothing. Edges reach `HANDLE_REACH` CSS pixels
 * outwards, but at most a third of the box inwards, as the crop box's do; in Free
 * Transform a press up to `ROTATE_REACH` further out round a corner rotates. In 'rotate'
 * mode the handles and everything outside rotate, and in the other modes nothing outside
 * the handles does. What a handle does: `handleOperation`.
 */
export function hitTransform(
  corners: Quad,
  point: Point,
  zoom: number,
  mode: TransformMode,
  keys: ToolModifiers = NO_KEYS,
): TransformHit | null {
  const distances = edgeDistances(corners, point);
  if (!distances) return null;
  const [top, right, bottom, left] = distances;
  const reach = HANDLE_REACH / zoom;
  const sideX = sideFrom(left, right, reach);
  const sideY = sideFrom(top, bottom, reach);
  if (sideX !== null && sideY !== null) {
    const handle = HANDLE_GRID[sideY + 1]?.[sideX + 1] ?? null;
    if (!handle) return { kind: 'move' };
    return { kind: handleOperation(mode, handle, keys), handle };
  }
  if (mode !== 'free' && mode !== 'rotate') return null;
  // Outside the handles: the edges it's beyond tell which handle it's beyond.
  const nearX = left <= 0 ? -1 : right <= 0 ? 1 : 0;
  const nearY = top <= 0 ? -1 : bottom <= 0 ? 1 : 0;
  const handle = HANDLE_GRID[nearY + 1]?.[nearX + 1] ?? null;
  if (!handle) return null;
  if (mode === 'rotate') return { kind: 'rotate', handle };
  if (nearX === 0 || nearY === 0) return null;
  const corner = corners[nearY < 0 ? (nearX < 0 ? 0 : 1) : nearX > 0 ? 2 : 3];
  const distance = Math.hypot(point.x - corner.x, point.y - corner.y);
  return distance <= (HANDLE_REACH + ROTATE_REACH) / zoom ? { kind: 'rotate', handle } : null;
}

/** Resize cursors by the direction of a handle on screen, in steps of 45° from east. */
const RESIZE_CURSORS = ['ew-resize', 'nwse-resize', 'ns-resize', 'nesw-resize'] as const;

/** The direction from `p` to `q`, a unit vector, or (0, 0) if they're the same point. */
function unit(p: Point, q: Point): Point {
  const length = Math.hypot(q.x - p.x, q.y - p.y);
  return length > 0 ? { x: (q.x - p.x) / length, y: (q.y - p.y) / length } : { x: 0, y: 0 };
}

/**
 * The direction `handle` points in on screen, in degrees clockwise from east: out across
 * its edge, along the box's edges, so corners point along the diagonal of the edges they
 * join whatever the box's shape.
 */
function handleDirection(corners: Quad, handle: TransformHandle): number {
  const [topLeft, topRight, bottomRight, bottomLeft] = corners;
  const [sideX, sideY] = HANDLE_SIDES[handle];
  const top = unit(topLeft, topRight);
  const bottom = unit(bottomLeft, bottomRight);
  const left = unit(topLeft, bottomLeft);
  const right = unit(topRight, bottomRight);
  // The layer's x axis along the edge the handle is on, or between the two for a side edge.
  const axisX = sideY < 0 ? top : sideY > 0 ? bottom : { x: top.x + bottom.x, y: top.y + bottom.y };
  const axisY = sideX < 0 ? left : sideX > 0 ? right : { x: left.x + right.x, y: left.y + right.y };
  const x = sideX * axisX.x + sideY * axisY.x;
  const y = sideX * axisX.y + sideY * axisY.y;
  return (Math.atan2(y, x) * 180) / Math.PI;
}

/** A corner of a `Quad`: its top-left, top-right, bottom-right or bottom-left. */
type CornerIndex = 0 | 1 | 2 | 3;

type CornerHandle = 'nw' | 'ne' | 'se' | 'sw';
type EdgeHandle = 'n' | 'e' | 's' | 'w';

function isCornerHandle(handle: TransformHandle): handle is CornerHandle {
  return handle.length === 2;
}

/** A corner handle's corner, then its neighbours along the layer's x and y axes. */
const CORNERS: Readonly<Record<CornerHandle, readonly [CornerIndex, CornerIndex, CornerIndex]>> = {
  nw: [0, 1, 3],
  ne: [1, 0, 2],
  se: [2, 3, 1],
  sw: [3, 2, 0],
};

/**
 * An edge handle's two corners, in the direction of the layer's axis along the edge, then
 * the opposite edge's two, the same way round.
 */
const EDGES: Readonly<
  Record<EdgeHandle, readonly [CornerIndex, CornerIndex, CornerIndex, CornerIndex]>
> = { n: [0, 1, 3, 2], e: [1, 2, 0, 3], s: [3, 2, 0, 1], w: [0, 3, 1, 2] };

/** The CSS cursor that shows what a press would do (`hit` from `hitTransform`). */
export function transformCursor(corners: Quad, hit: TransformHit | null): string {
  if (!hit) return 'default';
  switch (hit.kind) {
    case 'move':
      return 'move';
    case 'scale': {
      const step = Math.round(handleDirection(corners, hit.handle) / 45);
      return RESIZE_CURSORS[((step % 4) + 4) % 4] ?? 'move';
    }
    case 'rotate': {
      // The arrow is drawn for a south-east corner (45°); turn it to face the handle.
      const step = Math.round((handleDirection(corners, hit.handle) - 45) / 45);
      return rotateCursor((((step % 8) + 8) % 8) * 45);
    }
    case 'skew': {
      // Along the edge that slides, or for a corner, its edge along the layer's x axis.
      const { handle } = hit;
      const [from, to] = isCornerHandle(handle)
        ? [CORNERS[handle][1], CORNERS[handle][0]]
        : [EDGES[handle][0], EDGES[handle][1]];
      const p = corners[from];
      const q = corners[to];
      const step = Math.round(Math.atan2(q.y - p.y, q.x - p.x) / (Math.PI / 4));
      return skewCursor((((step % 4) + 4) % 4) * 45);
    }
    case 'distort':
      return distortCursor();
    case 'perspective':
      return perspectiveCursor();
    default:
      return assertNever(hit);
  }
}

/** `quad` with each corner mapped through `m`. */
function mapQuad(m: Affine, [p0, p1, p2, p3]: Quad): Quad {
  const map = ({ x, y }: Point): Point => {
    const [px, py] = transformPoint(m, x, y);
    return { x: px, y: py };
  };
  return [map(p0), map(p1), map(p2), map(p3)];
}

/** The inverse of either kind of transform, or null if it has none. */
function inverseOf(m: Affine | Projective): Affine | Projective | null {
  return isProjective(m) ? invertProjective(m) : invert(m);
}

/** The lengths of the box's shorter top or bottom edge, and its shorter left or right one. */
function boxLengths([topLeft, topRight, bottomRight, bottomLeft]: Quad): [number, number] {
  const length = (p: Point, q: Point) => Math.hypot(q.x - p.x, q.y - p.y);
  return [
    Math.min(length(topLeft, topRight), length(bottomLeft, bottomRight)),
    Math.min(length(topLeft, bottomLeft), length(topRight, bottomRight)),
  ];
}

/**
 * A scale factor for an edge `length` pixels long that keeps it at least a pixel long,
 * keeping its sign (1 if it isn't finite).
 */
function clampRatio(ratio: number, length: number): number {
  if (!Number.isFinite(ratio)) return 1;
  const min = 1 / length;
  if (Math.abs(ratio) >= min) return ratio;
  return (Math.sign(ratio) || 1) * min;
}

/** A scale factor kept at least one pixel across the layer's `size`, keeping its sign. */
function clampScale(scale: number, size: number, fallback: number): number {
  if (!Number.isFinite(scale)) return fallback;
  const min = 1 / size;
  if (Math.abs(scale) >= min) return scale;
  return (Math.sign(scale) || Math.sign(fallback) || 1) * min;
}

/** How close a corner of `quad` comes to the line through its neighbours, either way round. */
function quadClearance(quad: Quad): number {
  return Math.max(clearance(quad, 1), clearance(quad, -1));
}

/**
 * Whether a box in perspective (`m` projective) scaled by `ratioX`, `ratioY` about
 * `anchorX`, `anchorY` on the layer keeps its shape: in front of its horizon, and convex
 * either way round (a flip turns it over), its corners at least `margin` from the lines
 * through their neighbours.
 */
function keepsShape(
  source: Rect,
  m: Projective,
  [ratioX, ratioY]: readonly [number, number],
  anchorX: number,
  anchorY: number,
  margin: number,
): boolean {
  const scaled = compose(m, aboutPivot(scaling(ratioX, ratioY), anchorX, anchorY));
  // Null when the corners are either side of the horizon.
  if (!mappedBounds(scaled, source)) return false;
  return quadClearance(mapCorners(scaled, source)) >= margin;
}

export interface ScaleOptions {
  /** Keep the box's proportions: Shift, or the options bar's lock without Shift. */
  readonly proportional: boolean;
  /** Scale about the pivot (Alt) rather than the opposite handle or edge. */
  readonly fromPivot: boolean;
}

/**
 * The state after dragging `handle` from `press` to `point` (document coordinates),
 * starting from `start`. The opposite handle or edge (or with `fromPivot` the pivot)
 * stays where it is; the handle follows the pointer along the axes it moves, or with
 * `proportional` scales both axes alike. The box keeps at least a pixel each way, and
 * flips if the handle is dragged past its anchor. It scales the layer before the
 * transform, so the box keeps its shape: a box in perspective stays in perspective, and
 * its handle goes only as far towards the pointer as the box stays convex and in front of
 * its horizon (`keepsShape`).
 */
export function scaleState(
  source: Rect,
  start: TransformState,
  handle: TransformHandle,
  press: Point,
  point: Point,
  { proportional, fromPivot }: ScaleOptions,
): TransformState {
  const m = boxTransform(source, start);
  const inverse = inverseOf(m);
  if (!inverse) return start;
  const [sideX, sideY] = HANDLE_SIDES[handle];
  const centre = sourceCentre(source);
  // The handle and the point that stays put, on the layer before the transform.
  const handleX = centre.x + (sideX * source.width) / 2;
  const handleY = centre.y + (sideY * source.height) / 2;
  const anchorX = fromPivot ? centre.x : centre.x - (sideX * source.width) / 2;
  const anchorY = fromPivot ? centre.y : centre.y - (sideY * source.height) / 2;
  const corner = sideX !== 0 && sideY !== 0;
  const [lengthX, lengthY] = boxLengths(start.corners);
  // The handle follows the pointer on the canvas.
  const [fromX, fromY] = mapPoint(m, handleX, handleY);
  /** The ratios that take the handle to `targetX`, `targetY` on the canvas. */
  const ratiosTo = (targetX: number, targetY: number): [number, number] => {
    let toX = targetX;
    let toY = targetY;
    if (proportional && corner) {
      // Along the line from the anchor through the handle, as the canvas shows it.
      const [ax, ay] = mapPoint(m, anchorX, anchorY);
      const ux = fromX - ax;
      const uy = fromY - ay;
      const k = ((toX - ax) * ux + (toY - ay) * uy) / (ux * ux + uy * uy);
      toX = ax + k * ux;
      toY = ay + k * uy;
    }
    const [x, y] = mapPoint(inverse, toX, toY);
    let ratioX = sideX !== 0 ? (x - anchorX) / (handleX - anchorX) : 1;
    let ratioY = sideY !== 0 ? (y - anchorY) / (handleY - anchorY) : 1;
    if (proportional) {
      let ratio: number;
      if (corner) {
        const dx = handleX - anchorX;
        const dy = handleY - anchorY;
        ratio = ((x - anchorX) * dx + (y - anchorY) * dy) / (dx * dx + dy * dy);
      } else {
        ratio = sideX !== 0 ? ratioX : ratioY;
      }
      ratioX = ratio;
      ratioY = ratio;
    }
    return [clampRatio(ratioX, lengthX), clampRatio(ratioY, lengthY)];
  };
  const endX = fromX + point.x - press.x;
  const endY = fromY + point.y - press.y;
  let [ratioX, ratioY] = ratiosTo(endX, endY);
  if (isProjective(m)) {
    // Past its horizon the pointer has no place on the layer, and towards it the far edge
    // shrinks to a point: stop where the box would lose its shape, along the pointer's path.
    const margin = Math.min(MIN_CLEARANCE, quadClearance(start.corners));
    const along = (t: number) => ratiosTo(fromX + t * (endX - fromX), fromY + t * (endY - fromY));
    const fits = (ratios: readonly [number, number]) =>
      keepsShape(source, m, ratios, anchorX, anchorY, margin);
    if (!fits([ratioX, ratioY])) {
      let low = 0;
      let high = 1;
      for (let i = 0; i < 40; i++) {
        const middle = (low + high) / 2;
        if (fits(along(middle))) low = middle;
        else high = middle;
      }
      [ratioX, ratioY] = along(low);
    }
  }
  const next = compose(m, aboutPivot(scaling(ratioX, ratioY), anchorX, anchorY));
  const [pivotX, pivotY] = mapPoint(next, centre.x, centre.y);
  return {
    corners: mapCorners(next, source),
    pivot: fromPivot ? start.pivot : { x: pivotX, y: pivotY },
    angle: start.angle,
  };
}

/** `state` turned about its pivot until the options bar reads `angle` degrees. */
function turnState(state: TransformState, angle: number): TransformState {
  const { pivot } = state;
  const turn = aboutPivot(rotation(angle - state.angle), pivot.x, pivot.y);
  return { corners: mapQuad(turn, state.corners), pivot, angle: normalizeAngle(angle) };
}

/**
 * The state after turning the box about its pivot by the angle the pointer swept from
 * `press` to `point`. With `snap` the angle itself goes to a multiple of `ROTATE_SNAP`.
 */
export function rotateState(
  start: TransformState,
  press: Point,
  point: Point,
  snap: boolean,
): TransformState {
  const { pivot } = start;
  if (Math.hypot(press.x - pivot.x, press.y - pivot.y) < 1e-9) return start;
  const from = Math.atan2(press.y - pivot.y, press.x - pivot.x);
  const to = Math.atan2(point.y - pivot.y, point.x - pivot.x);
  let angle = start.angle + ((to - from) * 180) / Math.PI;
  if (snap) angle = Math.round(angle / ROTATE_SNAP) * ROTATE_SNAP;
  return turnState(start, angle);
}

/** The state with the box and its pivot moved by `dx`, `dy`. */
export function translateState(state: TransformState, dx: number, dy: number): TransformState {
  if (dx === 0 && dy === 0) return state;
  const move = (p: Point): Point => ({ x: p.x + dx, y: p.y + dy });
  const [p0, p1, p2, p3] = state.corners;
  return {
    corners: [move(p0), move(p1), move(p2), move(p3)],
    pivot: move(state.pivot),
    angle: state.angle,
  };
}

/**
 * The state after dragging the box from `press` to `point`, by whole pixels. With
 * `constrain` (Shift) it keeps to the axis it has moved furthest along.
 */
export function moveState(
  start: TransformState,
  press: Point,
  point: Point,
  constrain: boolean,
): TransformState {
  let dx = Math.round(point.x - press.x);
  let dy = Math.round(point.y - press.y);
  if (constrain) {
    if (Math.abs(dx) >= Math.abs(dy)) dy = 0;
    else dx = 0;
  }
  return translateState(start, dx, dy);
}

/** Corner `i` of `quad`, counting round from the top-left either way. */
function cornerAt(quad: Quad, i: number): Point {
  return quad[(((i % 4) + 4) % 4) as CornerIndex];
}

/** Which way round a box's corners go: the sign of its area, 1 or −1, or 0 if it has none. */
function turning(quad: Quad): number {
  let area = 0;
  for (let i = 0; i < 4; i++) {
    const p = cornerAt(quad, i);
    const q = cornerAt(quad, i + 1);
    area += p.x * q.y - q.x * p.y;
  }
  return Math.sign(area) || 0;
}

/**
 * How far the corners of a box going round `sign`'s way (see `turning`) stand out from
 * the lines through their neighbours, the diagonals they'd fold across: the least of the
 * four, in document pixels. Positive while the box is convex.
 */
function clearance(quad: Quad, sign: number): number {
  let least = Infinity;
  for (let i = 0; i < 4; i++) {
    const p = cornerAt(quad, i - 1);
    const q = cornerAt(quad, i);
    const r = cornerAt(quad, i + 1);
    const dx = r.x - p.x;
    const dy = r.y - p.y;
    const length = Math.hypot(dx, dy);
    if (!(length > 0)) return -Infinity;
    least = Math.min(least, (sign * ((q.x - p.x) * dy - (q.y - p.y) * dx)) / length);
  }
  return least;
}

/**
 * The largest fraction of a change, up to all of it, that leaves the box going round
 * `sign`'s way with a clearance of at least `margin`; `at(t)` is the box after fraction t.
 * Corners moving along one direction turn the box linearly in t, so what's allowed is one
 * stretch from 0, which halving finds.
 */
function allowedFraction(at: (t: number) => Quad, sign: number, margin: number): number {
  if (clearance(at(1), sign) >= margin) return 1;
  let low = 0;
  let high = 1;
  for (let i = 0; i < 40; i++) {
    const middle = (low + high) / 2;
    if (clearance(at(middle), sign) >= margin) low = middle;
    else high = middle;
  }
  return low;
}

/**
 * Where the box's diagonals cross, which is where the layer's centre goes whatever
 * transform takes its bounds to the box: the pivot. Null if they don't cross at a point.
 */
function diagonalsCross([topLeft, topRight, bottomRight, bottomLeft]: Quad): Point | null {
  if (isParallelogram([topLeft, topRight, bottomRight, bottomLeft])) {
    return { x: (topLeft.x + bottomRight.x) / 2, y: (topLeft.y + bottomRight.y) / 2 };
  }
  // topLeft + s (bottomRight − topLeft) = topRight + u (bottomLeft − topRight)
  const ax = bottomRight.x - topLeft.x;
  const ay = bottomRight.y - topLeft.y;
  const bx = bottomLeft.x - topRight.x;
  const by = bottomLeft.y - topRight.y;
  const denominator = ax * by - ay * bx;
  if (!(Math.abs(denominator) > 0)) return null;
  const s = ((topRight.x - topLeft.x) * by - (topRight.y - topLeft.y) * bx) / denominator;
  return { x: topLeft.x + s * ax, y: topLeft.y + s * ay };
}

/** `start` with its box's corners at `corners`, the pivot where their diagonals cross. */
function withCorners(start: TransformState, corners: Quad): TransformState {
  if (!isConvexQuad(corners)) return start;
  return { corners, pivot: diagonalsCross(corners) ?? start.pivot, angle: start.angle };
}

/** A corner of the box moved by an offset, in document pixels. */
interface CornerMove {
  readonly corner: CornerIndex;
  readonly dx: number;
  readonly dy: number;
}

/** `quad` with the corners in `moves` moved by `t` times their offsets. */
function movedCorners(quad: Quad, moves: readonly CornerMove[], t: number): Quad {
  const moved: [Point, Point, Point, Point] = [...quad];
  for (const { corner, dx, dy } of moves) {
    const p = quad[corner];
    moved[corner] = { x: p.x + t * dx, y: p.y + t * dy };
  }
  return moved;
}

/**
 * `start` with corners moved by their offsets in `moves`, or as much of the way as keeps
 * the box convex, each corner at least `MIN_CLEARANCE` from the line through its
 * neighbours (or no closer than it was).
 */
function movedState(start: TransformState, moves: readonly CornerMove[]): TransformState {
  const { corners } = start;
  const sign = turning(corners);
  const margin = Math.min(MIN_CLEARANCE, clearance(corners, sign));
  if (!sign || !(margin > 0)) return start;
  const t = allowedFraction((t) => movedCorners(corners, moves, t), sign, margin);
  return t > 0 ? withCorners(start, movedCorners(corners, moves, t)) : start;
}

/** The allowed side of a line: where `nx·x + ny·y + c ≥ 0`, (nx, ny) a unit vector. */
interface HalfPlane {
  readonly nx: number;
  readonly ny: number;
  readonly c: number;
}

/**
 * Where a corner may go beside the line from `from` to `to`: on the side `sign` gives, at
 * least `MIN_CLEARANCE` from it, or no closer than `corner` is now.
 */
function sideOf(from: Point, to: Point, sign: number, corner: Point): HalfPlane {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const length = Math.hypot(dx, dy);
  const nx = (sign * dy) / length;
  const ny = (-sign * dx) / length;
  const c = -(nx * from.x + ny * from.y);
  const margin = Math.min(MIN_CLEARANCE, nx * corner.x + ny * corner.y + c);
  return { nx, ny, c: c - margin };
}

/** The point nearest `target` on the allowed side of all three lines, or null if none is. */
function nearestAllowed(
  target: Point,
  planes: readonly [HalfPlane, HalfPlane, HalfPlane],
): Point | null {
  const value = (plane: HalfPlane, p: Point) => plane.nx * p.x + plane.ny * p.y + plane.c;
  const allowed = (p: Point) => planes.every((plane) => value(plane, p) >= -1e-9);
  if (allowed(target)) return target;
  // The nearest allowed point is on a line, nearest the target, or where two lines meet.
  const candidates: Point[] = [];
  for (const plane of planes) {
    const v = value(plane, target);
    candidates.push({ x: target.x - v * plane.nx, y: target.y - v * plane.ny });
  }
  const [a, b, c] = planes;
  for (const [p, q] of [
    [a, b],
    [b, c],
    [a, c],
  ] as const) {
    const det = p.nx * q.ny - p.ny * q.nx;
    if (Math.abs(det) < 1e-12) continue;
    candidates.push({ x: (p.ny * q.c - p.c * q.ny) / det, y: (p.c * q.nx - p.nx * q.c) / det });
  }
  let nearest: Point | null = null;
  let distance = Infinity;
  for (const p of candidates) {
    const d = Math.hypot(p.x - target.x, p.y - target.y);
    if (d < distance && allowed(p)) {
      nearest = p;
      distance = d;
    }
  }
  return nearest;
}

/**
 * The state after dragging `handle` from `press` to `point` to distort the box: a corner
 * follows the pointer on its own, or an edge's two corners follow it together. A corner
 * mustn't cross the line through its neighbours, nor go round past the lines through the
 * edges beyond them, so it stops at the nearest point that keeps the box convex, at least
 * `MIN_CLEARANCE` from each line; an edge just stops.
 */
export function distortState(
  start: TransformState,
  handle: TransformHandle,
  press: Point,
  point: Point,
): TransformState {
  const dx = point.x - press.x;
  const dy = point.y - press.y;
  if (!isCornerHandle(handle)) {
    const [from, to] = EDGES[handle];
    return movedState(start, [
      { corner: from, dx, dy },
      { corner: to, dx, dy },
    ]);
  }
  const { corners } = start;
  const sign = turning(corners);
  if (!sign) return start;
  const i = CORNERS[handle][0];
  const corner = corners[i];
  const before = cornerAt(corners, i - 1);
  const after = cornerAt(corners, i + 1);
  const opposite = cornerAt(corners, i + 2);
  const target = nearestAllowed({ x: corner.x + dx, y: corner.y + dy }, [
    sideOf(before, after, sign, corner),
    sideOf(opposite, after, sign, corner),
    sideOf(opposite, before, -sign, corner),
  ]);
  if (!target) return start;
  const moved: [Point, Point, Point, Point] = [...corners];
  moved[i] = target;
  return withCorners(start, moved);
}

/**
 * How far a drag (`dx`, `dy`) goes along corner `corner`'s edges, from its neighbours
 * `alongX` and `alongY` towards it: the edge it goes further along, as that neighbour, a
 * unit vector and the distance. Null if the edges are in line.
 */
function alongEdge(
  corners: Quad,
  [corner, alongX, alongY]: readonly [CornerIndex, CornerIndex, CornerIndex],
  dx: number,
  dy: number,
): { neighbour: CornerIndex; ux: number; uy: number; t: number } | null {
  const p = corners[corner];
  const ex = unit(corners[alongX], p);
  const ey = unit(corners[alongY], p);
  const det = ex.x * ey.y - ex.y * ey.x;
  if (!(Math.abs(det) > 1e-12)) return null;
  // (dx, dy) = a·ex + b·ey
  const a = (dx * ey.y - dy * ey.x) / det;
  const b = (ex.x * dy - ex.y * dx) / det;
  return Math.abs(a) >= Math.abs(b)
    ? { neighbour: alongX, ux: ex.x, uy: ex.y, t: a }
    : { neighbour: alongY, ux: ey.x, uy: ey.y, t: b };
}

/**
 * The state after dragging `handle` from `press` to `point` to skew the box. An edge
 * slides along itself as far as the pointer goes along it, the opposite edge staying put,
 * or with `symmetric` (Alt) sliding the other way. A corner slides on its own along
 * whichever of its edges the drag goes further along. Either stops where the box would
 * stop being convex, as `distortState`'s corners do.
 */
export function skewState(
  start: TransformState,
  handle: TransformHandle,
  press: Point,
  point: Point,
  symmetric: boolean,
): TransformState {
  const { corners } = start;
  const dx = point.x - press.x;
  const dy = point.y - press.y;
  if (isCornerHandle(handle)) {
    const along = alongEdge(corners, CORNERS[handle], dx, dy);
    if (!along) return start;
    const { ux, uy, t } = along;
    return movedState(start, [{ corner: CORNERS[handle][0], dx: t * ux, dy: t * uy }]);
  }
  const [from, to, oppositeFrom, oppositeTo] = EDGES[handle];
  const u = unit(corners[from], corners[to]);
  const t = dx * u.x + dy * u.y;
  const moves: CornerMove[] = [
    { corner: from, dx: t * u.x, dy: t * u.y },
    { corner: to, dx: t * u.x, dy: t * u.y },
  ];
  if (symmetric) {
    const v = unit(corners[oppositeFrom], corners[oppositeTo]);
    moves.push(
      { corner: oppositeFrom, dx: -t * v.x, dy: -t * v.y },
      { corner: oppositeTo, dx: -t * v.x, dy: -t * v.y },
    );
  }
  return movedState(start, moves);
}

/**
 * The state after dragging corner `handle` from `press` to `point` to put the box in
 * perspective: the corner slides along whichever of its edges the drag goes further
 * along, and that edge's other corner the same distance the opposite way, so the edge
 * grows or shrinks about its middle, as far as the box stays convex. An edge skews.
 */
export function perspectiveState(
  start: TransformState,
  handle: TransformHandle,
  press: Point,
  point: Point,
): TransformState {
  if (!isCornerHandle(handle)) return skewState(start, handle, press, point, false);
  const along = alongEdge(start.corners, CORNERS[handle], point.x - press.x, point.y - press.y);
  if (!along) return start;
  const { neighbour, ux, uy, t } = along;
  return movedState(start, [
    { corner: CORNERS[handle][0], dx: t * ux, dy: t * uy },
    { corner: neighbour, dx: -t * ux, dy: -t * uy },
  ]);
}

/**
 * The state after a flip or turn of the transformed layer about its pivot, as the canvas
 * sees it: Flip Horizontal mirrors it left to right on screen whatever its angle.
 */
export function orientState(state: TransformState, orientation: Orientation): TransformState {
  let m: Affine;
  let angle: number;
  switch (orientation) {
    case 'flip-horizontal':
      m = scaling(-1, 1);
      angle = -state.angle;
      break;
    case 'flip-vertical':
      m = scaling(1, -1);
      angle = -state.angle;
      break;
    case 'rotate-180':
      m = rotation(180);
      angle = state.angle + 180;
      break;
    case 'rotate-cw':
      m = rotation(90);
      angle = state.angle + 90;
      break;
    case 'rotate-ccw':
      m = rotation(-90);
      angle = state.angle - 90;
      break;
    default:
      return assertNever(orientation);
  }
  const { pivot } = state;
  return {
    corners: mapQuad(aboutPivot(m, pivot.x, pivot.y), state.corners),
    pivot,
    angle: normalizeAngle(angle),
  };
}

/** How the options bar shows the width and height: in pixels or as a percentage. */
export type TransformUnit = 'px' | 'percent';

/**
 * The options bar's fields: the pivot's position, the size (signed: negative flips), the
 * angle and the skews. A box that isn't a parallelogram has no angle or skew: null.
 */
export interface TransformFields {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly angle: number | null;
  /** Horizontal skew in degrees: the left and right edges lean clockwise. */
  readonly skewX: number | null;
  /** Vertical skew in degrees: the top and bottom edges lean clockwise. */
  readonly skewY: number | null;
}

export type TransformField = keyof TransformFields;

/** The size of the box's bounding rect. */
function boundingSize(corners: Quad): { width: number; height: number } {
  const xs = corners.map((p) => p.x);
  const ys = corners.map((p) => p.y);
  return {
    width: Math.max(...xs) - Math.min(...xs),
    height: Math.max(...ys) - Math.min(...ys),
  };
}

/**
 * What the options bar shows for `state` on the layer covering `source`. A box that isn't a
 * parallelogram has no size along the layer's axes, so it shows its bounding rect's, and
 * no angle or skew.
 */
export function transformFields(
  source: Rect,
  state: TransformState,
  unit: TransformUnit,
): TransformFields {
  const params = stateParams(source, state);
  const { x, y } = params ?? state.pivot;
  let width: number;
  let height: number;
  if (params) {
    [width, height] =
      unit === 'px'
        ? [params.scaleX * source.width, params.scaleY * source.height]
        : [params.scaleX * 100, params.scaleY * 100];
  } else {
    const box = boundingSize(state.corners);
    [width, height] =
      unit === 'px'
        ? [box.width, box.height]
        : [(box.width / source.width) * 100, (box.height / source.height) * 100];
  }
  return {
    x,
    y,
    width,
    height,
    angle: params ? state.angle : null,
    skewX: params ? params.skewX : null,
    skewY: params ? params.skewY : null,
  };
}

/**
 * The state with one options-bar field set to `value`, or null if it can't be: not a
 * finite number, a position past ±`MAX_FIELD_VALUE`, or a size under 1 or over
 * `MAX_FIELD_VALUE` pixels. A size scales about the pivot; with `lockAspect` the other
 * side follows, keeping the proportions and its own sign. A box that isn't a
 * parallelogram scales its bounding rect, on the canvas's axes, and can't be flipped so,
 * nor turned or skewed. A skew must be under 90° and keep the box from folding over or
 * growing past `MAX_FIELD_VALUE`.
 */
export function withField(
  source: Rect,
  state: TransformState,
  field: TransformField,
  value: number,
  unit: TransformUnit,
  lockAspect: boolean,
): TransformState | null {
  if (!Number.isFinite(value)) return null;
  switch (field) {
    case 'x':
    case 'y': {
      if (Math.abs(value) > MAX_FIELD_VALUE) return null;
      const { pivot } = state;
      const horizontal = field === 'x';
      const moved = translateState(
        state,
        horizontal ? value - pivot.x : 0,
        horizontal ? 0 : value - pivot.y,
      );
      return { ...moved, pivot: horizontal ? { x: value, y: pivot.y } : { x: pivot.x, y: value } };
    }
    case 'angle':
      return stateParams(source, state) ? turnState(state, value) : null;
    case 'skewX':
    case 'skewY': {
      const params = stateParams(source, state);
      if (!params || !(Math.abs(value) < 90)) return null;
      const next = stateFromParams(
        source,
        field === 'skewX' ? { ...params, skewX: value } : { ...params, skewY: value },
      );
      const box = boundingSize(next.corners);
      if (
        !isConvexQuad(next.corners) ||
        turning(next.corners) !== turning(state.corners) ||
        !(box.width <= MAX_FIELD_VALUE && box.height <= MAX_FIELD_VALUE)
      ) {
        return null;
      }
      return next;
    }
    case 'width':
    case 'height': {
      const horizontal = field === 'width';
      const size = horizontal ? source.width : source.height;
      const scale = unit === 'px' ? value / size : value / 100;
      const pixels = Math.abs(scale * size);
      if (pixels < 1 || pixels > MAX_FIELD_VALUE) return null;
      const params = stateParams(source, state);
      if (!params) return scaleBoundingBox(state, horizontal, pixels, value, lockAspect);
      const [changed, other] = horizontal
        ? [params.scaleX, params.scaleY]
        : [params.scaleY, params.scaleX];
      let follower = other;
      if (lockAspect) {
        const otherSize = horizontal ? source.height : source.width;
        const ratio = Math.abs(other / changed);
        follower = clampScale(Math.sign(other) * Math.abs(scale) * ratio, otherSize, other);
      }
      const [scaleX, scaleY] = horizontal ? [scale, follower] : [follower, scale];
      return stateFromParams(source, { ...params, scaleX, scaleY });
    }
    default:
      return assertNever(field);
  }
}

/**
 * A box that isn't a parallelogram scaled about its pivot on the canvas's axes, so that its
 * bounding rect is `pixels` wide (or high); with `lockAspect` both ways alike. Null for a
 * negative `value`, which would flip it, or a result under a pixel or too large.
 */
function scaleBoundingBox(
  state: TransformState,
  horizontal: boolean,
  pixels: number,
  value: number,
  lockAspect: boolean,
): TransformState | null {
  if (value < 0) return null;
  const box = boundingSize(state.corners);
  const ratio = pixels / (horizontal ? box.width : box.height);
  const ratioX = horizontal || lockAspect ? ratio : 1;
  const ratioY = !horizontal || lockAspect ? ratio : 1;
  const [width, height] = [box.width * ratioX, box.height * ratioY];
  if (!(width >= 1 && height >= 1 && width <= MAX_FIELD_VALUE && height <= MAX_FIELD_VALUE)) {
    return null;
  }
  const { pivot } = state;
  const m = aboutPivot(scaling(ratioX, ratioY), pivot.x, pivot.y);
  return { corners: mapQuad(m, state.corners), pivot, angle: state.angle };
}

/** How the options bar shows a field's value: to two decimal places at most. */
export function fieldText(value: number): string {
  return String(Math.round(value * 100) / 100 || 0);
}

/** The number typed into an options-bar field, or null if it isn't one. */
export function parseFieldText(text: string): number | null {
  if (text.trim() === '') return null;
  const value = Number(text);
  return Number.isFinite(value) ? value : null;
}
