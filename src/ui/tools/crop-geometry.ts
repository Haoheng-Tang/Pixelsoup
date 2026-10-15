import type { Rect } from '../../core';

/**
 * A crop box handle, named by compass direction: corners move two edges, the others one.
 * Every point along an edge grabs it, not only the drawn handle at its middle.
 */
export type CropHandle = 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w' | 'nw';

/** What a press on the crop box grabs: a handle, the inside (to move it) or nothing. */
export type CropHit = CropHandle | 'inside' | 'outside';

/** How far from a box's edge, in CSS pixels, a press still grabs it. */
export const HANDLE_REACH = 6;

/** Along one axis: the start edge (−1), the end edge (1) or neither (0). */
export type Side = -1 | 0 | 1;

/** The edges each handle moves, as (x side, y side). */
export const HANDLE_SIDES: Readonly<Record<CropHandle, readonly [Side, Side]>> = {
  n: [0, -1],
  ne: [1, -1],
  e: [1, 0],
  se: [1, 1],
  s: [0, 1],
  sw: [-1, 1],
  w: [-1, 0],
  nw: [-1, -1],
};

const HANDLE_CURSORS: Readonly<Record<CropHandle, string>> = {
  n: 'ns-resize',
  s: 'ns-resize',
  e: 'ew-resize',
  w: 'ew-resize',
  ne: 'nesw-resize',
  sw: 'nesw-resize',
  nw: 'nwse-resize',
  se: 'nwse-resize',
};

/** Handles by [y side + 1][x side + 1]; the middle is the inside. */
export const HANDLE_GRID: readonly (readonly (CropHandle | null)[])[] = [
  ['nw', 'n', 'ne'],
  ['w', null, 'e'],
  ['sw', 's', 'se'],
];

/**
 * Which edge of the span [start, end] `p` grabs, or null if it lies more than `tolerance`
 * outside the span. An edge reaches `tolerance` outwards but at most a third of the way
 * in, so even a small box keeps a middle to move it by.
 */
export function sideOf(p: number, start: number, end: number, tolerance: number): Side | null {
  if (p < start - tolerance || p > end + tolerance) return null;
  const inward = Math.min(tolerance, (end - start) / 3);
  if (p <= start + inward) return -1;
  if (p >= end - inward) return 1;
  return 0;
}

/**
 * What a press at (x, y) grabs on `box`. All in document coordinates; `tolerance` is how
 * far from an edge still grabs it (a fixed distance on screen, divided by the zoom).
 */
export function hitTest(box: Rect, x: number, y: number, tolerance: number): CropHit {
  const sx = sideOf(x, box.x, box.x + box.width, tolerance);
  const sy = sideOf(y, box.y, box.y + box.height, tolerance);
  if (sx === null || sy === null) return 'outside';
  return HANDLE_GRID[sy + 1]?.[sx + 1] ?? 'inside';
}

/** The CSS cursor that shows what a press would do. */
export function hitCursor(hit: CropHit): string {
  if (hit === 'outside') return 'crosshair';
  if (hit === 'inside') return 'move';
  return HANDLE_CURSORS[hit];
}

/**
 * Sizes as close to `ratio` (width / height) as whole pixels allow, keeping the side that
 * is longer relative to the ratio, so the box still reaches the pointer.
 */
function fitRatio(width: number, height: number, ratio: number): [number, number] {
  return width >= height * ratio
    ? [width, Math.round(width / ratio)]
    : [Math.round(height * ratio), height];
}

/**
 * A new box dragged from `anchor` to `point`, both on the pixel-corner grid; at least one
 * pixel each way. `ratio` (width / height) fixes its shape, the longer side winning;
 * `fromCentre` grows it around the anchor instead of from it.
 */
export function drawBox(
  anchorX: number,
  anchorY: number,
  pointX: number,
  pointY: number,
  ratio: number | null,
  fromCentre: boolean,
): Rect {
  const dx = pointX - anchorX;
  const dy = pointY - anchorY;
  const scale = fromCentre ? 2 : 1;
  let width = Math.abs(dx) * scale;
  let height = Math.abs(dy) * scale;
  if (ratio !== null) [width, height] = fitRatio(width, height, ratio);
  width = Math.max(1, width);
  height = Math.max(1, height);
  if (fromCentre) {
    return {
      x: anchorX - Math.floor(width / 2),
      y: anchorY - Math.floor(height / 2),
      width,
      height,
    };
  }
  return {
    x: dx < 0 ? anchorX - width : anchorX,
    y: dy < 0 ? anchorY - height : anchorY,
    width,
    height,
  };
}

/** One axis of a resize: its length as dragged, and where a span of a given length starts. */
interface ResizedAxis {
  readonly length: number;
  readonly startFor: (length: number) => number;
}

/**
 * Drags the `side` edge of the span from `start`, `length` long, by `delta`. The other
 * edge stays put, or with `fromCentre` mirrors the dragged one about the centre. An edge
 * dragged past the other turns the span around. A span of another length (kept to a ratio
 * or at least a pixel) starts at the fixed edge, or is centred when nothing anchors it.
 */
function resizeAxis(
  start: number,
  length: number,
  side: Side,
  delta: number,
  fromCentre: boolean,
): ResizedAxis {
  const end = start + length;
  // Exact when the lengths' parities match, else half a pixel towards the start.
  const centred = (size: number) => Math.floor((start + end - size) / 2);
  if (side === 0) return { length, startFor: centred };
  const moved = (side < 0 ? start : end) + delta;
  if (fromCentre) return { length: Math.abs(2 * moved - start - end), startFor: centred };
  const anchor = side < 0 ? end : start;
  const direction = Math.sign(moved - anchor) || side;
  return {
    length: Math.abs(moved - anchor),
    startFor: (size) => (direction > 0 ? anchor : anchor - size),
  };
}

/**
 * `start` with `handle` dragged by (dx, dy) whole pixels; at least one pixel each way.
 * With a `ratio` (width / height) a corner keeps the box to it, the longer side winning,
 * and an edge sets the other side, centred on where it was. `fromCentre` moves the
 * opposite edges too, so the centre stays put.
 */
export function resizeBox(
  start: Rect,
  handle: CropHandle,
  dx: number,
  dy: number,
  ratio: number | null,
  fromCentre: boolean,
): Rect {
  const [sx, sy] = HANDLE_SIDES[handle];
  const x = resizeAxis(start.x, start.width, sx, dx, fromCentre);
  const y = resizeAxis(start.y, start.height, sy, dy, fromCentre);
  let width = x.length;
  let height = y.length;
  if (ratio !== null) {
    if (sy === 0) height = Math.round(width / ratio);
    else if (sx === 0) width = Math.round(height * ratio);
    else [width, height] = fitRatio(width, height, ratio);
  }
  width = Math.max(1, width);
  height = Math.max(1, height);
  return { x: x.startFor(width), y: y.startFor(height), width, height };
}

/** `box` moved by (dx, dy) whole pixels. */
export function moveBox(box: Rect, dx: number, dy: number): Rect {
  return { ...box, x: box.x + dx, y: box.y + dy };
}

/**
 * The largest box shaped to `ratio` (width / height, as near as whole pixels allow) that
 * fits inside `outer`, centred in it; at least one pixel each way.
 */
export function fitBox(outer: Rect, ratio: number): Rect {
  let width = outer.width;
  let height = Math.round(width / ratio);
  if (height > outer.height) {
    height = outer.height;
    width = Math.min(outer.width, Math.round(height * ratio));
  }
  width = Math.max(1, width);
  height = Math.max(1, height);
  return {
    x: outer.x + Math.floor((outer.width - width) / 2),
    y: outer.y + Math.floor((outer.height - height) / 2),
    width,
    height,
  };
}

/** A box of the same area and centre as `box` (as near as whole pixels allow), shaped to `ratio`. */
export function reshapeBox(box: Rect, ratio: number): Rect {
  const width = Math.max(1, Math.round(Math.sqrt(box.width * box.height * ratio)));
  const height = Math.max(1, Math.round(width / ratio));
  return {
    x: Math.floor((2 * box.x + box.width - width) / 2),
    y: Math.floor((2 * box.y + box.height - height) / 2),
    width,
    height,
  };
}
