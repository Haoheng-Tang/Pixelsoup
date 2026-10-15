import type { Interpolation } from '../../core';
import type { TransformUnit } from './transform-math';

export interface TransformSettings {
  /** How the pixels are resampled, in the preview and when applied. */
  readonly interpolation: Interpolation;
  /** Keep the proportions when the width or height is typed, or a handle dragged. */
  readonly lockAspect: boolean;
  /** Whether the options bar shows the width and height in pixels or as a percentage. */
  readonly unit: TransformUnit;
}

const DEFAULT_TRANSFORM: TransformSettings = {
  interpolation: 'bilinear',
  lockAspect: false,
  unit: 'percent',
};

/**
 * Free Transform's settings, kept for the session (not per transform) and observable so
 * the tool-options bar can show them.
 */
export class TransformOptions {
  private current: TransformSettings = DEFAULT_TRANSFORM;
  private readonly listeners = new Set<() => void>();

  /** The current settings: a new object after each change, the same one until then. */
  get settings(): TransformSettings {
    return this.current;
  }

  set(changes: Partial<TransformSettings>): void {
    const next = { ...this.current, ...changes };
    const prev = this.current;
    if (
      next.interpolation === prev.interpolation &&
      next.lockAspect === prev.lockAspect &&
      next.unit === prev.unit
    ) {
      return;
    }
    this.current = next;
    for (const listener of [...this.listeners]) listener();
  }

  readonly subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
}
