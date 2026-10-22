import type { Affine, Orientation, Point, Projective, Quad, Rect } from '../../core';
import {
  aboutPivot,
  alignToPixels,
  assertNever,
  compose,
  homographyFromQuad,
  invert,
  invertProjective,
  isProjective,
  mapCorners,
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

/**
 * Free Transform itself, or Edit → Transform → Scale or Rotate, which only scale (no
 * rotate zone) or only rotate (handles and the outside rotate). All three move from inside.
 */
export type TransformMode = 'free' | 'scale' | 'rotate';

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
 * and `scaleY` along its own axes (negative flips it), turned `angle` degrees clockwise,
 * both about its centre, and that centre (the pivot) put at `x`, `y` in document
 * coordinates.
 */
export interface TransformParams {
  readonly x: number;
  readonly y: number;
  readonly scaleX: number;
  readonly scaleY: number;
  /** Degrees clockwise, in (−180, 180]. */
  readonly angle: number;
}

/**
 * A handle on the transform box, named for where it is on the layer before the transform
 * (so a flipped layer's 'e' handle is on the left): corners scale both axes, edges one.
 */
export type TransformHandle = CropHandle;

/** What a press on the transform box does: scale from a handle, rotate, or move it. */
export type TransformHit =
  | { readonly kind: 'scale'; readonly handle: TransformHandle }
  | { readonly kind: 'rotate'; readonly handle: TransformHandle }
  | { readonly kind: 'move' };

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

/** The layer's centre, which its transform turns and scales about. */
export function sourceCentre(source: Rect): Point {
  return { x: source.x + source.width / 2, y: source.y + source.height / 2 };
}

/** The params that leave the layer `source` covers where it is. */
export function identityParams(source: Rect): TransformParams {
  const { x, y } = sourceCentre(source);
  return { x, y, scaleX: 1, scaleY: 1, angle: 0 };
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
 * The state `params` describe for the layer covering `source`: its bounds scaled and
 * turned about its centre, and moved to put the centre at the pivot.
 */
export function stateFromParams(source: Rect, params: TransformParams): TransformState {
  const centre = sourceCentre(source);
  const m = multiply(
    translation(params.x, params.y),
    multiply(
      rotation(params.angle),
      multiply(scaling(params.scaleX, params.scaleY), translation(-centre.x, -centre.y)),
    ),
  );
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
 * How the options bar reads `state`: its size along the layer's own axes, turned by its
 * angle, or null if the box isn't a parallelogram.
 */
export function stateParams(source: Rect, state: TransformState): TransformParams | null {
  if (!isParallelogram(state.corners)) return null;
  const [scaleX, , , scaleY] = multiply(rotation(-state.angle), stateAffine(source, state));
  return {
    x: tidy(state.pivot.x),
    y: tidy(state.pivot.y),
    scaleX: tidy(scaleX),
    scaleY: tidy(scaleY),
    angle: state.angle,
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

/**
 * What a press at `point` does to the transform box with `corners` (as `TransformOverlay`
 * has them), or null if nothing. Edges reach `HANDLE_REACH` CSS pixels outwards, but at
 * most a third of the box inwards, as the crop box's do; in Free Transform a press up to
 * `ROTATE_REACH` further out round a corner rotates. In 'rotate' mode the handles and
 * everything outside rotate, and in 'scale' mode nothing outside the handles does.
 */
export function hitTransform(
  corners: Quad,
  point: Point,
  zoom: number,
  mode: TransformMode,
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
    return { kind: mode === 'rotate' ? 'rotate' : 'scale', handle };
  }
  if (mode === 'scale') return null;
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
    default:
      return assertNever(hit);
  }
}

const rotateCursors = new Map<number, string>();

/**
 * A curved double arrow, bent round a south-east corner and turned `degrees` clockwise
 * about the middle of its 24 px square: black with a white edge, so it shows on any colour.
 */
export function rotateCursor(degrees: number): string {
  let cursor = rotateCursors.get(degrees);
  if (cursor) return cursor;
  const arc = 'M13.97 5.78A9 9 0 0 1 5.78 13.97';
  const heads = 'M14.32 1.8L17.46 6.08L10.48 5.48ZM1.8 14.32L6.09 17.46L5.48 10.48Z';
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24">` +
    `<g transform="rotate(${degrees} 12 12)" stroke-linejoin="round">` +
    `<path d="${arc}" fill="none" stroke="white" stroke-width="4"/>` +
    `<path d="${heads}" fill="white" stroke="white" stroke-width="2.5"/>` +
    `<path d="${arc}" fill="none" stroke="black" stroke-width="1.5"/>` +
    `<path d="${heads}" fill="black"/></g></svg>`;
  // The hot spot is the middle of the arc, (11.36, 11.36) before the turn.
  const [hx, hy] = transformPoint(
    multiply(translation(12, 12), multiply(rotation(degrees), translation(-12, -12))),
    11.36,
    11.36,
  );
  cursor = `url("data:image/svg+xml,${encodeURIComponent(svg)}") ${Math.round(hx)} ${Math.round(hy)}, default`;
  rotateCursors.set(degrees, cursor);
  return cursor;
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
 * transform, so the box keeps its shape: a distorted box stays in perspective.
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
  // The handle follows the pointer on the canvas.
  const [fromX, fromY] = mapPoint(m, handleX, handleY);
  let toX = fromX + point.x - press.x;
  let toY = fromY + point.y - press.y;
  const corner = sideX !== 0 && sideY !== 0;
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
  const [lengthX, lengthY] = boxLengths(start.corners);
  ratioX = clampRatio(ratioX, lengthX);
  ratioY = clampRatio(ratioY, lengthY);
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

/** The options bar's fields: the pivot's position, the size (signed: negative flips) and angle. */
export interface TransformFields {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly angle: number;
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
 * parallelogram has no size along the layer's axes: it shows its bounding rect's.
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
  return { x, y, width, height, angle: state.angle };
}

/**
 * The state with one options-bar field set to `value`, or null if it can't be: not a
 * finite number, a position past ±`MAX_FIELD_VALUE`, or a size under 1 or over
 * `MAX_FIELD_VALUE` pixels. A size scales about the pivot; with `lockAspect` the other
 * side follows, keeping the proportions and its own sign. A box that isn't a
 * parallelogram scales its bounding rect, on the canvas's axes, and can't be flipped so.
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
      return turnState(state, value);
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
