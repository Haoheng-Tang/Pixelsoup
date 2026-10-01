import { describe, expect, it } from 'vitest';
import { intersectRects, rect, roundRectOut, unionRects } from './geometry';

describe('geometry', () => {
  it('intersects overlapping rects', () => {
    expect(intersectRects(rect(0, 0, 10, 10), rect(5, 5, 10, 10))).toEqual(rect(5, 5, 5, 5));
  });

  it('returns null for touching or disjoint rects', () => {
    expect(intersectRects(rect(0, 0, 10, 10), rect(10, 0, 5, 5))).toBeNull();
    expect(intersectRects(rect(0, 0, 10, 10), rect(20, 20, 5, 5))).toBeNull();
  });

  it('unions rects and ignores null/empty inputs', () => {
    expect(unionRects(rect(0, 0, 2, 2), rect(5, 5, 1, 1))).toEqual(rect(0, 0, 6, 6));
    expect(unionRects(null, rect(1, 1, 1, 1))).toEqual(rect(1, 1, 1, 1));
    expect(unionRects(rect(0, 0, 0, 5), null)).toBeNull();
  });

  it('rounds fractional rects outward', () => {
    expect(roundRectOut(rect(0.5, 1.2, 2, 2))).toEqual(rect(0, 1, 3, 3));
  });
});
