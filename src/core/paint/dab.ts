import type { Rect } from '../geometry';
import { roundRectOut } from '../geometry';

/** Brush diameters, in pixels. */
export const MIN_BRUSH_SIZE = 1;
export const MAX_BRUSH_SIZE = 500;

/**
 * One mark of a round brush, `size` pixels across, centred on (x, y) in document space.
 * Pixel (px, py) spans [px, px + 1), so its centre is at (px + 0.5, py + 0.5).
 */
export interface Dab {
  readonly x: number;
  readonly y: number;
  readonly size: number;
  /** Scales the dab's coverage, 0–1. Pen pressure sets it when it controls opacity. */
  readonly strength: number;
}

/**
 * Coverage (0–1) of the pixel whose centre lies `distance` pixels from the centre of a
 * dab with the given radius and hardness (0–1). See `DabProfile`.
 */
export function dabCoverage(distance: number, radius: number, hardness: number): number {
  return new DabProfile(radius, hardness).coverage(distance);
}

/**
 * The shape of a round dab with the given radius and hardness (0–1).
 *
 * Its profile is 1 out to hardness × radius, then falls smoothly (1 − smoothstep) to 0 at
 * the radius. A pixel's coverage is that profile averaged across the pixel along the
 * radius, so a pixel wholly inside hardness × radius is fully covered, and even a fully
 * hard dab gets a 1-pixel anti-aliased edge.
 */
export class DabProfile {
  /** Radius out to which the profile is 1. */
  readonly inner: number;
  private readonly falloff: number;
  private readonly perFalloff: number;
  /** The profile's integral from 0 to the radius or beyond. */
  private readonly total: number;

  constructor(
    readonly radius: number,
    hardness: number,
  ) {
    this.inner = radius * hardness;
    this.falloff = radius - this.inner;
    this.perFalloff = this.falloff > 0 ? 1 / this.falloff : 0;
    this.total = this.inner + this.falloff / 2;
  }

  /** Coverage (0–1) of the pixel whose centre lies `distance` pixels from the centre. */
  coverage(distance: number): number {
    if (distance + 0.5 <= this.inner) return 1;
    if (distance >= this.radius + 0.5) return 0;
    const outer = this.integral(distance + 0.5);
    return distance >= 0.5
      ? outer - this.integral(distance - 0.5)
      : outer + this.integral(0.5 - distance);
  }

  /** The integral of the profile from 0 to x ≥ 0. */
  private integral(x: number): number {
    if (x <= this.inner) return x;
    if (x >= this.radius) return this.total;
    const t = (x - this.inner) * this.perFalloff;
    const t3 = t * t * t;
    // ∫ 1 − (3t² − 2t³) dt = t − t³ + t⁴ / 2
    return this.inner + this.falloff * (t - t3 + 0.5 * t3 * t);
  }
}

/** The pixels a dab can cover. */
export function dabBounds(dab: Dab): Rect {
  const reach = dab.size / 2 + 0.5;
  return roundRectOut({
    x: dab.x - reach,
    y: dab.y - reach,
    width: 2 * reach,
    height: 2 * reach,
  });
}
