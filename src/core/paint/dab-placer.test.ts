import { describe, expect, it } from 'vitest';
import type { Dab } from './dab';
import type { StrokeSample } from './dab-placer';
import { DabPlacer, dabSpacing } from './dab-placer';
import { StrokeMask } from './stroke-mask';

const at = (x: number, y: number, pressure = 1): StrokeSample => ({ x, y, pressure });

/** Positions without floating-point noise from interpolation. */
const round = (value: number) => Math.round(value * 1e9) / 1e9;

function place(placer: DabPlacer, samples: readonly StrokeSample[]): Dab[] {
  const dabs: Dab[] = [];
  for (const sample of samples) placer.add(sample, dabs);
  return dabs;
}

describe('dabSpacing', () => {
  it('is a tenth of the size, at least a pixel', () => {
    expect(dabSpacing(1)).toBe(1);
    expect(dabSpacing(10)).toBe(1);
    expect(dabSpacing(55)).toBe(5.5);
    expect(dabSpacing(500)).toBe(50);
  });
});

describe('DabPlacer', () => {
  it('puts one dab at the first sample', () => {
    const dabs = place(new DabPlacer(20, null), [at(3, 4)]);
    expect(dabs).toEqual([{ x: 3, y: 4, size: 20, strength: 1 }]);
  });

  it('spaces dabs evenly along a fast straight stroke', () => {
    const dabs = place(new DabPlacer(50, null), [at(10, 7.5), at(110, 7.5)]);
    expect(dabs.map((d) => round(d.x))).toEqual(Array.from({ length: 21 }, (_, i) => 10 + 5 * i));
    expect(dabs.every((d) => d.y === 7.5 && d.size === 50)).toBe(true);
  });

  it('carries the leftover distance from one segment into the next', () => {
    // Spacing 5: the first segment is too short for a dab, so the next one lands 2.5 px
    // into the second.
    const placer = new DabPlacer(50, null);
    const dabs = place(placer, [at(10, 0), at(12.5, 0), at(20, 0), at(20, 0), at(23, 4)]);
    expect(dabs.map((d) => [round(d.x), round(d.y)])).toEqual([
      [10, 0],
      [15, 0],
      [20, 0],
      [23, 4],
    ]);
    expect(placer.position).toEqual(at(23, 4));
  });

  it('scales size, opacity or both with interpolated pressure', () => {
    const samples = [at(0, 0, 0.2), at(10, 0, 0.6)];
    // Dabs under 10 px are spaced 1 px apart.
    const bySize = place(new DabPlacer(10, 'size'), samples);
    expect(bySize[0]).toEqual({ x: 0, y: 0, size: 2, strength: 1 });
    expect(bySize.map((d) => [round(d.x), round(d.size), d.strength]).slice(1, 3)).toEqual([
      [1, 2.4, 1],
      [2, 2.8, 1],
    ]);

    const byOpacity = place(new DabPlacer(10, 'opacity'), samples);
    expect(byOpacity.map((d) => round(d.x))).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    expect(byOpacity.every((d) => d.size === 10)).toBe(true);
    expect(byOpacity[5].strength).toBeCloseTo(0.4, 12);
    expect(byOpacity[10].strength).toBeCloseTo(0.6, 12);

    const both = place(new DabPlacer(10, 'both'), samples);
    const last = both[10];
    expect([last.x, round(last.size), round(last.strength)]).toEqual([10, 6, 0.6]);
  });

  it('ignores pressure unless told to use it', () => {
    const dabs = place(new DabPlacer(10, null), [at(0, 0, 0.1), at(2, 0, 0)]);
    expect(dabs).toEqual([
      { x: 0, y: 0, size: 10, strength: 1 },
      { x: 1, y: 0, size: 10, strength: 1 },
      { x: 2, y: 0, size: 10, strength: 1 },
    ]);
  });

  it('skips dabs with no pressure', () => {
    const dabs = place(new DabPlacer(10, 'size'), [at(0, 0, 0), at(1, 0, 0)]);
    expect(dabs).toEqual([]);
  });
});

describe('strokes in a mask', () => {
  it('leave no gaps along a fast straight stroke', () => {
    // A hard 10 px brush dragged 100 px in one move: every pixel within 4 px of the line
    // is fully covered from end to end.
    const mask = new StrokeMask(130, 30);
    const clip = { x: 0, y: 0, width: 130, height: 30 };
    for (const dab of place(new DabPlacer(10, null), [at(10, 15), at(110, 15)])) {
      mask.stamp(dab, 1, clip, null);
    }
    for (let x = 10; x < 110; x++) {
      for (let y = 11; y < 19; y++) expect(mask.valueAt(x, y)).toBe(255);
    }
    // The edge rows' centres lie √(0.5² + 4.5²) ≈ 4.5277 px from the nearest dab, so they
    // get the anti-aliased edge: (5.5 − 4.5277) × 255 = 247.9. So do the round ends.
    for (let x = 10; x < 110; x++) {
      expect(mask.valueAt(x, 10)).toBe(248);
      expect(mask.valueAt(x, 19)).toBe(248);
      expect(mask.valueAt(x, 9)).toBe(0);
      expect(mask.valueAt(x, 20)).toBe(0);
    }
    expect([4, 5, 6].map((x) => mask.valueAt(x, 15))).toEqual([0, 248, 255]);
    expect([113, 114, 115].map((x) => mask.valueAt(x, 15))).toEqual([255, 248, 0]);
  });
});
