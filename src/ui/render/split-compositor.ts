import type { ImageDocument, Layer, LayerId, Rect } from '../../core';
import {
  CpuCompositor,
  documentBounds,
  findLayerIndex,
  intersectRects,
  layerBounds,
  unionRects,
} from '../../core';
import type { ToolOverlay } from '../tools/tool';

/** What `SplitCompositor.composite` brought up to date, in canvas pixels. */
export interface SplitUpdate {
  /** Areas of `below`'s output. */
  readonly below: readonly Rect[];
  /** Areas of `above`'s output. A new `above` comes with every area its layers cover. */
  readonly above: readonly Rect[];
}

/**
 * Composites a document for the viewport, optionally leaving out one layer: the layer under
 * Free Transform, whose preview the viewport draws in its place. The document isn't changed.
 *
 * `below` composites the visible layers under the left-out one, or all of them while none
 * is left out. `above` composites the layers over it onto transparency, and exists only
 * while there are any. Source-over is associative, so drawing `below`, the preview and then
 * `above` stacks them as the document compositor would, give or take rounding.
 */
export class SplitCompositor {
  readonly below: CpuCompositor;
  private aboveCompositor: CpuCompositor | null = null;
  private layerId: LayerId | null = null;
  /**
   * Where `below` may differ from the composite of the whole stack: where the layers it
   * leaves out were, and everything composited since. Composited again on putting it back.
   */
  private region: Rect | null = null;

  constructor(
    readonly width: number,
    readonly height: number,
  ) {
    this.below = new CpuCompositor(width, height);
  }

  /** The layer left out, or null. */
  get suppressed(): LayerId | null {
    return this.layerId;
  }

  /** The layers over the left-out one; null while none is left out, or none is over it. */
  get above(): CpuCompositor | null {
    return this.aboveCompositor;
  }

  /**
   * Leaves `layerId` out from now on, or with null puts it back. Returns the areas to
   * `composite` for that to show: none if nothing changed, or the layer isn't in `doc`.
   */
  suppress(doc: ImageDocument, layerId: LayerId | null): Rect[] {
    if (layerId === this.layerId) return [];
    const areas: Rect[] = [];
    if (this.region) areas.push(this.region);
    this.layerId = null;
    this.region = null;
    this.aboveCompositor = null;
    const index = layerId === null ? -1 : findLayerIndex(doc, layerId);
    if (layerId !== null && index >= 0) {
      this.layerId = layerId;
      this.region = stackArea(doc.layers.slice(index), documentBounds(doc));
      if (this.region) areas.push(this.region);
    }
    return areas;
  }

  /** Brings the outputs up to date for the given dirty areas (all of the canvas if omitted). */
  composite(doc: ImageDocument, dirty?: readonly Rect[]): SplitUpdate {
    const index = this.layerId === null ? -1 : findLayerIndex(doc, this.layerId);
    if (index < 0) {
      // Not in the document (any more): composite it all, until it's put back.
      this.aboveCompositor = null;
      return { below: this.track(this.below.composite(doc, dirty)), above: [] };
    }
    const below = this.track(this.below.composite(stackOf(doc, 0, index), dirty));
    if (index === doc.layers.length - 1) {
      this.aboveCompositor = null;
      return { below, above: [] };
    }
    const aboveDoc = stackOf(doc, index + 1, doc.layers.length);
    if (this.aboveCompositor)
      return { below, above: this.aboveCompositor.composite(aboveDoc, dirty) };
    // A new output is transparent: only where the layers are needs compositing.
    this.aboveCompositor = new CpuCompositor(this.width, this.height);
    const area = stackArea(aboveDoc.layers, documentBounds(doc));
    return { below, above: area ? this.aboveCompositor.composite(aboveDoc, [area]) : [] };
  }

  private track(areas: Rect[]): Rect[] {
    if (this.layerId !== null)
      for (const area of areas) this.region = unionRects(this.region, area);
    return areas;
  }
}

/** The layer a tool's overlay previews in place of the composite (Free Transform's). */
export function suppressedLayer(overlay: ToolOverlay | null): LayerId | null {
  return overlay?.shape === 'transform' ? overlay.layerId : null;
}

/**
 * `areas` as they're best composited: their union when it's no larger than they are
 * together (they overlap, like a layer put back and the edit that put it back), else as
 * they are.
 */
export function coalesceRects(areas: readonly Rect[]): Rect[] {
  if (areas.length < 2) return [...areas];
  let union: Rect | null = null;
  let total = 0;
  for (const area of areas) {
    union = unionRects(union, area);
    total += area.width * area.height;
  }
  return union && union.width * union.height <= total ? [union] : [...areas];
}

/** `doc` with only its layers from `start` up to `end` (exclusive), sharing them. */
function stackOf(doc: ImageDocument, start: number, end: number): ImageDocument {
  return { ...doc, layers: doc.layers.slice(start, end) };
}

/** The part of `canvas` that any of `layers` composites into. */
function stackArea(layers: readonly Layer[], canvas: Rect): Rect | null {
  let area: Rect | null = null;
  for (const layer of layers) {
    if (!layer.visible || layer.opacity <= 0) continue;
    const bounds = layerBounds(layer);
    area = unionRects(area, bounds && intersectRects(bounds, canvas));
  }
  return area;
}
