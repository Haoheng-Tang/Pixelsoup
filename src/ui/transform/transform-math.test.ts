import { describe, expect, it } from 'vitest';
import type { Affine, Point, Projective, Rect } from '../../core';
import {
  mapCorners,
  mapPoint,
  multiply,
  rotation,
  scaling,
  toAffine,
  translation,
} from '../../core';
import type { TransformParams, TransformState } from './transform-math';
import {
  fieldText,
  hitTransform,
  identityParams,
  identityState,
  isIdentity,
  moveState,
  normalizeAngle,
  orientState,
  parseFieldText,
  rotateCursor,
  rotateState,
  sameState,
  scaleState,
  stateFromParams,
  stateMatrix,
  stateParams,
  transformCursor,
  transformFields,
  withField,
} from './transform-math';

const square: Rect = { x: 0, y: 0, width: 10, height: 10 };
const wide: Rect = { x: 0, y: 0, width: 100, height: 50 };
const point = (x: number, y: number): Point => ({ x, y });
const free = { proportional: false, fromPivot: false };

/** How the options bar reads `state`, which must be a parallelogram. */
function paramsOf(source: Rect, state: TransformState | null): TransformParams {
  const params = state && stateParams(source, state);
  if (!params) throw new Error('Expected a parallelogram');
  return params;
}

/** The affine transform `state` describes, which must be a parallelogram. */
function affineOf(source: Rect, state: TransformState): Affine {
  const m = toAffine(stateMatrix(source, state));
  if (!m) throw new Error('Expected an affine transform');
  return m;
}

/** The box's corners as the session shows them: the layer's, through the transform. */
function cornersOf(source: Rect, state: TransformState) {
  return mapCorners(stateMatrix(source, state), source);
}

function expectCorners(source: Rect, state: TransformState, expected: [number, number][]) {
  cornersOf(source, state).forEach((corner, i) => {
    expect(corner.x).toBeCloseTo(expected[i]?.[0] ?? NaN, 9);
    expect(corner.y).toBeCloseTo(expected[i]?.[1] ?? NaN, 9);
  });
}

function expectSameMatrix(a: Affine | Projective, b: Affine | Projective) {
  expect(a).toHaveLength(b.length);
  a.forEach((value, i) => expect(value).toBeCloseTo(b[i] ?? NaN, 9));
}

/** What params meant before the box kept its corners: scaled and turned about the centre. */
function paramsAffine(source: Rect, { x, y, scaleX, scaleY, angle }: TransformParams): Affine {
  const cx = source.x + source.width / 2;
  const cy = source.y + source.height / 2;
  return multiply(
    translation(x, y),
    multiply(rotation(angle), multiply(scaling(scaleX, scaleY), translation(-cx, -cy))),
  );
}

describe('stateMatrix', () => {
  it('is the identity for an untouched box', () => {
    const m = stateMatrix(square, identityState(square));
    expect(m).toEqual([1, 0, 0, 1, 0, 0]);
    expect(isIdentity(m)).toBe(true);
    expect(sameState(stateFromParams(square, identityParams(square)), identityState(square))).toBe(
      true,
    );
  });

  it('is the transform the params describe, which read back the same', () => {
    const cases: TransformParams[] = [
      { x: 40.5, y: -12, scaleX: 1.5, scaleY: -0.75, angle: 33 },
      { x: 50, y: 25, scaleX: 2, scaleY: 0.5, angle: -120 },
      { x: 7, y: 9, scaleX: -1, scaleY: 1, angle: 45 },
    ];
    for (const params of cases) {
      const state = stateFromParams(wide, params);
      expectSameMatrix(stateMatrix(wide, state), paramsAffine(wide, params));
      expect(paramsOf(wide, state)).toEqual(params);
    }
  });

  it('scales and turns about the centre, which moves to the pivot', () => {
    const params = identityParams(square);
    expectCorners(square, stateFromParams(square, { ...params, scaleX: 2, scaleY: 2 }), [
      [-5, -5],
      [15, -5],
      [15, 15],
      [-5, 15],
    ]);
    // A quarter turn clockwise takes the top-left corner to the top-right.
    expectCorners(square, stateFromParams(square, { ...params, x: 15, angle: 90 }), [
      [20, 0],
      [20, 10],
      [10, 10],
      [10, 0],
    ]);
  });

  it('puts whole turns and flips on the pixel grid', () => {
    // A 3 × 2 layer turned about its centre (1.5, 1) would span x 0.5–2.5.
    const source: Rect = { x: 0, y: 0, width: 3, height: 2 };
    const turned = stateFromParams(source, { ...identityParams(source), angle: 90 });
    for (const corner of cornersOf(source, turned)) {
      expect(Number.isInteger(corner.x) && Number.isInteger(corner.y)).toBe(true);
    }
    // A turn that isn't whole isn't moved.
    const tilted = stateFromParams(source, { ...identityParams(source), angle: 30 });
    expect(mapPoint(stateMatrix(source, tilted), 1.5, 1)).toEqual([1.5, 1]);
  });

  it('fits a projective transform to a box that is no parallelogram', () => {
    const state: TransformState = {
      corners: [point(10, 0), point(90, 0), point(100, 50), point(0, 50)],
      pivot: point(50, 25),
      angle: 0,
    };
    expect(stateMatrix(wide, state)).toHaveLength(9);
    expectCorners(wide, state, [
      [10, 0],
      [90, 0],
      [100, 50],
      [0, 50],
    ]);
    expect(stateParams(wide, state)).toBeNull();
  });
});

describe('scaleState', () => {
  const start = identityState(square);

  it('scales from the opposite corner, which stays put', () => {
    const state = scaleState(square, start, 'se', point(10, 10), point(20, 15), free);
    expect(paramsOf(square, state)).toMatchObject({ scaleX: 2, scaleY: 1.5, angle: 0 });
    expectCorners(square, state, [
      [0, 0],
      [20, 0],
      [20, 15],
      [0, 15],
    ]);
  });

  it('scales about the pivot with Alt', () => {
    const state = scaleState(square, start, 'se', point(10, 10), point(20, 15), {
      proportional: false,
      fromPivot: true,
    });
    expect(paramsOf(square, state)).toMatchObject({ x: 5, y: 5, scaleX: 3, scaleY: 2 });
    expectCorners(square, state, [
      [-10, -5],
      [20, -5],
      [20, 15],
      [-10, 15],
    ]);
  });

  it('keeps the proportions with Shift, following the pointer along the diagonal', () => {
    const state = scaleState(square, start, 'se', point(10, 10), point(20, 15), {
      proportional: true,
      fromPivot: false,
    });
    // (20, 15) projects onto the diagonal at 1.75 times its length: (10·20 + 10·15) / 200.
    const params = paramsOf(square, state);
    expect(params.scaleX).toBeCloseTo(1.75, 12);
    expect(params.scaleY).toBeCloseTo(1.75, 12);
    expectCorners(square, state, [
      [0, 0],
      [17.5, 0],
      [17.5, 17.5],
      [0, 17.5],
    ]);
  });

  it('scales one axis from an edge, or both proportionally about its middle', () => {
    const edge = scaleState(square, start, 'e', point(10, 5), point(16, 9), free);
    expect(paramsOf(square, edge)).toMatchObject({ scaleX: 1.6, scaleY: 1 });
    expectCorners(square, edge, [
      [0, 0],
      [16, 0],
      [16, 10],
      [0, 10],
    ]);
    const both = scaleState(square, start, 'e', point(10, 5), point(16, 9), {
      proportional: true,
      fromPivot: false,
    });
    expectCorners(square, both, [
      [0, -3],
      [16, -3],
      [16, 13],
      [0, 13],
    ]);
  });

  it('follows the handle of a turned box along its own axis', () => {
    // Turned a quarter clockwise, the layer's right edge ('e') is at the bottom.
    const turned = stateFromParams(square, { ...identityParams(square), angle: 90 });
    const state = scaleState(square, turned, 'e', point(5, 10), point(5, 14), free);
    const params = paramsOf(square, state);
    expect(params.scaleX).toBeCloseTo(1.4, 12);
    expect(params.scaleY).toBe(1);
    // The layer's left edge, at the top, stays put.
    expectCorners(square, state, [
      [10, 0],
      [10, 14],
      [0, 14],
      [0, 0],
    ]);
  });

  it('flips when dragged past the anchor and keeps at least a pixel', () => {
    const flipped = scaleState(square, start, 'e', point(10, 5), point(-10, 5), free);
    expect(paramsOf(square, flipped).scaleX).toBe(-1);
    expectCorners(square, flipped, [
      [0, 0],
      [-10, 0],
      [-10, 10],
      [0, 10],
    ]);
    const flat = scaleState(square, start, 'e', point(10, 5), point(0, 5), free);
    expect(paramsOf(square, flat).scaleX).toBeCloseTo(0.1, 12);
  });
});

describe('rotateState', () => {
  const start = identityState(square); // pivot (5, 5)
  const turnedBy = (angle: number) => stateFromParams(square, { ...identityParams(square), angle });

  it('turns by the angle the pointer sweeps about the pivot', () => {
    expect(rotateState(start, point(10, 5), point(5, 10), false).angle).toBeCloseTo(90, 9);
    expect(rotateState(start, point(10, 5), point(5, 0), false).angle).toBeCloseTo(-90, 9);
    expectCorners(square, rotateState(start, point(10, 5), point(5, 10), false), [
      [10, 0],
      [10, 10],
      [0, 10],
      [0, 0],
    ]);
  });

  it('snaps the angle itself to 15° steps with Shift', () => {
    const at = (degrees: number) => {
      const radians = (degrees * Math.PI) / 180;
      return point(5 + 5 * Math.cos(radians), 5 + 5 * Math.sin(radians));
    };
    expect(rotateState(start, at(0), at(37), true).angle).toBe(30);
    const tilted = turnedBy(7);
    expect(rotateState(tilted, at(0), at(10), true).angle).toBe(15);
    expect(rotateState(tilted, at(0), at(-14), true).angle).toBe(0);
  });

  it('keeps the angle within (−180°, 180°]', () => {
    const start170 = turnedBy(170);
    expect(rotateState(start170, point(10, 5), point(5, 10), false).angle).toBeCloseTo(-100, 9);
    expect(normalizeAngle(-180)).toBe(180);
    expect(normalizeAngle(540)).toBe(180);
    expect(Object.is(normalizeAngle(-360), 0)).toBe(true);
  });
});

describe('moveState', () => {
  it('moves by whole pixels, along one axis with Shift', () => {
    const start = identityState(square);
    expect(moveState(start, point(0, 0), point(2.4, -3.6), false).pivot).toEqual({ x: 7, y: 1 });
    expect(moveState(start, point(0, 0), point(2.4, -3.6), true).pivot).toEqual({ x: 5, y: 1 });
    expect(moveState(start, point(0, 0), point(6, 5.5), true).pivot).toEqual({ x: 11, y: 5 });
    expectCorners(square, moveState(start, point(0, 0), point(2.4, -3.6), false), [
      [2, -4],
      [12, -4],
      [12, 6],
      [2, 6],
    ]);
  });
});

describe('orientState', () => {
  const tilted: TransformParams = { x: 40, y: 30, scaleX: 1.5, scaleY: 0.5, angle: 30 };
  const state = stateFromParams(wide, tilted);

  it('flips and turns as the canvas sees it, about the pivot', () => {
    const before = affineOf(wide, state);
    const about = (m: Affine) => multiply(translation(40, 30), multiply(m, translation(-40, -30)));
    expectSameMatrix(
      stateMatrix(wide, orientState(state, 'flip-horizontal')),
      multiply(about(scaling(-1, 1)), before),
    );
    expectSameMatrix(
      stateMatrix(wide, orientState(state, 'flip-vertical')),
      multiply(about(scaling(1, -1)), before),
    );
    expectSameMatrix(
      stateMatrix(wide, orientState(state, 'rotate-cw')),
      multiply(about([0, 1, -1, 0, 0, 0]), before),
    );
  });

  it('comes back after a double flip or four quarter turns', () => {
    const twice = orientState(orientState(state, 'flip-horizontal'), 'flip-horizontal');
    expect(paramsOf(wide, twice)).toEqual(tilted);
    let turned = state;
    for (let i = 0; i < 4; i++) turned = orientState(turned, 'rotate-cw');
    expect(turned.angle).toBeCloseTo(30, 12);
    expect(orientState(state, 'rotate-180').angle).toBe(-150);
    expect(orientState(state, 'rotate-ccw').angle).toBe(-60);
  });
});

describe('hitTransform', () => {
  const corners = cornersOf(wide, identityState(wide));
  const hit = (x: number, y: number, zoom = 1, mode: 'free' | 'scale' | 'rotate' = 'free') =>
    hitTransform(corners, point(x, y), zoom, mode);

  it('finds the handles, the inside and the rotate zone at 100 %', () => {
    expect(hit(50, 25)).toEqual({ kind: 'move' });
    expect(hit(0, 0)).toEqual({ kind: 'scale', handle: 'nw' });
    expect(hit(100, 25)).toEqual({ kind: 'scale', handle: 'e' });
    expect(hit(105, 25)).toEqual({ kind: 'scale', handle: 'e' });
    expect(hit(107, 25)).toBeNull();
    // Up to 6 + 12 CSS px from a corner rotates.
    expect(hit(110, 55)).toEqual({ kind: 'rotate', handle: 'se' });
    expect(hit(-12, -12)).toEqual({ kind: 'rotate', handle: 'nw' });
    expect(hit(115, 63)).toBeNull();
  });

  it('measures the reach in CSS pixels at other zooms', () => {
    // At 400 % the handles reach 1.5 document pixels and the rotate zone 4.5.
    expect(hit(101, 25, 4)).toEqual({ kind: 'scale', handle: 'e' });
    expect(hit(102, 25, 4)).toBeNull();
    expect(hit(103, 53, 4)).toEqual({ kind: 'rotate', handle: 'se' });
    expect(hit(104, 54, 4)).toBeNull();
    // At 25 % they reach 24 document pixels, but at most a third of the box inwards.
    expect(hit(20, 25, 0.25)).toEqual({ kind: 'scale', handle: 'w' });
    expect(hit(30, 25, 0.25)).toEqual({ kind: 'move' });
    expect(hit(50, 16, 0.25)).toEqual({ kind: 'scale', handle: 'n' });
    expect(hit(50, 18, 0.25)).toEqual({ kind: 'move' });
    expect(hit(150, 95, 0.25)).toEqual({ kind: 'rotate', handle: 'se' });
    expect(hit(160, 110, 0.25)).toBeNull();
  });

  it('only scales in Scale mode and rotates from the handles and outside in Rotate', () => {
    expect(hit(110, 55, 1, 'scale')).toBeNull();
    expect(hit(100, 50, 1, 'scale')).toEqual({ kind: 'scale', handle: 'se' });
    expect(hit(100, 50, 1, 'rotate')).toEqual({ kind: 'rotate', handle: 'se' });
    expect(hit(500, 25, 1, 'rotate')).toEqual({ kind: 'rotate', handle: 'e' });
    expect(hit(50, 25, 1, 'rotate')).toEqual({ kind: 'move' });
  });

  it('follows a turned and flipped box', () => {
    // Turned a quarter, the 100 × 50 box spans x 25–75 and y −25–75; its 'e' is at the bottom.
    const turned = cornersOf(wide, stateFromParams(wide, { ...identityParams(wide), angle: 90 }));
    expect(hitTransform(turned, point(50, 75), 1, 'free')).toEqual({
      kind: 'scale',
      handle: 'e',
    });
    expect(hitTransform(turned, point(75, -25), 1, 'free')).toEqual({
      kind: 'scale',
      handle: 'nw',
    });
    const flipped = cornersOf(wide, stateFromParams(wide, { ...identityParams(wide), scaleX: -1 }));
    expect(hitTransform(flipped, point(0, 25), 1, 'free')).toEqual({
      kind: 'scale',
      handle: 'e',
    });
  });
});

describe('transformCursor', () => {
  const corners = cornersOf(wide, identityState(wide));

  it('shows resize arrows along the handle as it is on screen', () => {
    expect(transformCursor(corners, { kind: 'scale', handle: 'e' })).toBe('ew-resize');
    expect(transformCursor(corners, { kind: 'scale', handle: 'se' })).toBe('nwse-resize');
    expect(transformCursor(corners, { kind: 'scale', handle: 'ne' })).toBe('nesw-resize');
    expect(transformCursor(corners, { kind: 'move' })).toBe('move');
    expect(transformCursor(corners, null)).toBe('default');
    const turned = cornersOf(wide, stateFromParams(wide, { ...identityParams(wide), angle: 90 }));
    expect(transformCursor(turned, { kind: 'scale', handle: 'e' })).toBe('ns-resize');
    expect(transformCursor(turned, { kind: 'scale', handle: 'se' })).toBe('nesw-resize');
  });

  it('turns the rotate arrow to face the corner', () => {
    expect(transformCursor(corners, { kind: 'rotate', handle: 'se' })).toBe(rotateCursor(0));
    expect(transformCursor(corners, { kind: 'rotate', handle: 'nw' })).toBe(rotateCursor(180));
    expect(rotateCursor(0)).toMatch(/^url\("data:image\/svg\+xml,.*"\) 11 11, default$/);
    expect(rotateCursor(90)).toMatch(/\) 13 11, default$/);
  });
});

describe('the options-bar fields', () => {
  const params: TransformParams = { x: 40.5, y: -12, scaleX: 1.5, scaleY: -0.75, angle: 33 };
  const state = stateFromParams(wide, params);

  it('round-trip to the same transform in pixels and percent', () => {
    for (const unit of ['px', 'percent'] as const) {
      const fields = transformFields(wide, state, unit);
      for (const field of ['x', 'y', 'width', 'height', 'angle'] as const) {
        const next = withField(wide, state, field, fields[field], unit, false);
        expect(next).not.toBeNull();
        if (next) expectSameMatrix(stateMatrix(wide, next), stateMatrix(wide, state));
      }
    }
    expect(transformFields(wide, state, 'px')).toEqual({
      x: 40.5,
      y: -12,
      width: 150,
      height: -37.5,
      angle: 33,
    });
    expect(transformFields(wide, state, 'percent')).toMatchObject({ width: 150, height: -75 });
  });

  it('scale about the pivot, the other side following with the lock', () => {
    const half = withField(wide, state, 'width', 50, 'percent', true);
    expect(paramsOf(wide, half)).toMatchObject({ x: 40.5, y: -12, scaleX: 0.5, scaleY: -0.25 });
    const unlocked = withField(wide, state, 'height', 25, 'px', false);
    expect(paramsOf(wide, unlocked)).toMatchObject({ scaleX: 1.5, scaleY: 0.5 });
    expect(withField(wide, state, 'angle', 270, 'px', false)?.angle).toBe(-90);
  });

  it('refuse values that make no sense', () => {
    expect(withField(wide, state, 'width', 0, 'px', false)).toBeNull();
    expect(withField(wide, state, 'width', 0.5, 'px', false)).toBeNull();
    expect(withField(wide, state, 'height', 1, 'percent', false)).toBeNull(); // half a pixel
    expect(withField(wide, state, 'width', 200001, 'percent', false)).toBeNull();
    expect(withField(wide, state, 'x', Number.NaN, 'px', false)).toBeNull();
    expect(withField(wide, state, 'y', 1e6, 'px', false)).toBeNull();
    const flipped = withField(wide, state, 'width', -100, 'px', false);
    expect(paramsOf(wide, flipped)).toMatchObject({ scaleX: -1 });
  });

  it('show two decimal places at most, and read back what was typed', () => {
    expect(fieldText(100 / 3)).toBe('33.33');
    expect(fieldText(150)).toBe('150');
    expect(fieldText(-37.5)).toBe('-37.5');
    expect(fieldText(-0.004)).toBe('0');
    expect(parseFieldText(' 45 ')).toBe(45);
    expect(parseFieldText('-12.5')).toBe(-12.5);
    expect(parseFieldText('')).toBeNull();
    expect(parseFieldText('abc')).toBeNull();
    expect(parseFieldText('Infinity')).toBeNull();
  });
});
