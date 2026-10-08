import { describe, expect, it } from 'vitest';
import { dabBounds, dabCoverage } from './dab';

describe('dabCoverage', () => {
  it('gives a hard dab a one-pixel anti-aliased edge', () => {
    // Radius 5: pixels wholly inside it are covered, then coverage falls linearly from 1
    // at 4.5 px to 0 at 5.5 px.
    expect(dabCoverage(0, 5, 1)).toBe(1);
    expect(dabCoverage(4.5, 5, 1)).toBe(1);
    expect(dabCoverage(4.75, 5, 1)).toBeCloseTo(0.75, 12);
    expect(dabCoverage(5, 5, 1)).toBeCloseTo(0.5, 12);
    expect(dabCoverage(5.25, 5, 1)).toBeCloseTo(0.25, 12);
    expect(dabCoverage(5.5, 5, 1)).toBe(0);
    expect(dabCoverage(8, 5, 1)).toBe(0);
  });

  it('covers a 1 px hard dab on a pixel centre exactly', () => {
    expect(dabCoverage(0, 0.5, 1)).toBe(1);
    expect(dabCoverage(1, 0.5, 1)).toBe(0);
  });

  it('falls smoothly from the centre of a soft dab', () => {
    // Hardness 0, radius 5: the profile is 1 − smoothstep(d / 5), with integral
    // F(t) = 5 (t − t³ + t⁴/2). At the centre: 2 F(0.1) = 10 (0.1 − 0.001 + 0.00005).
    expect(dabCoverage(0, 5, 0)).toBeCloseTo(0.9905, 12);
    // Halfway out: F(0.6) − F(0.4) = 5 (0.4488 − 0.3488).
    expect(dabCoverage(2.5, 5, 0)).toBeCloseTo(0.5, 12);
    // At the radius: F(1) − F(0.9) = 2.5 − 5 (0.9 − 0.729 + 0.32805).
    expect(dabCoverage(5, 5, 0)).toBeCloseTo(0.00475, 12);
    expect(dabCoverage(5.5, 5, 0)).toBe(0);
  });

  it('is full inside hardness × radius and falls off beyond it', () => {
    // Radius 10, hardness 50 %: full to 5 px, halfway down at 7.5 px, gone at 10.5 px.
    expect(dabCoverage(4.5, 10, 0.5)).toBe(1);
    expect(dabCoverage(7.5, 10, 0.5)).toBeCloseTo(0.5, 12);
    expect(dabCoverage(10.5, 10, 0.5)).toBe(0);
  });

  it('never rises with distance', () => {
    for (const hardness of [0, 0.3, 0.8, 1]) {
      let previous = 1;
      for (let d = 0; d < 12; d += 0.05) {
        const coverage = dabCoverage(d, 10, hardness);
        expect(coverage).toBeLessThanOrEqual(previous + 1e-12);
        previous = coverage;
      }
    }
  });
});

describe('dabBounds', () => {
  it('covers every pixel the dab can reach', () => {
    // 5.5 px either side of the centre (radius + half a pixel), rounded out.
    expect(dabBounds({ x: 10, y: 10, size: 10, strength: 1 })).toEqual({
      x: 4,
      y: 4,
      width: 12,
      height: 12,
    });
    expect(dabBounds({ x: 3.5, y: 0.5, size: 1, strength: 1 })).toEqual({
      x: 2,
      y: -1,
      width: 3,
      height: 3,
    });
  });
});
