import { describe, expect, it } from 'vitest';
import type { Point, Rect } from '../geometry';
import type { Affine } from './affine';
import { invert, multiply, rotation, transformedBounds, translation } from './affine';
import type { Projective, Quad } from './projective';
import {
  compose,
  fromAffine,
  homographyFromQuad,
  invertProjective,
  isAffine,
  isConvexQuad,
  isProjective,
  mapCorners,
  mapPoint,
  mappedBounds,
  multiplyProjective,
  projectPoint,
  toAffine,
} from './projective';

const IDENTITY_3: Projective = [1, 0, 0, 0, 1, 0, 0, 0, 1];

type Pair = [x: number, y: number];

function quad(a: Pair, b: Pair, c: Pair, d: Pair): Quad {
  const point = ([x, y]: Pair): Point => ({ x, y });
  return [point(a), point(b), point(c), point(d)];
}

function expectMatrixClose(actual: Projective | null, expected: Projective, digits = 12): void {
  expect(actual).not.toBeNull();
  actual?.forEach((v, i) => expect(v).toBeCloseTo(expected[i], digits));
}

function expectPointClose([x, y]: Pair, p: Point, digits = 9): void {
  expect(x).toBeCloseTo(p.x, digits);
  expect(y).toBeCloseTo(p.y, digits);
}

/** w at (x, y): positive on the near side of the horizon. */
function w(m: Projective, x: number, y: number): number {
  return m[6] * x + m[7] * y + m[8];
}

// The classic perspective: w = 1 + y / 2, so the bottom of the 2 × 2 square shrinks to half
// its width. (2, 2) has w = 2 and goes to (1, 1); (0, 2) goes to (0, 1).
const TILT: Projective = [1, 0, 0, 0, 1, 0, 0, 0.5, 1];
const TILTED = quad([0, 0], [2, 0], [1, 1], [0, 1]);

describe('fromAffine and toAffine', () => {
  it('round-trip exactly', () => {
    const m: Affine = [0.3, -1.25, 2.5, 0.75, 13.125, -7.5];
    expect(fromAffine(m)).toEqual([0.3, 2.5, 13.125, -1.25, 0.75, -7.5, 0, 0, 1]);
    expect(toAffine(fromAffine(m))).toEqual(m);
    expect(toAffine(m)).toBe(m);
    expect(toAffine(TILT)).toBeNull();
  });

  it('tell the two kinds apart', () => {
    expect(isProjective(TILT)).toBe(true);
    expect(isProjective(rotation(30))).toBe(false);
    expect(isAffine(rotation(30))).toBe(true);
    expect(isAffine(fromAffine(rotation(30)))).toBe(true);
    expect(isAffine(TILT)).toBe(false);
    expect(isAffine([1, 0, 0, 0, 1, 0, 1e-13, -1e-13, 1 + 1e-13])).toBe(true);
    expect(isAffine([1, 0, 0, 0, 1, 0, 0, 0, 2])).toBe(false);
  });
});

describe('projectPoint and mapPoint', () => {
  it('divide by w', () => {
    expect(projectPoint(TILT, 2, 2)).toEqual([1, 1]);
    expect(mapPoint(TILT, 0, 2)).toEqual([0, 1]);
    expect(mapPoint(translation(3, -1), 1, 1)).toEqual([4, 0]);
  });
});

describe('multiplyProjective and compose', () => {
  it('apply the inner transform first', () => {
    const m = multiplyProjective(fromAffine(translation(5, 0)), TILT);
    // TILT takes (2, 2) to (1, 1), then the translation to (6, 1).
    expect(projectPoint(m, 2, 2)).toEqual([6, 1]);
  });

  it('match the affine product, and stay affine when both are', () => {
    const outer = rotation(30);
    const inner: Affine = [2, 0.5, -0.25, 1.5, 3, -4];
    const both = compose(outer, inner);
    expect(isProjective(both)).toBe(false);
    expect(both).toEqual(multiply(outer, inner));
    expect(multiplyProjective(fromAffine(outer), fromAffine(inner))).toEqual(
      fromAffine(multiply(outer, inner)),
    );
    const mixed = compose(TILT, translation(1, 1));
    expect(isProjective(mixed)).toBe(true);
    // (1, 1) moves to (2, 2), which TILT takes to (1, 1).
    expect(mapPoint(mixed, 1, 1)).toEqual([1, 1]);
  });
});

describe('invertProjective', () => {
  it('undoes the transform', () => {
    const inverse = invertProjective(TILT);
    expectMatrixClose(inverse, [1, 0, 0, 0, 1, 0, 0, -0.5, 1]);
    if (!inverse) return;
    expect(projectPoint(inverse, 1, 1)).toEqual([2, 2]);
    expectMatrixClose(multiplyProjective(inverse, TILT), IDENTITY_3);
  });

  it('inverts an affine matrix exactly as invert does', () => {
    const m: Affine = [0.3, -1.25, 2.5, 0.75, 13.125, -7.5];
    const expected = invert(m);
    expect(expected).not.toBeNull();
    if (expected) expect(invertProjective(fromAffine(m))).toEqual(fromAffine(expected));
  });

  it('gives null for a singular matrix', () => {
    expect(invertProjective([1, 2, 3, 2, 4, 6, 0, 0, 1])).toBeNull();
    expect(invertProjective([NaN, 0, 0, 0, 1, 0, 0, 0, 1])).toBeNull();
  });
});

describe('mapCorners and mappedBounds', () => {
  it('map the corners in quad order', () => {
    expect(mapCorners(TILT, { x: 0, y: 0, width: 2, height: 2 })).toEqual(TILTED);
  });

  it('bound the mapped corners in whole pixels', () => {
    expect(mappedBounds(TILT, { x: 0, y: 0, width: 2, height: 2 })).toEqual({
      x: 0,
      y: 0,
      width: 2,
      height: 1,
    });
    // (3, 0) has w = 1 and stays put; (3, 3) has w = 2.5 and goes to (1.2, 1.2).
    expect(mappedBounds(TILT, { x: 0, y: 0, width: 3, height: 3 })).toEqual({
      x: 0,
      y: 0,
      width: 3,
      height: 2,
    });
  });

  it('match transformedBounds for affine transforms', () => {
    const area = { x: -3, y: 2, width: 7, height: 5 };
    const m = rotation(30);
    expect(mappedBounds(m, area)).toEqual(transformedBounds(m, area));
    expect(mappedBounds(fromAffine(m), area)).toEqual(transformedBounds(m, area));
  });

  it('give null for an area reaching past the horizon', () => {
    // w = 1 - y / 2 is 0 at y = 2 and negative below.
    const m: Projective = [1, 0, 0, 0, 1, 0, 0, -0.5, 1];
    expect(mappedBounds(m, { x: 0, y: 0, width: 2, height: 1 })).not.toBeNull();
    expect(mappedBounds(m, { x: 0, y: 0, width: 2, height: 2 })).toBeNull();
    expect(mappedBounds(m, { x: 0, y: 0, width: 2, height: 4 })).toBeNull();
    // Wholly beyond it, w < 0 everywhere: still a proper (if mirrored) transform.
    expect(mappedBounds(m, { x: 0, y: 3, width: 2, height: 1 })).not.toBeNull();
  });
});

describe('isConvexQuad', () => {
  it('accepts convex quads turning either way', () => {
    expect(isConvexQuad(quad([0, 0], [2, 0], [2, 2], [0, 2]))).toBe(true);
    expect(isConvexQuad(quad([2, 0], [0, 0], [0, 2], [2, 2]))).toBe(true);
    expect(isConvexQuad(TILTED)).toBe(true);
  });

  it('refuses concave, crossed and flattened quads', () => {
    // (1, 1) is a dent: the quad turns the other way there.
    expect(isConvexQuad(quad([0, 0], [4, 0], [1, 1], [0, 4]))).toBe(false);
    // A bow tie: the edges from (2, 0) to (0, 2) and from (2, 2) to (0, 0) cross.
    expect(isConvexQuad(quad([0, 0], [2, 0], [0, 2], [2, 2]))).toBe(false);
    expect(isConvexQuad(quad([0, 0], [2, 0], [4, 0], [0, 2]))).toBe(false);
    expect(isConvexQuad(quad([0, 0], [0, 0], [2, 2], [0, 2]))).toBe(false);
    expect(isConvexQuad(quad([0, 0], [2, 0], [2, 2], [0, NaN]))).toBe(false);
  });
});

describe('homographyFromQuad', () => {
  const square = { x: 0, y: 0, width: 2, height: 2 };

  it('gives the identity for the source rect itself', () => {
    const source = { x: 5, y: 4, width: 10, height: 8 };
    const m = homographyFromQuad(source, mapCorners(IDENTITY_3, source));
    expectMatrixClose(m, IDENTITY_3);
    expect(m && isAffine(m)).toBe(true);
  });

  it('finds the matrix that made the quad', () => {
    expectMatrixClose(homographyFromQuad(square, TILTED), TILT);
  });

  it('gives an affine matrix for a parallelogram, its bottom row exactly (0, 0, 1)', () => {
    const source = { x: 5, y: 4, width: 10, height: 8 };
    // Edges (10, 2) and (-2, 8) from (2, 1).
    const corners = quad([2, 1], [12, 3], [10, 11], [0, 9]);
    const m = homographyFromQuad(source, corners);
    expect(m).not.toBeNull();
    if (!m) return;
    expect([m[6], m[7], m[8]]).toEqual([0, 0, 1]);
    const affine = toAffine(m);
    expect(affine).not.toBeNull();
    if (affine)
      mapCorners(affine, source).forEach((p, i) => expectPointClose([p.x, p.y], corners[i], 12));
  });

  it('maps the corners exactly, a mirrored quad and a big one included', () => {
    const cases: [Rect, Quad][] = [
      [{ x: 5, y: 4, width: 10, height: 8 }, quad([1, 2], [30, -3], [25, 20], [-4, 15])],
      [square, quad([2, 0], [0, 0], [0.5, 1], [1.5, 1])],
      [
        { x: 100, y: 200, width: 6400, height: 4000 },
        quad([6000, 3000], [12000, 3500], [11000, 9000], [5800, 8000]),
      ],
    ];
    for (const [source, corners] of cases) {
      const m = homographyFromQuad(source, corners);
      expect(m).not.toBeNull();
      if (!m) continue;
      const scale = Math.max(1, ...corners.map((p) => Math.abs(p.x) + Math.abs(p.y)));
      mapCorners(m, source).forEach((p, i) => {
        expect(Math.abs(p.x - corners[i].x)).toBeLessThan(1e-12 * scale);
        expect(Math.abs(p.y - corners[i].y)).toBeLessThan(1e-12 * scale);
      });
      // w is positive all over the source, so nothing in it reaches the horizon.
      for (const [x, y] of [
        [source.x, source.y],
        [source.x + source.width, source.y],
        [source.x + source.width, source.y + source.height],
        [source.x, source.y + source.height],
      ] as const) {
        expect(w(m, x, y)).toBeGreaterThan(0);
      }
    }
  });

  it('maps points inside consistently with its inverse', () => {
    const source = { x: 5, y: 4, width: 10, height: 8 };
    const corners = quad([1, 2], [30, -3], [25, 20], [-4, 15]);
    const m = homographyFromQuad(source, corners);
    const inverse = m && invertProjective(m);
    expect(inverse).toBeTruthy();
    if (!m || !inverse) return;
    for (const [x, y] of [
      [7.3, 9.1],
      [10, 8],
      [14.5, 4.25],
    ] as const) {
      const [px, py] = projectPoint(m, x, y);
      expectPointClose(projectPoint(inverse, px, py), { x, y });
    }
    corners.forEach((p, i) => {
      const [x, y] = projectPoint(inverse, p.x, p.y);
      const expected = mapCorners(IDENTITY_3, source)[i];
      expectPointClose([x, y], expected);
    });
  });

  it('takes the centre to where the diagonals cross', () => {
    // The diagonals of TILTED are y = x and x / 2 + y = 1, crossing at (2/3, 2/3).
    const m = homographyFromQuad(square, TILTED);
    expect(m).not.toBeNull();
    if (m) expectPointClose(projectPoint(m, 1, 1), { x: 2 / 3, y: 2 / 3 }, 12);
  });

  it('keeps straight lines straight', () => {
    const m = homographyFromQuad(square, quad([1, 2], [30, -3], [25, 20], [-4, 15]));
    expect(m).not.toBeNull();
    if (!m) return;
    // Points along the source's top-left to bottom-right diagonal stay in line.
    const [x0, y0] = projectPoint(m, 0, 0);
    const [x1, y1] = projectPoint(m, 2, 2);
    for (const t of [0.1, 0.37, 0.5, 0.92]) {
      const [x, y] = projectPoint(m, 2 * t, 2 * t);
      const cross = (x1 - x0) * (y - y0) - (y1 - y0) * (x - x0);
      expect(Math.abs(cross)).toBeLessThan(1e-9);
    }
  });

  it('refuses degenerate quads and empty sources', () => {
    expect(homographyFromQuad(square, quad([0, 0], [2, 0], [4, 0], [0, 2]))).toBeNull();
    expect(homographyFromQuad(square, quad([0, 0], [2, 0], [0, 2], [2, 2]))).toBeNull();
    expect(homographyFromQuad(square, quad([0, 0], [4, 0], [1, 1], [0, 4]))).toBeNull();
    expect(homographyFromQuad(square, quad([1, 1], [1, 1], [1, 1], [1, 1]))).toBeNull();
    expect(homographyFromQuad({ x: 0, y: 0, width: 0, height: 2 }, TILTED)).toBeNull();
    expect(homographyFromQuad({ x: 0, y: 0, width: Infinity, height: 2 }, TILTED)).toBeNull();
  });
});
