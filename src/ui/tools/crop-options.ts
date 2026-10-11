import { assertNever } from '../../core';

/** The shapes the crop box can keep: none, the image's own, presets, or a custom ratio. */
export type CropAspect = 'free' | 'original' | '1:1' | '4:3' | '3:2' | '16:9' | 'custom';

export interface CropSettings {
  readonly aspect: CropAspect;
  /** The custom ratio, width : height. Both positive. */
  readonly customWidth: number;
  readonly customHeight: number;
  /**
   * Trim every layer to the cropped canvas. Off (the default), layers keep the pixels
   * outside it, which come back if the canvas grows again.
   */
  readonly deleteCropped: boolean;
}

/** The largest number either side of a custom ratio may be. */
export const MAX_RATIO_TERM = 10000;

const DEFAULT_CROP: CropSettings = {
  aspect: 'free',
  customWidth: 5,
  customHeight: 4,
  deleteCropped: false,
};

/** The ratio a crop box keeps, width / height. */
export interface CropRatio {
  readonly ratio: number;
  /** A preset fits a portrait box as well as a landscape one; a custom ratio is exact. */
  readonly turns: boolean;
}

/** The ratio `settings` keep the crop box to on a `width` × `height` image; null for Free. */
export function cropRatio(settings: CropSettings, width: number, height: number): CropRatio | null {
  switch (settings.aspect) {
    case 'free':
      return null;
    case 'original':
      return { ratio: width / height, turns: true };
    case '1:1':
      return { ratio: 1, turns: false };
    case '4:3':
      return { ratio: 4 / 3, turns: true };
    case '3:2':
      return { ratio: 3 / 2, turns: true };
    case '16:9':
      return { ratio: 16 / 9, turns: true };
    case 'custom':
      return { ratio: settings.customWidth / settings.customHeight, turns: false };
    default:
      return assertNever(settings.aspect);
  }
}

/** The ratio for a landscape box (at least as wide as it is tall) or a portrait one. */
export function orientedRatio({ ratio, turns }: CropRatio, landscape: boolean): number {
  if (!turns) return ratio;
  const wide = Math.max(ratio, 1 / ratio);
  return landscape ? wide : 1 / wide;
}

function validTerm(value: number): boolean {
  return Number.isFinite(value) && value > 0 && value <= MAX_RATIO_TERM;
}

/** The Crop tool's settings, observable so the tool-options bar can show them. */
export class CropOptions {
  private current: CropSettings = DEFAULT_CROP;
  private readonly listeners = new Set<() => void>();

  /** The current settings: a new object after each change, the same one until then. */
  get settings(): CropSettings {
    return this.current;
  }

  /** Changes some settings; custom ratio terms outside 0–`MAX_RATIO_TERM` are ignored. */
  set(changes: Partial<CropSettings>): void {
    const next = { ...this.current, ...changes };
    if (!validTerm(next.customWidth)) next.customWidth = this.current.customWidth;
    if (!validTerm(next.customHeight)) next.customHeight = this.current.customHeight;
    const prev = this.current;
    if (
      next.aspect === prev.aspect &&
      next.customWidth === prev.customWidth &&
      next.customHeight === prev.customHeight &&
      next.deleteCropped === prev.deleteCropped
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
