import type { ImageDocument } from '../document';
import { documentBounds, findLayer, getLayer } from '../document';
import type { FloatingSelection } from '../floating-selection';
import type { Rect } from '../geometry';
import { containsRect, intersectRects, unionRects } from '../geometry';
import type { Command, DocumentChange } from '../history/command';
import type { LayerId, RasterLayer } from '../layer';
import { assertNever, rasterBounds, toLayerSpace } from '../layer';
import type { Dab } from '../paint/dab';
import { erasePixel, opacitySteps, paintPixel } from '../paint/paint-math';
import { StrokeMask } from '../paint/stroke-mask';
import { TILE_SIZE, TileGrid, tileRect } from '../paint/tiles';
import type { Rgb } from '../pixel-buffer';
import type { Selection } from '../selection';
import type { Placement } from './layer-growth';
import { growthArea, grownPlacement, place, placementOf } from './layer-growth';

/** How a stroke paints. */
export interface StrokeStyle {
  /** Paint the colour on, or erase towards transparency. */
  readonly mode: 'paint' | 'erase';
  /** The colour painted. Erasing ignores it. */
  readonly color: Rgb;
  /** The most the stroke covers any pixel, 0–1, however often its dabs overlap. */
  readonly opacity: number;
  /** Hardness of the stroke's dabs, 0–1. */
  readonly hardness: number;
}

let strokeCount = 0;

/**
 * One brush or eraser stroke on a raster layer, from pointer down to pointer up.
 *
 * Dabs raise the stroke's mask (keeping the maximum, see `StrokeMask`), and each pixel
 * under the mask is painted from its value before the stroke: with p = mask × opacity ×
 * selection coverage, painting puts the colour over the original pixel with weight p,
 * and erasing scales its alpha by 1 − p. So however many dabs overlap, a stroke never
 * covers more than its opacity; the next stroke builds on this one.
 *
 * The stroke keeps the pixels it replaced in tiles, taken just before it first paints
 * each tile, so undo restores them exactly. Painting past the layer's edges grows the
 * layer to take the stroke in (painting only: erasing outside a layer changes nothing,
 * and floating selections don't grow).
 *
 * Make one with `beginStroke`, then turn each frame's dabs into a command with
 * `strokeCommand` and execute it straight away, with nothing else in between: they share
 * a merge key and become one undo step.
 */
export class PaintStroke {
  readonly mergeKey = `stroke:${++strokeCount}`;
  readonly label: string;
  readonly mask: StrokeMask;
  /** Canvas-space area the stroke may paint in. */
  readonly limit: Rect;
  private readonly weight: number;
  /** The layer's pixels before the stroke, in canvas-space tiles; transparent outside it. */
  private readonly originals: TileGrid<Uint8ClampedArray>;
  /** Canvas-space area painted so far. */
  private painted: Rect | null = null;
  /** The layer's placement before the stroke grew it, and the area it grew to. */
  private growth: { readonly from: Placement; to: Rect } | null = null;
  private undone = false;

  /** Use `beginStroke`. */
  constructor(
    doc: ImageDocument,
    readonly layerId: LayerId,
    readonly style: StrokeStyle,
    /** The selection the stroke is clipped to; it must not change during the stroke. */
    readonly selection: Selection | null,
    limit: Rect,
    /** The floating selection before and after the stroke, if it paints an unedited one. */
    private readonly floating: {
      readonly before: FloatingSelection;
      readonly after: FloatingSelection;
    } | null,
  ) {
    this.label = style.mode === 'paint' ? 'Brush Stroke' : 'Eraser Stroke';
    this.mask = new StrokeMask(doc.width, doc.height);
    this.originals = new TileGrid(doc.width, doc.height);
    this.limit = limit;
    this.weight = opacitySteps(style.opacity);
  }

  /** Raises the mask with `dabs`, returning the area that changed (null if none did). */
  stamp(dabs: readonly Dab[]): Rect | null {
    let area: Rect | null = null;
    for (const dab of dabs) {
      const raised = this.mask.stamp(dab, this.style.hardness, this.limit, this.selection);
      area = unionRects(area, raised);
    }
    return area;
  }

  /** Paints `area` of the layer from the mask, growing the layer first if need be. */
  paint(doc: ImageDocument, area: Rect): DocumentChange {
    if (this.undone) throw new Error('The stroke was undone');
    const layer = this.layerIn(doc);
    const first = this.painted === null;
    const grew = !containsRect(rasterBounds(layer), area);
    if (grew) this.grow(doc, layer, area);
    this.render(layer, area);
    this.painted = unionRects(this.painted, area);
    return {
      dirty: area,
      layerPixels: [{ layerId: layer.id, rect: grew ? null : toLayerSpace(layer, area) }],
      ...(first && this.floating && { floating: this.floating.after }),
    };
  }

  /** Puts back the pixels (and placement) the layer had before the stroke. */
  undo(doc: ImageDocument): DocumentChange {
    const layer = this.layerIn(doc);
    const before = this.growth ? this.growth.from : placementOf(layer);
    const bounds = {
      x: before.x,
      y: before.y,
      width: before.pixels.width,
      height: before.pixels.height,
    };
    const data = before.pixels.data;
    this.originals.forEachTile((tile, column, row) => {
      const part = intersectRects(tileRect(column, row), bounds);
      if (!part) return;
      for (let y = part.y; y < part.y + part.height; y++) {
        const from = ((y - row * TILE_SIZE) * TILE_SIZE + part.x - column * TILE_SIZE) * 4;
        const to = ((y - before.y) * bounds.width + part.x - before.x) * 4;
        data.set(tile.subarray(from, from + part.width * 4), to);
      }
    });
    if (this.growth) place(layer, this.growth.from);
    this.undone = true;
    return this.change(layer, this.floating?.before);
  }

  /** Paints the whole stroke again after `undo`. */
  redo(doc: ImageDocument): DocumentChange {
    const layer = this.layerIn(doc);
    this.undone = false;
    if (this.growth) place(layer, grownPlacement(layer, this.growth.to));
    if (this.painted) this.render(layer, this.painted);
    return this.change(layer, this.floating?.after);
  }

  private change(layer: RasterLayer, floating: FloatingSelection | undefined): DocumentChange {
    const painted = this.painted;
    return {
      dirty: painted,
      ...(painted && {
        layerPixels: [
          { layerId: layer.id, rect: this.growth ? null : toLayerSpace(layer, painted) },
        ],
      }),
      ...(floating && { floating }),
    };
  }

  private layerIn(doc: ImageDocument): RasterLayer {
    const layer = getLayer(doc, this.layerId);
    switch (layer.kind) {
      case 'raster':
        return layer;
      default:
        return assertNever(layer.kind);
    }
  }

  /** Grows the layer to cover `area` too. */
  private grow(doc: ImageDocument, layer: RasterLayer, area: Rect): void {
    const to = growthArea(doc, rasterBounds(layer), area);
    if (this.growth) this.growth.to = to;
    else this.growth = { from: placementOf(layer), to };
    place(layer, grownPlacement(layer, to));
  }

  /** The tile of original pixels at (column, row), taken from the layer the first time. */
  private originalTile(layer: RasterLayer, column: number, row: number): Uint8ClampedArray {
    let tile = this.originals.get(column, row);
    if (tile) return tile;
    tile = new Uint8ClampedArray(TILE_SIZE * TILE_SIZE * 4);
    const part = intersectRects(tileRect(column, row), rasterBounds(layer));
    if (part) {
      const { width, data } = layer.pixels;
      for (let y = part.y; y < part.y + part.height; y++) {
        const from = ((y - layer.y) * width + part.x - layer.x) * 4;
        const to = ((y - row * TILE_SIZE) * TILE_SIZE + part.x - column * TILE_SIZE) * 4;
        tile.set(data.subarray(from, from + part.width * 4), to);
      }
    }
    this.originals.set(column, row, tile);
    return tile;
  }

  /** Paints the pixels of `area` (inside the layer) from their originals and the mask. */
  private render(layer: RasterLayer, area: Rect): void {
    const out = layer.pixels.data;
    const outWidth = layer.pixels.width;
    const coverage = this.selection ? this.selection.mask : null;
    const canvasWidth = this.mask.width;
    const weight = this.weight;
    const erase = this.style.mode === 'erase';
    const [r, g, b] = this.style.color;
    const right = area.x + area.width;
    const bottom = area.y + area.height;
    for (let row = Math.floor(area.y / TILE_SIZE); row * TILE_SIZE < bottom; row++) {
      const top = row * TILE_SIZE;
      const y0 = Math.max(area.y, top);
      const y1 = Math.min(bottom, top + TILE_SIZE);
      for (let column = Math.floor(area.x / TILE_SIZE); column * TILE_SIZE < right; column++) {
        const mask = this.mask.tile(column, row);
        if (!mask) continue;
        const left = column * TILE_SIZE;
        const x0 = Math.max(area.x, left);
        const x1 = Math.min(right, left + TILE_SIZE);
        const original = this.originalTile(layer, column, row);
        for (let y = y0; y < y1; y++) {
          let t = (y - top) * TILE_SIZE + x0 - left;
          let s = y * canvasWidth + x0;
          let o = ((y - layer.y) * outWidth + x0 - layer.x) * 4;
          for (let x = x0; x < x1; x++, t++, s++, o += 4) {
            const m = mask[t];
            if (m === 0) continue;
            const w = m * (coverage === null ? 255 : coverage[s]) * weight;
            if (w === 0) continue;
            if (erase) erasePixel(out, o, original, t * 4, w);
            else paintPixel(out, o, original, t * 4, r, g, b, w);
          }
        }
      }
    }
  }
}

/**
 * The step of a stroke that paints the area its latest dabs raised. The first step of a
 * stroke stands for the whole stroke once the others merge into it: undo restores what
 * the stroke replaced, and redo paints it all again.
 */
export class StrokeCommand implements Command {
  readonly label: string;
  readonly mergeKey: string;
  private applied = false;

  constructor(
    readonly stroke: PaintStroke,
    readonly area: Rect,
  ) {
    this.label = stroke.label;
    this.mergeKey = stroke.mergeKey;
  }

  apply(doc: ImageDocument): DocumentChange {
    if (this.applied) return this.stroke.redo(doc);
    this.applied = true;
    return this.stroke.paint(doc, this.area);
  }

  revert(doc: ImageDocument): DocumentChange {
    return this.stroke.undo(doc);
  }

  mergeWith(next: Command): boolean {
    return next instanceof StrokeCommand && next.stroke === this.stroke;
  }
}

/**
 * Starts a stroke on a layer, clipped to the document's selection. Null if there's no
 * such layer, it's hidden, the opacity is 0, or there's nowhere to paint (erasing, or
 * painting a floating selection, outside the layer and the selection). Pass the editor's
 * floating selection, which a stroke on its layer marks as edited.
 */
export function beginStroke(
  doc: ImageDocument,
  layerId: LayerId,
  style: StrokeStyle,
  floating: FloatingSelection | null,
): PaintStroke | null {
  const layer = findLayer(doc, layerId);
  if (!layer || !layer.visible || opacitySteps(style.opacity) === 0) return null;
  const floats = floating?.layerId === layerId ? floating : null;
  let limit: Rect | null = documentBounds(doc);
  const selected = doc.selection?.bounds();
  if (selected) limit = intersectRects(limit, selected);
  if (limit && (style.mode === 'erase' || floats)) {
    limit = intersectRects(limit, rasterBounds(layer));
  }
  if (!limit) return null;
  const edited =
    floats && !floats.edited ? { before: floats, after: { ...floats, edited: true } } : null;
  return new PaintStroke(doc, layerId, style, doc.selection, limit, edited);
}

/**
 * Raises the stroke's mask with `dabs` and returns the command that paints what changed,
 * or null if nothing did. Execute it straight away.
 */
export function strokeCommand(stroke: PaintStroke, dabs: readonly Dab[]): StrokeCommand | null {
  const area = stroke.stamp(dabs);
  return area && new StrokeCommand(stroke, area);
}
