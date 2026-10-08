import type { PressureTarget } from '../../core';

export const MIN_BRUSH_SIZE = 1;
export const MAX_BRUSH_SIZE = 500;

/** Sizes `[` and `]` step through: finer steps for small brushes, as in Photoshop. */
const SIZE_STOPS = [
  1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100, 125, 150, 175, 200, 250, 300,
  400, 500,
];
/** Hardness steps by a quarter. */
const HARDNESS_STEP = 25;

/** A painting tool's brush. */
export interface BrushSettings {
  /** Diameter in pixels, 1–500. */
  readonly size: number;
  /** How much of the radius paints at full strength, in percent. */
  readonly hardness: number;
  /** The most a stroke covers, in percent, 1–100. */
  readonly opacity: number;
  /** Whether pen pressure scales the dabs. */
  readonly pressure: boolean;
  /** What pen pressure scales. */
  readonly pressureTarget: PressureTarget;
}

export const DEFAULT_BRUSH: BrushSettings = {
  size: 30,
  hardness: 100,
  opacity: 100,
  pressure: true,
  pressureTarget: 'size',
};

function wholeNumber(value: number, min: number, max: number, fallback: number): number {
  return Number.isFinite(value) ? Math.min(Math.max(Math.round(value), min), max) : fallback;
}

/** Settings rounded and clamped into range; numbers that aren't finite keep `fallback`'s. */
function normalized(settings: BrushSettings, fallback: BrushSettings): BrushSettings {
  return {
    size: wholeNumber(settings.size, MIN_BRUSH_SIZE, MAX_BRUSH_SIZE, fallback.size),
    hardness: wholeNumber(settings.hardness, 0, 100, fallback.hardness),
    opacity: wholeNumber(settings.opacity, 1, 100, fallback.opacity),
    pressure: settings.pressure,
    pressureTarget: settings.pressureTarget,
  };
}

function sameSettings(a: BrushSettings, b: BrushSettings): boolean {
  return (
    a.size === b.size &&
    a.hardness === b.hardness &&
    a.opacity === b.opacity &&
    a.pressure === b.pressure &&
    a.pressureTarget === b.pressureTarget
  );
}

/**
 * Position along a size slider, 0–1, for a brush size. Sizes grow exponentially along the
 * slider, so that small brushes get as much of it as large ones.
 */
export function sizeToSlider(size: number): number {
  return Math.log(size) / Math.log(MAX_BRUSH_SIZE);
}

/** The brush size at a position along a size slider, 0–1. */
export function sliderToSize(position: number): number {
  return wholeNumber(MAX_BRUSH_SIZE ** position, MIN_BRUSH_SIZE, MAX_BRUSH_SIZE, MIN_BRUSH_SIZE);
}

/** A painting tool's brush settings, observable so the tool-options bar can show them. */
export class BrushOptions {
  private current: BrushSettings;
  private readonly listeners = new Set<() => void>();

  constructor(initial: Partial<BrushSettings> = {}) {
    this.current = normalized({ ...DEFAULT_BRUSH, ...initial }, DEFAULT_BRUSH);
  }

  /** The current settings: a new object after each change, the same one until then. */
  get settings(): BrushSettings {
    return this.current;
  }

  /** Changes some settings, rounding and clamping numbers into range. */
  set(changes: Partial<BrushSettings>): void {
    const next = normalized({ ...this.current, ...changes }, this.current);
    if (sameSettings(next, this.current)) return;
    this.current = next;
    for (const listener of [...this.listeners]) listener();
  }

  /** Steps the size to the next stop down or up, and returns the new size. */
  stepSize(direction: -1 | 1): number {
    const { size } = this.current;
    const next =
      direction > 0 ? SIZE_STOPS.find((s) => s > size) : SIZE_STOPS.findLast((s) => s < size);
    if (next !== undefined) this.set({ size: next });
    return this.current.size;
  }

  /** Steps the hardness to the next quarter down or up, and returns the new hardness. */
  stepHardness(direction: -1 | 1): number {
    const steps = this.current.hardness / HARDNESS_STEP;
    const next = direction > 0 ? Math.floor(steps) + 1 : Math.ceil(steps) - 1;
    this.set({ hardness: next * HARDNESS_STEP });
    return this.current.hardness;
  }

  readonly subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
}
