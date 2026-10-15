import type { Affine, Orientation, Point, Rect } from '../../core';
import {
  alignToPixels,
  assertNever,
  multiply,
  rotation,
  scaling,
  transformPoint,
  translation,
} from '../../core';
import type { CropHandle } from '../tools/crop-geometry';
import { HANDLE_GRID, HANDLE_REACH, HANDLE_SIDES, sideOf } from '../tools/crop-geometry';

/**
 * Free Transform itself, or Edit → Transform → Scale or Rotate, which only scale (no
 * rotate zone) or only rotate (handles and the outside rotate). All three move from inside.
 */
export type TransformMode = 'free' | 'scale' | 'rotate';

/**
 * What a Free Transform session does to its layer. The layer is scaled by `scaleX` and
 * `scaleY` along its own axes (negative flips it), turned `angle` degrees clockwise, both
 * about its centre, and that centre (the pivot) is put at `x`, `y` in document
 * coordinates. Sessions rebuild their transform from these each time, so nothing drifts.
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

/** The layer's centre, which its transform turns and scales about. */
export function sourceCentre(source: Rect): Point {
  return { x: source.x + source.width / 2, y: source.y + source.height / 2 };
}

/** The params that leave the layer `source` covers where it is. */
export function identityParams(source: Rect): TransformParams {
  const { x, y } = sourceCentre(source);
  return { x, y, scaleX: 1, scaleY: 1, angle: 0 };
}

/** An angle in degrees, brought into (−180, 180]. */
export function normalizeAngle(degrees: number): number {
  let angle = degrees % 360;
  if (angle <= -180) angle += 360;
  else if (angle > 180) angle -= 360;
  return angle || 0;
}

/** True for whole turns and flips at the layer's size, which move pixels without resampling. */
export function isLossless(params: TransformParams): boolean {
  return params.angle % 90 === 0 && Math.abs(params.scaleX) === 1 && Math.abs(params.scaleY) === 1;
}

/**
 * The transform `params` describe for the layer covering `source`, mapping canvas
 * coordinates to canvas coordinates as `TransformLayerCommand` takes them. Lossless ones
 * are shifted by at most half a pixel onto the pixel grid, so they copy pixels exactly.
 */
export function transformAffine(source: Rect, params: TransformParams): Affine {
  const centre = sourceCentre(source);
  const m = multiply(
    translation(params.x, params.y),
    multiply(
      rotation(params.angle),
      multiply(scaling(params.scaleX, params.scaleY), translation(-centre.x, -centre.y)),
    ),
  );
  return isLossless(params) ? alignToPixels(m, source) : m;
}

/** True when `m` leaves everything where it is, give or take rounding noise. */
export function isIdentity(m: Affine): boolean {
  const [a, b, c, d, e, f] = m;
  const near = (value: number, target: number) => Math.abs(value - target) < 1e-9;
  return near(a, 1) && near(b, 0) && near(c, 0) && near(d, 1) && near(e, 0) && near(f, 0);
}

/** Where the layer's top-left, top-right, bottom-right and bottom-left corners go. */
export function transformCorners(source: Rect, m: Affine): [Point, Point, Point, Point] {
  const right = source.x + source.width;
  const bottom = source.y + source.height;
  const corner = (x: number, y: number): Point => {
    const [px, py] = transformPoint(m, x, y);
    return { x: px, y: py };
  };
  return [
    corner(source.x, source.y),
    corner(right, source.y),
    corner(right, bottom),
    corner(source.x, bottom),
  ];
}

/**
 * The transformed box's frame: its top-left corner, unit vectors along the layer's own x
 * and y axes as transformed, and its length along each. The box never shears, so the axes
 * stay perpendicular.
 */
function boxFrame(source: Rect, m: Affine) {
  const [topLeft, topRight, , bottomLeft] = transformCorners(source, m);
  const lengthX = Math.hypot(topRight.x - topLeft.x, topRight.y - topLeft.y);
  const lengthY = Math.hypot(bottomLeft.x - topLeft.x, bottomLeft.y - topLeft.y);
  return {
    origin: topLeft,
    axisX: { x: (topRight.x - topLeft.x) / lengthX, y: (topRight.y - topLeft.y) / lengthX },
    axisY: { x: (bottomLeft.x - topLeft.x) / lengthY, y: (bottomLeft.y - topLeft.y) / lengthY },
    lengthX,
    lengthY,
  };
}

/**
 * What a press at `point` does to the box of the layer covering `source` transformed by
 * `m`, or null if nothing. Edges reach `HANDLE_REACH` CSS pixels outwards, but at most a
 * third of the box inwards, as the crop box's do; in Free Transform a press up to
 * `ROTATE_REACH` further out round a corner rotates. In 'rotate' mode the handles and
 * everything outside rotate, and in 'scale' mode nothing outside the handles does.
 */
export function hitTransform(
  source: Rect,
  m: Affine,
  point: Point,
  zoom: number,
  mode: TransformMode,
): TransformHit | null {
  const frame = boxFrame(source, m);
  const dx = point.x - frame.origin.x;
  const dy = point.y - frame.origin.y;
  // The point's distance along each axis of the box, in document pixels.
  const along = dx * frame.axisX.x + dy * frame.axisX.y;
  const across = dx * frame.axisY.x + dy * frame.axisY.y;
  const reach = HANDLE_REACH / zoom;
  const sideX = sideOf(along, 0, frame.lengthX, reach);
  const sideY = sideOf(across, 0, frame.lengthY, reach);
  if (sideX !== null && sideY !== null) {
    const handle = HANDLE_GRID[sideY + 1]?.[sideX + 1] ?? null;
    if (!handle) return { kind: 'move' };
    return { kind: mode === 'rotate' ? 'rotate' : 'scale', handle };
  }
  if (mode === 'scale') return null;
  // Outside the handles: the nearest point of the box tells which handle it's beyond.
  const nearX = along <= 0 ? -1 : along >= frame.lengthX ? 1 : 0;
  const nearY = across <= 0 ? -1 : across >= frame.lengthY ? 1 : 0;
  const handle = HANDLE_GRID[nearY + 1]?.[nearX + 1] ?? null;
  if (!handle) return null;
  if (mode === 'rotate') return { kind: 'rotate', handle };
  if (nearX === 0 || nearY === 0) return null;
  const cornerX = nearX < 0 ? 0 : frame.lengthX;
  const cornerY = nearY < 0 ? 0 : frame.lengthY;
  const distance = Math.hypot(along - cornerX, across - cornerY);
  return distance <= (HANDLE_REACH + ROTATE_REACH) / zoom ? { kind: 'rotate', handle } : null;
}

/** Resize cursors by the direction of a handle on screen, in steps of 45° from east. */
const RESIZE_CURSORS = ['ew-resize', 'nwse-resize', 'ns-resize', 'nesw-resize'] as const;

/**
 * The direction `handle` points in from the box's centre on screen, in degrees clockwise
 * from east: along the transformed axes, so corners point along the diagonal of the
 * axes whatever the box's shape.
 */
function handleDirection(source: Rect, m: Affine, handle: TransformHandle): number {
  const { axisX, axisY } = boxFrame(source, m);
  const [sideX, sideY] = HANDLE_SIDES[handle];
  const x = sideX * axisX.x + sideY * axisY.x;
  const y = sideX * axisX.y + sideY * axisY.y;
  return (Math.atan2(y, x) * 180) / Math.PI;
}

/** The CSS cursor that shows what a press would do (`hit` from `hitTransform`). */
export function transformCursor(source: Rect, m: Affine, hit: TransformHit | null): string {
  if (!hit) return 'default';
  switch (hit.kind) {
    case 'move':
      return 'move';
    case 'scale': {
      const step = Math.round(handleDirection(source, m, hit.handle) / 45);
      return RESIZE_CURSORS[((step % 4) + 4) % 4] ?? 'move';
    }
    case 'rotate': {
      // The arrow is drawn for a south-east corner (45°); turn it to face the handle.
      const step = Math.round((handleDirection(source, m, hit.handle) - 45) / 45);
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

/** (x, y) turned `degrees` clockwise about the origin. */
function turn(x: number, y: number, degrees: number): [number, number] {
  return transformPoint(rotation(degrees), x, y);
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
 * The params after dragging `handle` from `press` to `point` (document coordinates),
 * starting from `start`. The opposite handle or edge (or with `fromPivot` the pivot)
 * stays where it is; the handle follows the pointer along the axes it moves, or with
 * `proportional` scales both axes alike. The box keeps at least a pixel each way, and
 * flips if the handle is dragged past its anchor.
 */
export function scaleParams(
  source: Rect,
  start: TransformParams,
  handle: TransformHandle,
  press: Point,
  point: Point,
  { proportional, fromPivot }: ScaleOptions,
): TransformParams {
  const [sideX, sideY] = HANDLE_SIDES[handle];
  // The handle and the point that stays put, about the layer's centre before the transform.
  const handleX = (sideX * source.width) / 2;
  const handleY = (sideY * source.height) / 2;
  const anchorX = fromPivot ? 0 : -handleX;
  const anchorY = fromPivot ? 0 : -handleY;
  // The anchor-to-handle offset, scaled but not yet turned, before and after the drag.
  const fromX = start.scaleX * (handleX - anchorX);
  const fromY = start.scaleY * (handleY - anchorY);
  const [moveX, moveY] = turn(point.x - press.x, point.y - press.y, -start.angle);
  const toX = fromX + moveX;
  const toY = fromY + moveY;

  let scaleX = start.scaleX;
  let scaleY = start.scaleY;
  if (proportional) {
    let k: number;
    if (sideX !== 0 && sideY !== 0) k = (toX * fromX + toY * fromY) / (fromX ** 2 + fromY ** 2);
    else k = sideX !== 0 ? toX / fromX : toY / fromY;
    scaleX *= k;
    scaleY *= k;
  } else {
    if (sideX !== 0) scaleX *= toX / fromX;
    if (sideY !== 0) scaleY *= toY / fromY;
  }
  scaleX = clampScale(scaleX, source.width, start.scaleX);
  scaleY = clampScale(scaleY, source.height, start.scaleY);
  // The anchor stays put: the pivot moves by the turned change in the anchor's offset.
  const [shiftX, shiftY] = turn(
    (start.scaleX - scaleX) * anchorX,
    (start.scaleY - scaleY) * anchorY,
    start.angle,
  );
  return { ...start, x: start.x + shiftX, y: start.y + shiftY, scaleX, scaleY };
}

/**
 * The params after turning the box about its pivot by the angle the pointer swept from
 * `press` to `point`. With `snap` the angle itself goes to a multiple of `ROTATE_SNAP`.
 */
export function rotateParams(
  start: TransformParams,
  press: Point,
  point: Point,
  snap: boolean,
): TransformParams {
  if (Math.hypot(press.x - start.x, press.y - start.y) < 1e-9) return start;
  const from = Math.atan2(press.y - start.y, press.x - start.x);
  const to = Math.atan2(point.y - start.y, point.x - start.x);
  let angle = start.angle + ((to - from) * 180) / Math.PI;
  if (snap) angle = Math.round(angle / ROTATE_SNAP) * ROTATE_SNAP;
  return { ...start, angle: normalizeAngle(angle) };
}

/**
 * The params after dragging the box from `press` to `point`, by whole pixels. With
 * `constrain` (Shift) it keeps to the axis it has moved furthest along.
 */
export function moveParams(
  start: TransformParams,
  press: Point,
  point: Point,
  constrain: boolean,
): TransformParams {
  let dx = Math.round(point.x - press.x);
  let dy = Math.round(point.y - press.y);
  if (constrain) {
    if (Math.abs(dx) >= Math.abs(dy)) dy = 0;
    else dx = 0;
  }
  return { ...start, x: start.x + dx, y: start.y + dy };
}

/**
 * The params after a flip or turn of the transformed layer about its pivot, as the canvas
 * sees it: Flip Horizontal mirrors it left to right on screen whatever its angle.
 */
export function orientParams(params: TransformParams, orientation: Orientation): TransformParams {
  switch (orientation) {
    case 'flip-horizontal':
      return { ...params, scaleX: -params.scaleX, angle: normalizeAngle(-params.angle) };
    case 'flip-vertical':
      return { ...params, scaleY: -params.scaleY, angle: normalizeAngle(-params.angle) };
    case 'rotate-180':
      return { ...params, angle: normalizeAngle(params.angle + 180) };
    case 'rotate-cw':
      return { ...params, angle: normalizeAngle(params.angle + 90) };
    case 'rotate-ccw':
      return { ...params, angle: normalizeAngle(params.angle - 90) };
    default:
      return assertNever(orientation);
  }
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

/** What the options bar shows for `params` on the layer covering `source`. */
export function transformFields(
  source: Rect,
  params: TransformParams,
  unit: TransformUnit,
): TransformFields {
  const [width, height] =
    unit === 'px'
      ? [params.scaleX * source.width, params.scaleY * source.height]
      : [params.scaleX * 100, params.scaleY * 100];
  return { x: params.x, y: params.y, width, height, angle: params.angle };
}

/**
 * The params with one options-bar field set to `value`, or null if it can't be: not a
 * finite number, a position past ±`MAX_FIELD_VALUE`, or a size under 1 or over
 * `MAX_FIELD_VALUE` pixels. A size scales about the pivot; with `lockAspect` the other
 * side follows, keeping the proportions and its own sign.
 */
export function withField(
  source: Rect,
  params: TransformParams,
  field: TransformField,
  value: number,
  unit: TransformUnit,
  lockAspect: boolean,
): TransformParams | null {
  if (!Number.isFinite(value)) return null;
  switch (field) {
    case 'x':
    case 'y':
      return Math.abs(value) <= MAX_FIELD_VALUE ? { ...params, [field]: value } : null;
    case 'angle':
      return { ...params, angle: normalizeAngle(value) };
    case 'width':
    case 'height': {
      const horizontal = field === 'width';
      const size = horizontal ? source.width : source.height;
      const scale = unit === 'px' ? value / size : value / 100;
      const pixels = Math.abs(scale * size);
      if (pixels < 1 || pixels > MAX_FIELD_VALUE) return null;
      const [changed, other] = horizontal
        ? [params.scaleX, params.scaleY]
        : [params.scaleY, params.scaleX];
      let follower = other;
      if (lockAspect) {
        const otherSize = horizontal ? source.height : source.width;
        const ratio = Math.abs(other / changed);
        follower = clampScale(Math.sign(other) * Math.abs(scale) * ratio, otherSize, other);
      }
      return horizontal
        ? { ...params, scaleX: scale, scaleY: follower }
        : { ...params, scaleX: follower, scaleY: scale };
    }
    default:
      return assertNever(field);
  }
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
