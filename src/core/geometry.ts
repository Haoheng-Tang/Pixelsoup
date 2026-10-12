/** A point in document coordinates, which may be fractional. */
export interface Point {
  readonly x: number;
  readonly y: number;
}

/** Axis-aligned integer rectangle in pixel coordinates. */
export interface Rect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export function rect(x: number, y: number, width: number, height: number): Rect {
  return { x, y, width, height };
}

export function isEmptyRect(r: Rect): boolean {
  return r.width <= 0 || r.height <= 0;
}

/** Intersection of two rects, or null if they do not overlap. */
export function intersectRects(a: Rect, b: Rect): Rect | null {
  const x0 = Math.max(a.x, b.x);
  const y0 = Math.max(a.y, b.y);
  const x1 = Math.min(a.x + a.width, b.x + b.width);
  const y1 = Math.min(a.y + a.height, b.y + b.height);
  if (x1 <= x0 || y1 <= y0) return null;
  return { x: x0, y: y0, width: x1 - x0, height: y1 - y0 };
}

/** Smallest rect containing both inputs. Null inputs are ignored. */
export function unionRects(a: Rect | null, b: Rect | null): Rect | null {
  if (!a || isEmptyRect(a)) return b && !isEmptyRect(b) ? b : null;
  if (!b || isEmptyRect(b)) return a;
  const x0 = Math.min(a.x, b.x);
  const y0 = Math.min(a.y, b.y);
  const x1 = Math.max(a.x + a.width, b.x + b.width);
  const y1 = Math.max(a.y + a.height, b.y + b.height);
  return { x: x0, y: y0, width: x1 - x0, height: y1 - y0 };
}

/** True if `inner` lies entirely inside `outer`. */
export function containsRect(outer: Rect, inner: Rect): boolean {
  return (
    inner.x >= outer.x &&
    inner.y >= outer.y &&
    inner.x + inner.width <= outer.x + outer.width &&
    inner.y + inner.height <= outer.y + outer.height
  );
}

/** Expands a (possibly fractional) rect outward to integer pixel boundaries. */
export function roundRectOut(r: Rect): Rect {
  const x0 = Math.floor(r.x);
  const y0 = Math.floor(r.y);
  const x1 = Math.ceil(r.x + r.width);
  const y1 = Math.ceil(r.y + r.height);
  return { x: x0, y: y0, width: x1 - x0, height: y1 - y0 };
}
