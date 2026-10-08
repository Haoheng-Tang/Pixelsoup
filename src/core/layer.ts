import type { Rect } from './geometry';
import type { PixelBuffer } from './pixel-buffer';
import { clonePixelBuffer, createPixelBuffer } from './pixel-buffer';

/**
 * How a layer combines with the pixels beneath it. Only 'normal' exists for now;
 * new modes are added to this union and handled in the compositor.
 */
export type BlendMode = 'normal';

export const BLEND_MODES: readonly BlendMode[] = ['normal'];

export function isBlendMode(value: unknown): value is BlendMode {
  return (BLEND_MODES as readonly unknown[]).includes(value);
}

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

interface RasterLayerProperties {
  /** Must be unique within the document; get one from `createLayerId(doc)`. */
  id: LayerId;
  name: string;
  x?: number;
  y?: number;
  opacity?: number;
  visible?: boolean;
  blendMode?: BlendMode;
}

/** Either a size for a new transparent buffer, or existing pixels the layer takes ownership of. */
export type RasterLayerOptions = RasterLayerProperties &
  ({ width: number; height: number } | { pixels: PixelBuffer });

/** Creates a raster layer. Does not add it to a document. */
export function createRasterLayer(options: RasterLayerOptions): RasterLayer {
  return {
    kind: 'raster',
    id: options.id,
    name: options.name,
    visible: options.visible ?? true,
    opacity: clampOpacity(options.opacity ?? 1),
    blendMode: options.blendMode ?? 'normal',
    x: options.x ?? 0,
    y: options.y ?? 0,
    pixels: 'pixels' in options ? options.pixels : createPixelBuffer(options.width, options.height),
  };
}

/**
 * A copy of `layer` with its own copy of the pixels and every other property, under a
 * new ID and name. Does not add it to a document.
 */
export function duplicateLayer(layer: Layer, id: LayerId, name: string): Layer {
  switch (layer.kind) {
    case 'raster':
      return { ...layer, id, name, pixels: clonePixelBuffer(layer.pixels) };
    default:
      return assertNever(layer.kind);
  }
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
      return rasterBounds(layer);
    default:
      return assertNever(layer.kind);
  }
}

/** Canvas-space area of a raster layer's pixels. */
export function rasterBounds(layer: RasterLayer): Rect {
  return { x: layer.x, y: layer.y, width: layer.pixels.width, height: layer.pixels.height };
}

/** A canvas-space rect in the raster layer's own pixel coordinates. */
export function toLayerSpace(layer: RasterLayer, area: Rect): Rect {
  return { ...area, x: area.x - layer.x, y: area.y - layer.y };
}

export function assertNever(value: never): never {
  throw new Error(`Unhandled variant: ${String(value)}`);
}
