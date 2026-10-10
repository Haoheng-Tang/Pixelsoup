import type { Anchor, Interpolation } from '../../core';

/** How Image Size takes a size: in pixels, or as a percentage of the current size. */
export type SizeUnit = 'pixels' | 'percent';

/** What the Image Size dialog remembers between uses. */
export interface ImageSizeSettings {
  readonly unit: SizeUnit;
  /** Changing one side changes the other in proportion. */
  readonly keepAspect: boolean;
  readonly interpolation: Interpolation;
}

/** What the Image Size dialog asks for: the new size in pixels, and its settings. */
export interface ImageSizeOptions extends ImageSizeSettings {
  readonly width: number;
  readonly height: number;
}

export const DEFAULT_IMAGE_SIZE_SETTINGS: ImageSizeSettings = {
  unit: 'pixels',
  keepAspect: true,
  interpolation: 'bilinear',
};

/** What the Canvas Size dialog remembers between uses. */
export interface CanvasSizeSettings {
  /** Sizes are entered as changes to the current size. */
  readonly relative: boolean;
}

/**
 * What the Canvas Size dialog asks for: the new size in pixels, the side of the canvas
 * the image keeps to along each axis, and its settings.
 */
export interface CanvasSizeOptions extends CanvasSizeSettings {
  readonly width: number;
  readonly height: number;
  readonly horizontal: Anchor;
  readonly vertical: Anchor;
}

export const DEFAULT_CANVAS_SIZE_SETTINGS: CanvasSizeSettings = { relative: false };
