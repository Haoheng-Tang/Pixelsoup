import { describe, expect, it } from 'vitest';
import { CanvasPyramid, drawScale, pyramidLevel } from './canvas-pyramid';

describe('pyramidLevel', () => {
  it('draws the image itself from just over half its size up', () => {
    expect(pyramidLevel(6400, 4000, 4)).toBe(0);
    expect(pyramidLevel(6400, 4000, 1)).toBe(0);
    expect(pyramidLevel(6400, 4000, 0.51)).toBe(0);
  });

  it('picks the smallest copy no smaller than the result', () => {
    expect(pyramidLevel(6400, 4000, 0.5)).toBe(1);
    expect(pyramidLevel(6400, 4000, 0.26)).toBe(1);
    expect(pyramidLevel(6400, 4000, 0.25)).toBe(2);
    // A 6400 × 4000 layer seen whole at 15 % on a 125 % display.
    expect(pyramidLevel(6400, 4000, 0.15 * 1.25)).toBe(2);
    expect(pyramidLevel(6400, 4000, 0.1)).toBe(3);
  });

  it('stops at 1 × 1', () => {
    // 5 × 3 → 3 × 2 → 2 × 1 → 1 × 1.
    expect(pyramidLevel(5, 3, 0.001)).toBe(3);
    expect(pyramidLevel(1, 1, 0.001)).toBe(0);
    expect(pyramidLevel(4, 1, 0)).toBe(2);
  });
});

describe('drawScale', () => {
  it('is the lesser stretch of the two axes', () => {
    expect(drawScale(1, 0, 0, 1)).toBe(1);
    expect(drawScale(2, 0, 0, 0.5)).toBe(0.5);
    expect(drawScale(-3, 0, 0, 2)).toBe(2);
  });

  it("doesn't change with rotation", () => {
    const r = Math.SQRT1_2;
    // 0.5 × a 45° turn.
    expect(drawScale(0.5 * r, 0.5 * r, -0.5 * r, 0.5 * r)).toBeCloseTo(0.5, 12);
  });
});

describe('CanvasPyramid', () => {
  /** Fake images that record how each was made. */
  function pyramid(width: number, height: number) {
    const made: string[] = [];
    const base = { name: 'base' } as unknown as CanvasImageSource;
    const shrink = (source: CanvasImageSource, w: number, h: number) => {
      const name = `${(source as unknown as { name: string }).name}>${String(w)}x${String(h)}`;
      made.push(name);
      return { name } as unknown as CanvasImageSource;
    };
    return { made, base, pyramid: new CanvasPyramid(base, width, height, shrink) };
  }
  const name = (image: CanvasImageSource) => (image as unknown as { name: string }).name;

  it('draws the image itself from half its size up, making no copies', () => {
    const { made, base, pyramid: p } = pyramid(5, 3);
    expect(p.at(1)).toBe(base);
    expect(p.at(0.6)).toBe(base);
    expect(made).toEqual([]);
  });

  it('makes each copy from the one before, rounding sizes up, when first needed', () => {
    const { made, pyramid: p } = pyramid(5, 3);
    expect(name(p.at(0.2))).toBe('base>3x2>2x1');
    expect(made).toEqual(['base>3x2', 'base>3x2>2x1']);
    expect(name(p.at(0.4))).toBe('base>3x2');
    expect(name(p.at(0.01))).toBe('base>3x2>2x1>1x1');
    expect(made).toHaveLength(3);
  });
});
