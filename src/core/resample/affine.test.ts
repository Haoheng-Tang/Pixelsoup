import { describe, expect, it } from 'vitest';
import {
  IDENTITY,
  aboutPivot,
  alignToPixels,
  invert,
  multiply,
  rotation,
  scaling,
  transformPoint,
  transformedBounds,
  translation,
} from './affine';

describe('rotation', () => {
  it('is exact for quarter turns, with no negative zeros', () => {
    // Clockwise on screen, where y points down: (1, 0) turns to (0, 1).
    expect(rotation(90)).toEqual([0, 1, -1, 0, 0, 0]);
    expect(rotation(-90)).toEqual([0, -1, 1, 0, 0, 0]);
    expect(rotation(270)).toEqual(rotation(-90));
    expect(rotation(180)).toEqual([-1, 0, 0, -1, 0, 0]);
    for (const degrees of [0, 360, -360, 720]) {
      const m = rotation(degrees);
      expect(m).toEqual(IDENTITY);
      expect(m.some((v) => Object.is(v, -0))).toBe(false);
    }
  });

  it('turns by any angle', () => {
    const [x, y] = transformPoint(rotation(30), 2, 0);
    expect(x).toBeCloseTo(Math.sqrt(3), 12);
    expect(y).toBeCloseTo(1, 12);
  });
});

describe('multiply', () => {
  it('applies the inner transform first', () => {
    expect(transformPoint(multiply(translation(5, 0), scaling(2)), 1, 1)).toEqual([7, 2]);
    expect(transformPoint(multiply(scaling(2), translation(5, 0)), 1, 1)).toEqual([12, 2]);
  });
});

describe('invert', () => {
  it('undoes a transform', () => {
    const m = multiply(translation(3, -7), multiply(rotation(25), scaling(2, 0.5)));
    const inverse = invert(m);
    expect(inverse).not.toBeNull();
    const [x, y] = transformPoint(inverse ?? IDENTITY, ...transformPoint(m, 4, 9));
    expect(x).toBeCloseTo(4, 12);
    expect(y).toBeCloseTo(9, 12);
  });

  it('is null for transforms that flatten the plane', () => {
    expect(invert(scaling(0, 1))).toBeNull();
    expect(invert([1, 2, 2, 4, 0, 0])).toBeNull();
    expect(invert(scaling(Infinity))).toBeNull();
  });
});

describe('aboutPivot', () => {
  it('keeps the pivot still', () => {
    const m = aboutPivot(rotation(90), 1.5, 1);
    expect(transformPoint(m, 1.5, 1)).toEqual([1.5, 1]);
    // (0, 0) is 1.5 left of and 1 above the pivot, so turns to 1 right of and 1.5 above it.
    expect(transformPoint(m, 0, 0)).toEqual([2.5, -0.5]);
  });
});

describe('transformedBounds', () => {
  it('bounds the transformed corners in whole pixels', () => {
    const area = { x: 0, y: 0, width: 4, height: 2 };
    expect(transformedBounds(IDENTITY, area)).toEqual(area);
    expect(transformedBounds(translation(0.5, -0.25), area)).toEqual({
      x: 0,
      y: -1,
      width: 5,
      height: 3,
    });
    // A quarter turn about the origin takes (4, 2) to (-2, 4).
    expect(transformedBounds(rotation(90), area)).toEqual({ x: -2, y: 0, width: 2, height: 4 });
  });

  it('bounds a rotated square', () => {
    // The corners of a 10 × 10 square turned 45° about its centre lie 5√2 ≈ 7.07 from it.
    const bounds = transformedBounds(aboutPivot(rotation(45), 5, 5), {
      x: 0,
      y: 0,
      width: 10,
      height: 10,
    });
    expect(bounds).toEqual({ x: -3, y: -3, width: 16, height: 16 });
  });

  it('ignores rounding noise', () => {
    // 30 × 0.1 is 3.0000000000000004 in floating point.
    const area = { x: 0, y: 0, width: 30, height: 10 };
    expect(transformedBounds(scaling(0.1), area)).toEqual({ x: 0, y: 0, width: 3, height: 1 });
  });
});

describe('alignToPixels', () => {
  it('puts the transformed bounds on pixel corners', () => {
    // Turned about its centre (1.5, 1), a 3 × 2 rect spans x 0.5–2.5 and y -0.5–2.5.
    const area = { x: 0, y: 0, width: 3, height: 2 };
    const m = alignToPixels(aboutPivot(rotation(90), 1.5, 1), area);
    expect(transformedBounds(m, area)).toEqual({ x: 1, y: 0, width: 2, height: 3 });
    expect(transformPoint(m, 0, 0)).toEqual([3, 0]);
  });

  it('leaves aligned transforms alone', () => {
    const m = translation(2, 3);
    expect(alignToPixels(m, { x: 0, y: 0, width: 5, height: 5 })).toEqual(m);
  });
});
