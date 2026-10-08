import type { Dab } from './dab';

/** A pointer position along a stroke, in document space. */
export interface StrokeSample {
  readonly x: number;
  readonly y: number;
  /** Pen pressure, 0–1. 1 without a pen. */
  readonly pressure: number;
}

/** What pen pressure scales: the dabs' size, their opacity, or both. */
export type PressureTarget = 'size' | 'opacity' | 'both';

/** Distance between the centres of successive dabs: 10 % of their size, at least 1 px. */
export function dabSpacing(size: number): number {
  return Math.max(1, size / 10);
}

/**
 * Places a stroke's dabs: one at its first sample, then evenly spaced along the straight
 * segments between samples. The distance left over at the end of one segment carries
 * into the next, so the spacing doesn't depend on how the samples arrive. Pressure is
 * interpolated along each segment.
 */
export class DabPlacer {
  private last: StrokeSample | null = null;
  /** Distance from `last` to the next dab. */
  private ahead = 0;

  /**
   * @param size the dabs' size at full pressure, in pixels.
   * @param pressure what pen pressure scales, or null to ignore it.
   */
  constructor(
    readonly size: number,
    readonly pressure: PressureTarget | null,
  ) {}

  /** The sample the stroke has reached, or null before the first. */
  get position(): StrokeSample | null {
    return this.last;
  }

  /** Extends the stroke to `sample`, appending the dabs that places to `out`. */
  add(sample: StrokeSample, out: Dab[] = []): Dab[] {
    const last = this.last;
    this.last = sample;
    if (!last) {
      this.ahead = this.place(sample.x, sample.y, sample.pressure, out);
      return out;
    }
    const dx = sample.x - last.x;
    const dy = sample.y - last.y;
    const length = Math.hypot(dx, dy);
    let along = this.ahead;
    while (along <= length) {
      const t = along / length;
      const pressure = last.pressure + (sample.pressure - last.pressure) * t;
      along += this.place(last.x + dx * t, last.y + dy * t, pressure, out);
    }
    this.ahead = along - length;
    return out;
  }

  /** Adds a dab at (x, y) unless it would be empty, and returns the spacing after it. */
  private place(x: number, y: number, pressure: number, out: Dab[]): number {
    const p = Math.min(Math.max(pressure, 0), 1);
    const target = this.pressure;
    const size = target === 'size' || target === 'both' ? this.size * p : this.size;
    const strength = target === 'opacity' || target === 'both' ? p : 1;
    if (size > 0 && strength > 0) out.push({ x, y, size, strength });
    return dabSpacing(size);
  }
}
