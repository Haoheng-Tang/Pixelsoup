import { describe, expect, it } from 'vitest';
import type { Projective, Quad, Rect } from '../../core';
import {
  fromAffine,
  homographyFromQuad,
  invertProjective,
  mapCorners,
  multiplyProjective,
  projectPoint,
} from '../../core';
import {
  MAX_MESH_CELLS,
  MESH_OVERLAP,
  MIN_MESH_CELLS,
  PreviewMesh,
  meshCells,
  visibleArea,
} from './projective-mesh';

const EVERYWHERE: Rect = { x: -1e9, y: -1e9, width: 2e9, height: 2e9 };

/** A 1000 px square on screen with its top edge `top` px wide, centred. */
function trapezoid(top: number, size = 1000): Quad {
  const inset = (size - (top * size) / 1000) / 2;
  return [
    { x: inset, y: 0 },
    { x: size - inset, y: 0 },
    { x: size, y: size },
    { x: 0, y: size },
  ];
}

/** An image `size` pixels square. */
function square(size: number): Rect {
  return { x: 0, y: 0, width: size, height: size };
}

/** Triangle `t`'s corners from `mesh.corners`, as [x, y] pairs. */
function cornersOf(mesh: PreviewMesh, t: number): number[][] {
  const c = Array.from(mesh.corners.subarray(6 * t, 6 * t + 6));
  return [c.slice(0, 2), c.slice(2, 4), c.slice(4, 6)];
}

/** Where triangle `t` of `mesh` takes the image point (u, v). */
function throughTriangle(mesh: PreviewMesh, t: number, u: number, v: number): number[] {
  const [a, b, c, d, e, f] = mesh.affines.subarray(6 * t, 6 * t + 6);
  return [a * u + c * v + e, b * u + d * v + f];
}

const source: Rect = { x: 0, y: 0, width: 100, height: 80 };
const strong = homographyFromQuad(source, [
  { x: 300, y: 50 },
  { x: 500, y: 40 },
  { x: 900, y: 700 },
  { x: 20, y: 650 },
]) as Projective;

describe('meshCells', () => {
  it('takes the fewest cells for a parallelogram', () => {
    expect(meshCells(trapezoid(1000))).toBe(MIN_MESH_CELLS);
    const parallelogram: Quad = [
      { x: 100, y: 0 },
      { x: 900, y: 50 },
      { x: 800, y: 950 },
      { x: 0, y: 900 },
    ];
    expect(meshCells(parallelogram)).toBe(MIN_MESH_CELLS);
  });

  it('takes more the further the quad is from a parallelogram', () => {
    // The diagonals cross at (500, 473.7), 36.3 px from their midpoints (525, 500) and
    // (475, 500): √(36.3 / 0.25) = 12.05 cells.
    expect(meshCells(trapezoid(900))).toBe(13);
    // They cross at (500, 333.3), 208.3 px from (625, 500): √(208.3 / 0.25) = 28.9 cells.
    expect(meshCells(trapezoid(500))).toBe(29);
    expect(meshCells(trapezoid(40))).toBe(MAX_MESH_CELLS);
  });

  it('takes fewer for a quad that is smaller on the screen', () => {
    // 3.63 px: √(3.63 / 0.25) = 3.8 cells, so the fewest.
    expect(meshCells(trapezoid(900, 100))).toBe(MIN_MESH_CELLS);
    expect(meshCells(trapezoid(500, 200))).toBe(13);
  });
});

describe('PreviewMesh', () => {
  it('makes two triangles a cell, row by row', () => {
    const mesh = new PreviewMesh();
    mesh.build(strong, source, 8, EVERYWHERE);
    expect(mesh.count).toBe(2 * 8 * 8);
  });

  it('takes each triangle’s corners exactly where the transform takes them', () => {
    const cells = 5;
    const mesh = new PreviewMesh();
    mesh.build(strong, source, cells, EVERYWHERE);
    for (let j = 0; j < cells; j++) {
      for (let i = 0; i < cells; i++) {
        const [u0, u1] = [mesh.columns[i], mesh.columns[i + 1]];
        const [v0, v1] = [mesh.rows[j], mesh.rows[j + 1]];
        const t = 2 * (j * cells + i);
        const triangles = [
          [t, [u0, v0], [u1, v0], [u1, v1]],
          [t + 1, [u0, v0], [u1, v1], [u0, v1]],
        ] as const;
        for (const [index, ...corners] of triangles) {
          for (const [u, v] of corners) {
            const [x, y] = projectPoint(strong, u, v);
            const [ax, ay] = throughTriangle(mesh, index, u, v);
            expect(ax).toBeCloseTo(x, 9);
            expect(ay).toBeCloseTo(y, 9);
          }
        }
      }
    }
  });

  it('meshes just the area it’s given', () => {
    const mesh = new PreviewMesh();
    mesh.build(strong, { x: 20, y: 10, width: 50, height: 40 }, 4, EVERYWHERE);
    expect(mesh.count).toBe(2 * 4 * 4);
    const { columns, rows } = mesh;
    expect([columns[0], columns[4], rows[0], rows[4]]).toEqual([20, 70, 10, 50]);
    // The first triangle starts at the area's top-left corner; the last, the second of the
    // bottom-right cell, ends at that cell's bottom-left corner.
    const checks = [
      [0, 20, 10],
      [31, 70, 50],
      [31, columns[3], 50],
    ];
    for (const [t, u, v] of checks) {
      const [x, y] = projectPoint(strong, u, v);
      const [ax, ay] = throughTriangle(mesh, t, u, v);
      expect(ax).toBeCloseTo(x, 9);
      expect(ay).toBeCloseTo(y, 9);
    }
  });

  it('spaces the grid evenly for an affine transform', () => {
    const mesh = new PreviewMesh();
    mesh.build(fromAffine([2, 0.5, -0.3, 1.5, 7, 9]), source, 4, EVERYWHERE);
    expect(Array.from(mesh.columns.subarray(0, 5))).toEqual([0, 25, 50, 75, 100]);
    expect(Array.from(mesh.rows.subarray(0, 5))).toEqual([0, 20, 40, 60, 80]);
  });

  it('spaces the grid evenly in 1 / √w, closer together where the image is magnified', () => {
    // Narrow at the top: w, as the image recedes, is largest along the top edge, and is
    // the same all along each row.
    const keystone = homographyFromQuad(source, [
      { x: 40, y: 0 },
      { x: 60, y: 0 },
      { x: 100, y: 80 },
      { x: 0, y: 80 },
    ]) as Projective;
    const mesh = new PreviewMesh();
    mesh.build(keystone, source, 4, EVERYWHERE);
    const { columns, rows } = mesh;
    expect(Array.from(columns.subarray(0, 5))).toEqual([0, 25, 50, 75, 100]);
    const s = (v: number) => 1 / Math.sqrt(Math.abs(keystone[7] * v + keystone[8]));
    const steps = [0, 1, 2, 3].map((j) => s(rows[j + 1]) - s(rows[j]));
    for (const step of steps) expect(step).toBeCloseTo(steps[0], 12);
    const heights = [0, 1, 2, 3].map((j) => rows[j + 1] - rows[j]);
    for (let j = 1; j < 4; j++) expect(heights[j]).toBeLessThan(heights[j - 1]);
  });

  it('moves each triangle’s edges out by half a device pixel', () => {
    const mesh = new PreviewMesh();
    // Cells 10 device pixels square.
    mesh.build(fromAffine([10, 0, 0, 10, 0, 0]), square(2), 2, EVERYWHERE);
    // (0, 0), (10, 0), (10, 10): the top edge moves up to y = −0.5, the right edge right to
    // x = 10.5, and the diagonal 0.5 px out, to y − x = 0.5√2, where they meet.
    const corners = cornersOf(mesh, 0).flat();
    const pushed = [-0.5 - 0.5 * Math.SQRT2, -0.5, 10.5, -0.5, 10.5, 10.5 + 0.5 * Math.SQRT2];
    corners.forEach((value, i) => expect(value).toBeCloseTo(pushed[i], 12));
    expect(MESH_OVERLAP).toBe(0.5);
  });

  it('moves a sharp corner out at most 2 px', () => {
    const mesh = new PreviewMesh();
    // One cell, 100 × 1 device pixels: (0, 0), (100, 0), (100, 1), sharp at (0, 0), where
    // the moved edges would meet 100 px away.
    mesh.build(fromAffine([100, 0, 0, 1, 0, 0]), square(1), 1, EVERYWHERE);
    const [[x0, y0], [x1, y1], [x2, y2]] = cornersOf(mesh, 0);
    expect(Math.hypot(x0, y0)).toBeCloseTo(2, 12);
    expect([x1, y1]).toEqual([100.5, -0.5]);
    // Where x = 100.5 meets the long edge's line moved out, (100y − x) / √10001 = 0.5.
    expect(x2).toBeCloseTo(100.5, 12);
    expect(y2).toBeCloseTo((0.5 * Math.hypot(1, 100) + 100.5) / 100, 12);
  });

  it('leaves out triangles that miss the visible area', () => {
    const mesh = new PreviewMesh();
    // 4 × 4 cells, 10 device pixels square: only the top-left 2 × 2 reach (15, 15).
    mesh.build(fromAffine([10, 0, 0, 10, 0, 0]), square(4), 4, {
      x: 0,
      y: 0,
      width: 15,
      height: 15,
    });
    expect(mesh.count).toBe(8);
    mesh.build(fromAffine([10, 0, 0, 10, 0, 0]), square(4), 4, {
      x: 60,
      y: 0,
      width: 15,
      height: 15,
    });
    expect(mesh.count).toBe(0);
  });

  it('leaves out triangles with no area', () => {
    const mesh = new PreviewMesh();
    mesh.build(fromAffine([1, 0, 0, 0, 0, 0]), square(4), 4, EVERYWHERE);
    expect(mesh.count).toBe(0);
  });

  it('keeps its buffers while they are big enough', () => {
    const mesh = new PreviewMesh();
    mesh.build(strong, source, 16, EVERYWHERE);
    const { corners, affines } = mesh;
    mesh.build(strong, source, 8, EVERYWHERE);
    expect(mesh.corners).toBe(corners);
    expect(mesh.affines).toBe(affines);
    expect(mesh.count).toBe(128);
  });
});

describe('visibleArea', () => {
  // Ten device pixels an image pixel.
  const zoomed = fromAffine([10, 0, 0, 10, 0, 0]);

  it('is the whole image while all of it shows', () => {
    expect(visibleArea(zoomed, 100, 80, EVERYWHERE)).toEqual(source);
    expect(visibleArea(strong, 100, 80, EVERYWHERE)).toEqual(source);
  });

  it('is the whole pixels that show', () => {
    // Device x 155–255 and y 203–253 show image x 15.5–25.5 and y 20.3–25.3.
    const inside = { x: 155, y: 203, width: 100, height: 50 };
    expect(visibleArea(zoomed, 100, 80, inside)).toEqual({ x: 15, y: 20, width: 11, height: 6 });
    // Device x 955–1055 shows x 95.5 to the image's right edge.
    const edge = { x: 955, y: 0, width: 100, height: 50 };
    expect(visibleArea(zoomed, 100, 80, edge)).toEqual({ x: 95, y: 0, width: 5, height: 5 });
  });

  it('is null when none of the image shows', () => {
    expect(visibleArea(zoomed, 100, 80, { x: 1000, y: 0, width: 50, height: 50 })).toBeNull();
    expect(visibleArea(zoomed, 100, 80, { x: -50, y: -50, width: 50, height: 50 })).toBeNull();
    // Within the quad's bounds, but left of its slanted left edge.
    expect(visibleArea(strong, 100, 80, { x: 0, y: 0, width: 100, height: 100 })).toBeNull();
  });

  it('covers what shows through a perspective', () => {
    const shown: Rect = { x: 400, y: 300, width: 200, height: 150 };
    const area = visibleArea(strong, 100, 80, shown);
    if (!area) throw new Error('expected an area');
    expect(area.width * area.height).toBeLessThan((100 * 80) / 4);
    const inverse = invertProjective(strong) as Projective;
    for (let j = 0; j <= 20; j++) {
      for (let i = 0; i <= 20; i++) {
        const x = shown.x + (shown.width * i) / 20;
        const y = shown.y + (shown.height * j) / 20;
        const [u, v] = projectPoint(inverse, x, y);
        expect(u).toBeGreaterThanOrEqual(area.x);
        expect(u).toBeLessThanOrEqual(area.x + area.width);
        expect(v).toBeGreaterThanOrEqual(area.y);
        expect(v).toBeLessThanOrEqual(area.y + area.height);
      }
    }
  });
});

describe('the preview mesh’s accuracy', () => {
  // A 6400 × 4000 image with its top edge narrowed to a fifth, on a 2185 × 1168 pixel
  // screen, a 125 % display.
  const image: Rect = { x: 0, y: 0, width: 6400, height: 4000 };
  const screen: Rect = { x: 0, y: 0, width: 2185, height: 1168 };
  const keystone = homographyFromQuad(image, [
    { x: 2560, y: 0 },
    { x: 3840, y: 0 },
    { x: 6400, y: 4000 },
    { x: 0, y: 4000 },
  ]) as Projective;

  /** The keystone seen at `scale` device pixels a canvas pixel, with (x, y) mid-screen. */
  const seen = (scale: number, x: number, y: number): Projective =>
    multiplyProjective(
      fromAffine([scale, 0, 0, scale, 1092 - scale * x, 584 - scale * y]),
      keystone,
    );

  /**
   * How far a mesh of `meshed`, `cells` cells a side, strays from the exact transform at
   * most, where `area` shows on the screen.
   */
  function strayed(device: Projective, meshed: Rect, cells: number, area: Rect): number {
    const mesh = new PreviewMesh();
    mesh.build(device, meshed, cells, EVERYWHERE);
    const { columns, rows } = mesh;
    let most = 0;
    for (let j = 0; j <= 200; j++) {
      for (let i = 0; i <= 200; i++) {
        const u = area.x + (area.width * i) / 200;
        const v = area.y + (area.height * j) / 200;
        const [x, y] = projectPoint(device, u, v);
        if (x < 0 || x > screen.width || y < 0 || y > screen.height) continue;
        let ci = 0;
        while (ci < cells - 1 && columns[ci + 1] <= u) ci++;
        let cj = 0;
        while (cj < cells - 1 && rows[cj + 1] <= v) cj++;
        const fu = (u - columns[ci]) / (columns[ci + 1] - columns[ci]);
        const fv = (v - rows[cj]) / (rows[cj + 1] - rows[cj]);
        const [mx, my] = throughTriangle(mesh, 2 * (cj * cells + ci) + (fu >= fv ? 0 : 1), u, v);
        most = Math.max(most, Math.hypot(mx - x, my - y));
      }
    }
    return most;
  }

  it('keeps a strong perspective seen whole within a device pixel', () => {
    // Fitted to the screen: 22 %, 0.277 device pixels a canvas pixel. 0.8 px with the
    // cells spaced evenly in 1 / √w; spaced evenly in the image, 6.3 px.
    const device = seen(0.277, 3200, 2000);
    expect(visibleArea(device, 6400, 4000, screen)).toEqual(image);
    const cells = meshCells(mapCorners(device, image));
    expect(cells).toBe(MAX_MESH_CELLS);
    expect(strayed(device, image, cells, image)).toBeLessThan(1);
  });

  it('keeps within half a device pixel zoomed in, meshing just what shows', () => {
    // At 500 %, 400 % on the display, around the middle of the image's left edge: 0.14 px,
    // with 14 cells over 471 × 131 of the image's pixels.
    const device = seen(5, 1280, 2000);
    const area = visibleArea(device, 6400, 4000, screen);
    if (!area) throw new Error('expected an area');
    expect(area.width * area.height).toBeLessThan((6400 * 4000) / 100);
    const cells = meshCells(mapCorners(device, area));
    expect(strayed(device, area, cells, area)).toBeLessThan(0.5);
    // The whole image's mesh, 32 cells a side, strays 8.9 px there.
    expect(strayed(device, image, MAX_MESH_CELLS, area)).toBeGreaterThan(5);
  });
});
