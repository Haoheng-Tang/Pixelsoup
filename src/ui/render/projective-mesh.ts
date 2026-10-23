import type { Point, Projective, Quad, Rect } from '../../core';
import { invertProjective, mapCorners, projectPoint } from '../../core';

/**
 * Drawing an image through a projective transform with Canvas 2D, which draws images only
 * through affine ones: the part of the image in view is split into a mesh of n × n cells,
 * and each cell drawn as two triangles, each through the affine transform that takes its
 * three corners where the projective transform takes them. Lines stay straight within a
 * triangle and bend slightly where triangles meet, by less the more cells there are.
 */

/** The fewest cells a side of the mesh has. */
export const MIN_MESH_CELLS = 8;
/** The most cells a side of the mesh has. */
export const MAX_MESH_CELLS = 32;
/** Roughly how far, in device pixels, the triangles may stray from the exact transform. */
const MESH_TOLERANCE = 0.25;
/**
 * How far each triangle reaches out past its edges, in device pixels, so that neighbours
 * overlap a little rather than leave hairline gaps where their anti-aliased edges meet.
 */
export const MESH_OVERLAP = 0.5;
/** At a sharp corner, a triangle's corner moves out at most this many times as far. */
const MITER_LIMIT = 4;
/** Triangles smaller than this, in square device pixels, are left out: they'd show nothing. */
const MIN_AREA = 1e-6;

/**
 * How many cells a side a mesh needs over an area whose corners go to `quad`, in device
 * pixels: 8 for a quad that's all but a parallelogram, up to 32 for a strong perspective.
 * A parallelogram's diagonals cross at their midpoints; a perspective moves the crossing,
 * where the area's centre goes, away from them, and two triangles meeting along a diagonal
 * stray from the exact transform by about that much. A mesh of n × n cells, spaced as
 * `PreviewMesh` spaces them, strays by about 1 / n² of it.
 */
export function meshCells(quad: Quad): number {
  const [p0, p1, p2, p3] = quad;
  const crossing = intersection(p0, p2, p1, p3);
  if (!crossing) return MAX_MESH_CELLS;
  const offset = Math.max(
    Math.hypot(crossing.x - (p0.x + p2.x) / 2, crossing.y - (p0.y + p2.y) / 2),
    Math.hypot(crossing.x - (p1.x + p3.x) / 2, crossing.y - (p1.y + p3.y) / 2),
  );
  if (!Number.isFinite(offset)) return MAX_MESH_CELLS;
  return Math.min(
    MAX_MESH_CELLS,
    Math.max(MIN_MESH_CELLS, Math.ceil(Math.sqrt(offset / MESH_TOLERANCE))),
  );
}

/** Where the line through `a` and `b` meets the one through `c` and `d`; null if parallel. */
function intersection(a: Point, b: Point, c: Point, d: Point): Point | null {
  const rx = b.x - a.x;
  const ry = b.y - a.y;
  const sx = d.x - c.x;
  const sy = d.y - c.y;
  const denominator = rx * sy - ry * sx;
  if (Math.abs(denominator) < 1e-12) return null;
  const t = ((c.x - a.x) * sy - (c.y - a.y) * sx) / denominator;
  return { x: a.x + t * rx, y: a.y + t * ry };
}

/**
 * The part of a `width` × `height` image that shows in `visible` when `m` takes the image's
 * pixel coordinates to device pixels: the bounds, in whole pixels, of where the visible
 * part of the image comes from, or null if none of it shows. Zoomed in, a mesh over just
 * that part has smaller cells, and keeps as close to the exact transform as a mesh over the
 * whole image does when it's seen whole. `m` must take the image to a convex quad.
 */
export function visibleArea(
  m: Projective,
  width: number,
  height: number,
  visible: Rect,
): Rect | null {
  const inverse = invertProjective(m);
  if (!inverse) return null;
  const shown = clipToRect(mapCorners(m, { x: 0, y: 0, width, height }), visible);
  if (shown.length < 3) return null;
  let left = Infinity;
  let top = Infinity;
  let right = -Infinity;
  let bottom = -Infinity;
  for (const point of shown) {
    const [u, v] = projectPoint(inverse, point.x, point.y);
    left = Math.min(left, u);
    top = Math.min(top, v);
    right = Math.max(right, u);
    bottom = Math.max(bottom, v);
  }
  const x = Math.max(0, Math.floor(left));
  const y = Math.max(0, Math.floor(top));
  const areaWidth = Math.min(width, Math.ceil(right)) - x;
  const areaHeight = Math.min(height, Math.ceil(bottom)) - y;
  // Not-a-number fails these too.
  if (!(areaWidth > 0 && areaHeight > 0)) return null;
  return { x, y, width: areaWidth, height: areaHeight };
}

/** What of `polygon` lies inside `rect` (Sutherland–Hodgman), perhaps nothing. */
function clipToRect(polygon: readonly Point[], rect: Rect): Point[] {
  const right = rect.x + rect.width;
  const bottom = rect.y + rect.height;
  const toLeft = clipToHalfPlane(polygon, (p) => p.x - rect.x);
  const toRight = clipToHalfPlane(toLeft, (p) => right - p.x);
  const toTop = clipToHalfPlane(toRight, (p) => p.y - rect.y);
  return clipToHalfPlane(toTop, (p) => bottom - p.y);
}

/** What of `polygon` lies where `inside` is at least 0 (a linear function of the point). */
function clipToHalfPlane(polygon: readonly Point[], inside: (p: Point) => number): Point[] {
  const out: Point[] = [];
  for (let i = 0; i < polygon.length; i++) {
    const p = polygon[i];
    const q = polygon[(i + 1) % polygon.length];
    const dp = inside(p);
    const dq = inside(q);
    if (dp >= 0) out.push(p);
    if (dp >= 0 !== dq >= 0) {
      const t = dp / (dp - dq);
      out.push({ x: p.x + t * (q.x - p.x), y: p.y + t * (q.y - p.y) });
    }
  }
  return out;
}

/**
 * The triangles that draw part of an image through a projective transform, rebuilt each
 * frame into buffers kept between frames. Without culling, the triangles come two to a
 * cell, cells row by row: the first has the cell's top-left, top-right and bottom-right
 * corners, the second its top-left, bottom-right and bottom-left.
 *
 * A triangle strays from the exact transform by about a quarter of its size on the screen
 * times how much the transform's w (its divisor) changes across it, relative to w. Evenly
 * spaced cells would stray most where the image is magnified, where w is smallest, so the
 * grid lines are spaced evenly in 1 / √w instead (`gridLines`), which evens that out:
 * cells are smaller towards the near end of a perspective and larger towards its far end.
 */
export class PreviewMesh {
  /** How many triangles the last `build` made. */
  count = 0;
  /**
   * Each triangle's corners in device pixels, its edges moved out by `MESH_OVERLAP`: six
   * numbers a triangle, x0, y0, x1, y1, x2, y2.
   */
  corners = new Float64Array(0);
  /**
   * Each triangle's affine from the image's pixel coordinates to device pixels: six numbers
   * a triangle, in canvas `setTransform` order.
   */
  affines = new Float64Array(0);
  /** Where the last `build` put its cells + 1 columns' edges, in the image's coordinates. */
  columns = new Float64Array(0);
  /** Where it put its rows' edges. */
  rows = new Float64Array(0);
  /** Where the transform takes each of the mesh's (cells + 1)² points: x, y, row by row. */
  private points = new Float64Array(0);

  /**
   * Builds the triangles for `area` of an image, in its pixel coordinates, with `cells`
   * cells a side, through the transform `m` from those coordinates to device pixels.
   * Triangles that would miss `visible` (in device pixels) or have no area are left out.
   */
  build(m: Projective, area: Rect, cells: number, visible: Rect): void {
    const side = cells + 1;
    if (this.points.length < 2 * side * side) this.points = new Float64Array(2 * side * side);
    if (this.columns.length < side) {
      this.columns = new Float64Array(side);
      this.rows = new Float64Array(side);
    }
    const most = 2 * cells * cells;
    if (this.corners.length < 6 * most) {
      this.corners = new Float64Array(6 * most);
      this.affines = new Float64Array(6 * most);
    }
    const { points, corners, affines, columns, rows } = this;
    const [m0, m1, m2, m3, m4, m5, m6, m7, m8] = m;
    const x0 = area.x;
    const x1 = area.x + area.width;
    const y0 = area.y;
    const y1 = area.y + area.height;
    // w at the area's corners, positive: the matrix may have it negative throughout.
    const sign = m6 * x0 + m7 * y0 + m8 < 0 ? -1 : 1;
    const w00 = sign * (m6 * x0 + m7 * y0 + m8);
    const w10 = sign * (m6 * x1 + m7 * y0 + m8);
    const w01 = sign * (m6 * x0 + m7 * y1 + m8);
    const w11 = sign * (m6 * x1 + m7 * y1 + m8);
    // Each axis follows w along the edge where it's smaller: w changes as much along the
    // opposite edge, but relative to a larger w, so the lines are closer together there
    // than they need be.
    if (w00 <= w01) gridLines(columns, cells, x0, x1, w00, w10);
    else gridLines(columns, cells, x0, x1, w01, w11);
    if (w00 <= w10) gridLines(rows, cells, y0, y1, w00, w01);
    else gridLines(rows, cells, y0, y1, w10, w11);
    for (let j = 0; j < side; j++) {
      const v = rows[j];
      for (let i = 0; i < side; i++) {
        const u = columns[i];
        const w = m6 * u + m7 * v + m8;
        const k = 2 * (j * side + i);
        points[k] = (m0 * u + m1 * v + m2) / w;
        points[k + 1] = (m3 * u + m4 * v + m5) / w;
      }
    }

    const left = visible.x;
    const top = visible.y;
    const right = visible.x + visible.width;
    const bottom = visible.y + visible.height;
    let count = 0;
    for (let j = 0; j < cells; j++) {
      const v0 = rows[j];
      const dv = rows[j + 1] - v0;
      for (let i = 0; i < cells; i++) {
        const u0 = columns[i];
        const du = columns[i + 1] - u0;
        const k00 = 2 * (j * side + i);
        const k01 = k00 + 2 * side;
        const x00 = points[k00];
        const y00 = points[k00 + 1];
        const x10 = points[k00 + 2];
        const y10 = points[k00 + 3];
        const x01 = points[k01];
        const y01 = points[k01 + 1];
        const x11 = points[k01 + 2];
        const y11 = points[k01 + 3];
        for (let half = 0; half < 2; half++) {
          // The first triangle runs along the cell's top edge and down its right edge, the
          // second down its left edge and along its bottom edge.
          const a = half === 0 ? (x10 - x00) / du : (x11 - x01) / du;
          const b = half === 0 ? (y10 - y00) / du : (y11 - y01) / du;
          const c = half === 0 ? (x11 - x10) / dv : (x01 - x00) / dv;
          const d = half === 0 ? (y11 - y10) / dv : (y01 - y00) / dv;
          const xb = half === 0 ? x10 : x11;
          const yb = half === 0 ? y10 : y11;
          const xc = half === 0 ? x11 : x01;
          const yc = half === 0 ? y11 : y01;
          const doubled = (xb - x00) * (yc - y00) - (yb - y00) * (xc - x00);
          if (!(Math.abs(doubled) >= 2 * MIN_AREA && Number.isFinite(doubled))) continue;
          const k = 6 * count;
          pushOut(corners, k, x00, y00, xb, yb, xc, yc, doubled > 0 ? 1 : -1);
          const minX = Math.min(corners[k], corners[k + 2], corners[k + 4]);
          const maxX = Math.max(corners[k], corners[k + 2], corners[k + 4]);
          const minY = Math.min(corners[k + 1], corners[k + 3], corners[k + 5]);
          const maxY = Math.max(corners[k + 1], corners[k + 3], corners[k + 5]);
          if (maxX <= left || minX >= right || maxY <= top || minY >= bottom) continue;
          affines[k] = a;
          affines[k + 1] = b;
          affines[k + 2] = c;
          affines[k + 3] = d;
          affines[k + 4] = x00 - a * u0 - c * v0;
          affines[k + 5] = y00 - b * u0 - d * v0;
          count++;
        }
      }
    }
    this.count = count;
  }
}

/**
 * Puts `cells` + 1 grid lines from `start` to `end` in `lines`, along an axis where the
 * transform's w goes from `w0` to `w1`, evenly spaced in 1 / √w. In one dimension a cell
 * from w to w + Δw spans about Δw / w² on the screen and strays by about that times Δw / w,
 * Δw² / w³, the same for every cell when Δ(1 / √w), about Δw / w^1.5, is. Evenly spaced if
 * w hardly changes, or isn't positive throughout (the transform is then no use anyway).
 */
function gridLines(
  lines: Float64Array,
  cells: number,
  start: number,
  end: number,
  w0: number,
  w1: number,
): void {
  const even = !(w0 > 0 && w1 > 0) || Math.abs(w1 - w0) <= 1e-9 * Math.max(w0, w1);
  const s0 = 1 / Math.sqrt(w0);
  const s1 = 1 / Math.sqrt(w1);
  lines[0] = start;
  for (let i = 1; i < cells; i++) {
    if (even) {
      lines[i] = start + ((end - start) * i) / cells;
    } else {
      const s = s0 + ((s1 - s0) * i) / cells;
      lines[i] = start + ((end - start) * (1 / (s * s) - w0)) / (w1 - w0);
    }
  }
  lines[cells] = end;
}

/**
 * Writes the triangle (x0, y0), (x1, y1), (x2, y2) to `out` at `k` with each edge moved
 * out by `MESH_OVERLAP`: each corner goes where its two edges' moved lines meet, at most
 * `MITER_LIMIT` times that far, as a stroke's miter is limited. `sign` is the sign of the
 * triangle's area as `build` works it out: positive when its corners turn clockwise on the
 * screen, where y points down.
 */
function pushOut(
  out: Float64Array,
  k: number,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  sign: number,
): void {
  // Each edge's outward normal, for corner i to corner i + 1.
  let length = Math.hypot(x1 - x0, y1 - y0);
  const ax = (sign * (y1 - y0)) / length;
  const ay = (sign * (x0 - x1)) / length;
  length = Math.hypot(x2 - x1, y2 - y1);
  const bx = (sign * (y2 - y1)) / length;
  const by = (sign * (x1 - x2)) / length;
  length = Math.hypot(x0 - x2, y0 - y2);
  const cx = (sign * (y0 - y2)) / length;
  const cy = (sign * (x2 - x0)) / length;
  miter(out, k, x0, y0, cx, cy, ax, ay);
  miter(out, k + 2, x1, y1, ax, ay, bx, by);
  miter(out, k + 4, x2, y2, bx, by, cx, cy);
}

/**
 * Writes to `out` at `k` where the corner (x, y) goes when the edges on either side of it,
 * with unit outward normals (nx, ny) and (mx, my), move out by `MESH_OVERLAP`.
 */
function miter(
  out: Float64Array,
  k: number,
  x: number,
  y: number,
  nx: number,
  ny: number,
  mx: number,
  my: number,
): void {
  // The miter vector has a component of 1 along both normals.
  const along = Math.max(1 + nx * mx + ny * my, 1e-12);
  let dx = (nx + mx) / along;
  let dy = (ny + my) / along;
  const reach = Math.hypot(dx, dy);
  if (reach > MITER_LIMIT) {
    dx *= MITER_LIMIT / reach;
    dy *= MITER_LIMIT / reach;
  }
  out[k] = x + MESH_OVERLAP * dx;
  out[k + 1] = y + MESH_OVERLAP * dy;
}
