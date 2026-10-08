import type { Rgb } from '../../core';
import { sameRgb } from './color-math';

export type ColorSlot = 'foreground' | 'background';

export const DEFAULT_FOREGROUND: Rgb = [0, 0, 0];
export const DEFAULT_BACKGROUND: Rgb = [255, 255, 255];

/**
 * The foreground and background colours. Painting tools paint with the foreground and
 * the eyedropper picks either. Session state, like the active tool: not part of the
 * document, not saved and never an undo step.
 */
export class Colors {
  private current: Record<ColorSlot, Rgb> = {
    foreground: DEFAULT_FOREGROUND,
    background: DEFAULT_BACKGROUND,
  };
  private revisionCounter = 0;
  private readonly listeners = new Set<() => void>();

  get foreground(): Rgb {
    return this.current.foreground;
  }

  get background(): Rgb {
    return this.current.background;
  }

  /** Increments on every change, for React external stores. */
  get revision(): number {
    return this.revisionCounter;
  }

  get(slot: ColorSlot): Rgb {
    return this.current[slot];
  }

  /** Sets a colour; channels are rounded and clamped to 0–255. */
  set(slot: ColorSlot, color: Rgb): void {
    const rgb: Rgb = [byte(color[0]), byte(color[1]), byte(color[2])];
    if (sameRgb(rgb, this.current[slot])) return;
    this.current = { ...this.current, [slot]: rgb };
    this.changed();
  }

  /** Swaps the foreground and background colours (X). */
  swap(): void {
    const { foreground, background } = this.current;
    if (sameRgb(foreground, background)) return;
    this.current = { foreground: background, background: foreground };
    this.changed();
  }

  /** Back to a black foreground and a white background (D). */
  reset(): void {
    this.set('foreground', DEFAULT_FOREGROUND);
    this.set('background', DEFAULT_BACKGROUND);
  }

  readonly subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  private changed(): void {
    this.revisionCounter++;
    for (const listener of [...this.listeners]) listener();
  }
}

function byte(value: number): number {
  return Number.isFinite(value) ? Math.min(255, Math.max(0, Math.round(value))) : 0;
}
