import type { ImageDocument } from '../document';
import { documentBounds, findLayer, getLayer } from '../document';
import type { FloatingSelection } from '../floating-selection';
import type { Rect } from '../geometry';
import { containsRect, intersectRects } from '../geometry';
import type { Command, DocumentChange } from '../history/command';
import type { LayerId, RasterLayer } from '../layer';
import { assertNever, rasterBounds, toLayerSpace } from '../layer';
import {
  OPACITY_STEPS,
  erasePixel,
  opacitySteps,
  paintPixel,
  tintPixel,
} from '../paint/paint-math';
import type { Rgb } from '../pixel-buffer';
import { PixelSnapshot } from '../pixel-snapshot';
import type { Selection } from '../selection';
import type { Placement } from './layer-growth';
import { growthArea, grownPlacement, place, placementOf } from './layer-growth';

/**
 * How a fill treats the layer's transparency: `normal` paints the colour over each pixel,
 * and `preserve-transparency` only changes the colour of pixels with some alpha, keeping
 * their alpha as it is.
 */
export type FillMode = 'normal' | 'preserve-transparency';

export interface FillOptions {
  /**
   * Coverage to fill on top of the selection's (one value per canvas pixel): the Paint
   * Bucket's flood region. Without one, a fill covers the selection, or the whole canvas
   * with no selection.
   */
  readonly region?: Selection | undefined;
  /** The editor's floating selection: filling its layer marks it as edited. */
  readonly floating?: FloatingSelection | null | undefined;
  /** The undo label, "Fill" by default. */
  readonly label?: string | undefined;
}

/** The floating selection before and after a command first edits its layer. */
interface FloatingEdit {
  readonly before: FloatingSelection;
  readonly after: FloatingSelection;
}

/**
 * Fills a raster layer with an opaque colour where the document's selection covers it,
 * or across the whole canvas with no selection, and only within `region` if one is given.
 * Each pixel is filled with weight p = region coverage × selection coverage × opacity
 * (each as a fraction of 1): `normal` puts the colour over the pixel as the brush does
 * (alpha becomes 255p + a(1 − p)), and `preserve-transparency` moves each channel of a
 * pixel with any alpha towards the colour by p, leaving its alpha alone.
 *
 * A normal fill that reaches past the layer's edges grows the layer to take it in, as
 * painting does (to the canvas at most). A floating selection's layer doesn't grow, and
 * filling it marks it as edited. Undo restores the pixels the fill replaced, or the layer
 * as it was before it grew.
 */
export class FillCommand implements Command {
  readonly label: string;
  private readonly region: Selection | null;
  /** True when filling a floating selection's layer. */
  private readonly floats: boolean;
  private readonly floating: FloatingEdit | null;
  /** What the last apply changed: the area, and the pixels or placement it replaced. */
  private applied: { readonly area: Rect; readonly before: PixelSnapshot | Placement } | null =
    null;

  constructor(
    readonly layerId: LayerId,
    readonly color: Rgb,
    /** 0–1. */
    readonly opacity: number,
    readonly mode: FillMode,
    options: FillOptions = {},
  ) {
    this.label = options.label ?? 'Fill';
    this.region = options.region ?? null;
    const floating = options.floating?.layerId === layerId ? options.floating : null;
    this.floats = floating !== null;
    this.floating =
      floating && !floating.edited
        ? { before: floating, after: { ...floating, edited: true } }
        : null;
  }

  /**
   * Canvas-space area the fill would change in `doc`, or null if none: the smallest rect
   * holding every pixel the region and the selection cover, within the layer for a
   * floating selection's layer, and when preserving transparency, only pixels with alpha.
   */
  area(doc: ImageDocument): Rect | null {
    const layer = rasterLayer(doc, this.layerId);
    const region = this.region;
    if (region && (region.width !== doc.width || region.height !== doc.height)) {
      throw new RangeError('The fill region must be the size of the canvas');
    }
    const keepsAlpha = this.mode === 'preserve-transparency';
    let area = selectedArea(doc);
    if (area && region) {
      const bounds = region.bounds();
      area = bounds && intersectRects(area, bounds);
    }
    if (area && (this.floats || keepsAlpha)) {
      area = intersectRects(area, rasterBounds(layer));
    }
    if (area && (region || keepsAlpha)) {
      area = paintedArea(doc, area, region, keepsAlpha ? layer : null);
    }
    return area;
  }

  apply(doc: ImageDocument): DocumentChange {
    const layer = rasterLayer(doc, this.layerId);
    const area = this.area(doc);
    if (!area) {
      this.applied = null;
      return { dirty: null };
    }
    let before: PixelSnapshot | Placement;
    if (containsRect(rasterBounds(layer), area)) {
      before = PixelSnapshot.capture(layer.pixels, toLayerSpace(layer, area));
    } else {
      before = placementOf(layer);
      place(layer, grownPlacement(layer, growthArea(doc, rasterBounds(layer), area)));
    }
    this.render(doc, layer, area);
    this.applied = { area, before };
    return pixelChange(layer, area, !(before instanceof PixelSnapshot), this.floating?.after);
  }

  revert(doc: ImageDocument): DocumentChange {
    const applied = this.applied;
    if (!applied) return { dirty: null };
    const layer = rasterLayer(doc, this.layerId);
    const { area, before } = applied;
    if (before instanceof PixelSnapshot) before.restore(layer.pixels);
    else place(layer, before);
    this.applied = null;
    return pixelChange(layer, area, !(before instanceof PixelSnapshot), this.floating?.before);
  }

  /** Fills `area`, which lies inside the layer and the canvas. */
  private render(doc: ImageDocument, layer: RasterLayer, area: Rect): void {
    const { data, width: layerWidth } = layer.pixels;
    const selection = doc.selection ? doc.selection.mask : null;
    const region = this.region ? this.region.mask : null;
    const steps = opacitySteps(this.opacity);
    const tint = this.mode === 'preserve-transparency';
    const [r, g, b] = this.color;
    for (let y = area.y; y < area.y + area.height; y++) {
      let s = y * doc.width + area.x;
      let o = ((y - layer.y) * layerWidth + area.x - layer.x) * 4;
      for (let x = 0; x < area.width; x++, s++, o += 4) {
        const w =
          (region === null ? 255 : region[s]) * (selection === null ? 255 : selection[s]) * steps;
        if (w === 0) continue;
        if (tint) tintPixel(data, o, data, o, r, g, b, w);
        else paintPixel(data, o, data, o, r, g, b, w);
      }
    }
  }
}

/**
 * A fill of the layer (see `FillCommand`), or null if it would change nothing: there's no
 * such layer, it's hidden, the opacity is 0, or there's nothing to fill: no pixel that
 * the region and the selection both cover, within the layer for a floating selection's
 * layer, and with some alpha when preserving transparency.
 */
export function fillCommand(
  doc: ImageDocument,
  layerId: LayerId,
  color: Rgb,
  opacity: number,
  mode: FillMode,
  options: FillOptions = {},
): FillCommand | null {
  const layer = findLayer(doc, layerId);
  if (!layer?.visible || opacitySteps(opacity) === 0) return null;
  const command = new FillCommand(layerId, color, opacity, mode, options);
  return command.area(doc) ? command : null;
}

/**
 * Clears the selected pixels of a raster layer to transparent, weighted by the
 * selection's coverage c: alpha becomes a(1 − c / 255) and the colour stays, and a pixel
 * cleared completely becomes transparent black, as the eraser leaves it. The layer never
 * grows. Clearing a floating selection's layer marks it as edited. Undo restores the
 * pixels it replaced.
 */
export class ClearCommand implements Command {
  readonly label = 'Clear';
  private readonly floating: FloatingEdit | null;
  /** What the last apply changed: the area and the pixels it replaced. */
  private applied: { readonly area: Rect; readonly before: PixelSnapshot } | null = null;

  constructor(
    readonly layerId: LayerId,
    /** The editor's floating selection: clearing its layer marks it as edited. */
    floating: FloatingSelection | null = null,
  ) {
    const floats = floating?.layerId === layerId ? floating : null;
    this.floating =
      floats && !floats.edited ? { before: floats, after: { ...floats, edited: true } } : null;
  }

  /**
   * Canvas-space area the clear would change in `doc`, or null if none: the smallest rect
   * holding every selected pixel of the layer with some alpha.
   */
  area(doc: ImageDocument): Rect | null {
    const layer = rasterLayer(doc, this.layerId);
    const selected = doc.selection?.bounds();
    const area = selected ? intersectRects(selected, rasterBounds(layer)) : null;
    return area && paintedArea(doc, area, null, layer);
  }

  apply(doc: ImageDocument): DocumentChange {
    const layer = rasterLayer(doc, this.layerId);
    const area = this.area(doc);
    const selection = doc.selection;
    if (!area || !selection) {
      this.applied = null;
      return { dirty: null };
    }
    const before = PixelSnapshot.capture(layer.pixels, toLayerSpace(layer, area));
    const { data, width: layerWidth } = layer.pixels;
    const coverage = selection.mask;
    for (let y = area.y; y < area.y + area.height; y++) {
      let s = y * doc.width + area.x;
      let o = ((y - layer.y) * layerWidth + area.x - layer.x) * 4;
      for (let x = 0; x < area.width; x++, s++, o += 4) {
        const c = coverage[s];
        if (c !== 0) erasePixel(data, o, data, o, c * 255 * OPACITY_STEPS);
      }
    }
    this.applied = { area, before };
    return pixelChange(layer, area, false, this.floating?.after);
  }

  revert(doc: ImageDocument): DocumentChange {
    const applied = this.applied;
    if (!applied) return { dirty: null };
    const layer = rasterLayer(doc, this.layerId);
    applied.before.restore(layer.pixels);
    this.applied = null;
    return pixelChange(layer, applied.area, false, this.floating?.before);
  }
}

/**
 * Clears the selected pixels of the layer (see `ClearCommand`), or null if that would
 * change nothing: there's no selection, no such layer, the layer is hidden, or no
 * selected pixel of it has any alpha.
 */
export function clearCommand(
  doc: ImageDocument,
  layerId: LayerId,
  floating: FloatingSelection | null = null,
): ClearCommand | null {
  const layer = findLayer(doc, layerId);
  if (!doc.selection || !layer?.visible) return null;
  const command = new ClearCommand(layerId, floating);
  return command.area(doc) ? command : null;
}

/** The canvas area the selection covers, or the whole canvas without one. */
function selectedArea(doc: ImageDocument): Rect | null {
  const canvas = documentBounds(doc);
  if (!doc.selection) return canvas;
  const selected = doc.selection.bounds();
  return selected && intersectRects(canvas, selected);
}

/**
 * The smallest rect within `area` (on the canvas) holding every pixel that the selection,
 * if any, and `region`, if given, both cover, and where `alphaOf` (a layer covering
 * `area`), if given, has some alpha. Null if there's none.
 */
function paintedArea(
  doc: ImageDocument,
  area: Rect,
  region: Selection | null,
  alphaOf: RasterLayer | null,
): Rect | null {
  const selection = doc.selection ? doc.selection.mask : null;
  const coverage = region ? region.mask : null;
  const data = alphaOf ? alphaOf.pixels.data : null;
  const layerWidth = alphaOf ? alphaOf.pixels.width : 0;
  let left = area.x + area.width;
  let right = -1;
  let top = -1;
  let bottom = -1;
  for (let y = area.y; y < area.y + area.height; y++) {
    let s = y * doc.width + area.x;
    let o = alphaOf ? ((y - alphaOf.y) * layerWidth + area.x - alphaOf.x) * 4 + 3 : 0;
    for (let x = area.x; x < area.x + area.width; x++, s++, o += 4) {
      if (selection !== null && selection[s] === 0) continue;
      if (coverage !== null && coverage[s] === 0) continue;
      if (data !== null && data[o] === 0) continue;
      if (top < 0) top = y;
      bottom = y;
      if (x < left) left = x;
      if (x > right) right = x;
    }
  }
  return top < 0 ? null : { x: left, y: top, width: right - left + 1, height: bottom - top + 1 };
}

function pixelChange(
  layer: RasterLayer,
  area: Rect,
  resized: boolean,
  floating: FloatingSelection | undefined,
): DocumentChange {
  return {
    dirty: area,
    layerPixels: [{ layerId: layer.id, rect: resized ? null : toLayerSpace(layer, area) }],
    ...(floating && { floating }),
  };
}

function rasterLayer(doc: ImageDocument, id: LayerId): RasterLayer {
  const layer = getLayer(doc, id);
  switch (layer.kind) {
    case 'raster':
      return layer;
    default:
      return assertNever(layer.kind);
  }
}
