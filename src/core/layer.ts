import type { Rect } from './geometry';
import type { PixelBuffer } from './pixel-buffer';
import { createPixelBuffer } from './pixel-buffer';

/**
 * How a layer combines with the pixels beneath it. Only 'normal' exists for now;
 * new modes are added to this union and handled in the compositor.
 */
export type BlendMode = 'normal';

export type LayerId = string;

/** Properties shared by every layer kind. */
export interface LayerBase {
  readonly id: LayerId;
  name: string;
  visible: boolean;
  /** 0 (transparent) – 1 (opaque). Multiplies the layer's own alpha. */
  opacity: number;
  blendMode: BlendMode;
}

/** A layer backed by its own pixel buffer, positioned at an offset on the canvas. */
export interface RasterLayer extends LayerBase {
  readonly kind: 'raster';
  /** Canvas-space position of the buffer's top-left pixel. May be negative. */
  x: number;
  y: number;
  pixels: PixelBuffer;
}

/**
 * Discriminated union of all layer kinds, keyed by `kind`. Future text and adjustment
 * layers are added as new members (e.g. `TextLayer`, `AdjustmentLayer`); code that
 * switches on `kind` uses `assertNever` so the compiler flags every place to update.
 */
export type Layer = RasterLayer;

export type LayerKind = Layer['kind'];

let nextLayerNumber = 1;

export function createLayerId(): LayerId {
  return `layer-${nextLayerNumber++}`;
}

export interface RasterLayerOptions {
  name: string;
  width: number;
  height: number;
  x?: number;
  y?: number;
  opacity?: number;
  visible?: boolean;
  blendMode?: BlendMode;
}

export function createRasterLayer(options: RasterLayerOptions): RasterLayer {
  return {
    kind: 'raster',
    id: createLayerId(),
    name: options.name,
    visible: options.visible ?? true,
    opacity: clampOpacity(options.opacity ?? 1),
    blendMode: options.blendMode ?? 'normal',
    x: options.x ?? 0,
    y: options.y ?? 0,
    pixels: createPixelBuffer(options.width, options.height),
  };
}

export function clampOpacity(value: number): number {
  if (Number.isNaN(value)) return 0;
  return Math.min(1, Math.max(0, value));
}

/**
 * Canvas-space area the layer can affect when composited, or null for layers that
 * affect the whole canvas (e.g. future adjustment layers).
 */
export function layerBounds(layer: Layer): Rect | null {
  switch (layer.kind) {
    case 'raster':
      return { x: layer.x, y: layer.y, width: layer.pixels.width, height: layer.pixels.height };
    default:
      return assertNever(layer.kind);
  }
}

export function assertNever(value: never): never {
  throw new Error(`Unhandled variant: ${String(value)}`);
}
