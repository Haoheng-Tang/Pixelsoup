import type { Editor, PixelSource, Selection } from '../../core';
import { floodSelection } from '../../core';

/** How the Magic Wand and the Paint Bucket pick the region around the pixel clicked. */
export interface RegionSettings {
  /** How far (0–255) each channel may be from the clicked pixel's. */
  readonly tolerance: number;
  /** Only pixels connected to the one clicked, rather than every matching pixel. */
  readonly contiguous: boolean;
  /** Soften the region's edge by a pixel. */
  readonly antiAlias: boolean;
  /** Compare the composite of the visible layers rather than the active layer's pixels. */
  readonly sampleAll: boolean;
  /** The Paint Bucket's opacity, in percent, 1–100. */
  readonly opacity: number;
}

export const DEFAULT_REGION: RegionSettings = {
  tolerance: 32,
  contiguous: true,
  antiAlias: true,
  sampleAll: false,
  opacity: 100,
};

function wholeNumber(value: number, min: number, max: number, fallback: number): number {
  return Number.isFinite(value) ? Math.min(Math.max(Math.round(value), min), max) : fallback;
}

/**
 * A region tool's settings, one set per tool, observable so the tool-options bar can show
 * and change them.
 */
export class RegionOptions {
  private current: RegionSettings;
  private readonly listeners = new Set<() => void>();

  constructor(initial: Partial<RegionSettings> = {}) {
    this.current = DEFAULT_REGION;
    this.set(initial);
  }

  /** The current settings: a new object after each change, the same one until then. */
  get settings(): RegionSettings {
    return this.current;
  }

  /** Changes some settings, rounding and clamping numbers into range. */
  set(changes: Partial<RegionSettings>): void {
    const merged = { ...this.current, ...changes };
    const next: RegionSettings = {
      tolerance: wholeNumber(merged.tolerance, 0, 255, this.current.tolerance),
      contiguous: merged.contiguous,
      antiAlias: merged.antiAlias,
      sampleAll: merged.sampleAll,
      opacity: wholeNumber(merged.opacity, 1, 100, this.current.opacity),
    };
    const old = this.current;
    if (
      next.tolerance === old.tolerance &&
      next.contiguous === old.contiguous &&
      next.antiAlias === old.antiAlias &&
      next.sampleAll === old.sampleAll &&
      next.opacity === old.opacity
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

/**
 * The region around canvas position (x, y) whose colours match the pixel there, as the
 * settings pick it (`floodSelection`). Null off the canvas.
 */
export function regionAt(
  editor: Editor,
  x: number,
  y: number,
  settings: RegionSettings,
): Selection | null {
  const layerId = editor.activeLayerId;
  let source: PixelSource;
  if (settings.sampleAll) source = 'composite';
  else if (layerId !== null) source = { layerId };
  else return null;
  const { tolerance, contiguous, antiAlias } = settings;
  return floodSelection(editor.document, x, y, { tolerance, contiguous, antiAlias, source });
}
