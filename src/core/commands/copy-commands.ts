import type { ImageDocument } from '../document';
import { createLayerId, documentBounds, findLayer, getLayer, getLayerIndex } from '../document';
import { intersectRects } from '../geometry';
import type { Command, DocumentChange } from '../history/command';
import type { LayerId, RasterLayer } from '../layer';
import { createRasterLayer, rasterBounds, toLayerSpace } from '../layer';
import type { PixelBuffer } from '../pixel-buffer';
import { clonePixelBuffer, createPixelBuffer } from '../pixel-buffer';
import { PixelSnapshot } from '../pixel-snapshot';
import type { Selection } from '../selection';
import { indexAbove, nextLayerName } from './layer-commands';
import { splitSelectedPixels } from './selected-pixels';

/** What a Layer via command made on its first apply, to put back on redo. */
interface MadeLayer {
  readonly layer: RasterLayer;
  readonly selection: Selection;
  /** The source's pixels before a cut, or null for a copy. */
  readonly before: PixelSnapshot | null;
}

/**
 * Layer via Copy and Layer via Cut: the selected pixels of a layer (the source) go into a
 * new raster layer directly above it, the size of the selection's bounds, and the
 * selection is cleared, as in Photoshop. Coverage weights each pixel as lifting a floating
 * selection does (`splitSelectedPixels`): with coverage c, the new layer gets alpha
 * round(a × c / 255) of a pixel with alpha a and, for a cut, the source keeps the rest.
 * The new layer takes the source's opacity and blend mode, so the pixels look as they did.
 */
abstract class LayerViaCommand implements Command {
  abstract readonly label: string;
  private made: MadeLayer | null = null;

  /**
   * @param layerId the new layer's ID, from `createLayerId(doc)`.
   * @param name the new layer's name, e.g. from `nextLayerName(doc)`.
   */
  constructor(
    readonly sourceId: LayerId,
    readonly layerId: LayerId,
    readonly name: string,
    private readonly cut: boolean,
  ) {}

  apply(doc: ImageDocument): DocumentChange {
    const index = getLayerIndex(doc, this.sourceId);
    const source = doc.layers[index];
    if (findLayer(doc, this.layerId)) throw new Error(`Duplicate layer ID: ${this.layerId}`);
    if (!this.made) {
      this.made = this.make(source, doc.selection);
    } else if (this.made.before) {
      // Redo: the source is as it was before the first cut, so cutting again matches.
      splitSelectedPixels(source, this.made.selection, null, true);
    }
    doc.layers.splice(index + 1, 0, this.made.layer);
    doc.selection = null;
    return this.change(doc, this.made);
  }

  revert(doc: ImageDocument): DocumentChange {
    const made = this.made;
    const index = made ? doc.layers.indexOf(made.layer) : -1;
    if (!made || index < 0) throw new Error(`${this.label} was not applied`);
    doc.layers.splice(index, 1);
    made.before?.restore(getLayer(doc, this.sourceId).pixels);
    doc.selection = made.selection;
    return this.change(doc, made);
  }

  private make(source: RasterLayer, selection: Selection | null): MadeLayer {
    const bounds = selection?.bounds() ?? null;
    if (!selection || !bounds) throw new Error('There is no selection to copy');
    const area = intersectRects(bounds, rasterBounds(source));
    const before =
      this.cut && area ? PixelSnapshot.capture(source.pixels, toLayerSpace(source, area)) : null;
    const layer = createRasterLayer({
      id: this.layerId,
      name: this.name,
      x: bounds.x,
      y: bounds.y,
      pixels: createPixelBuffer(bounds.width, bounds.height),
      opacity: source.opacity,
      blendMode: source.blendMode,
    });
    splitSelectedPixels(source, selection, layer, this.cut);
    return { layer, selection, before };
  }

  /** The new layer's area, which holds any pixels cut, and the selection it cleared. */
  private change(doc: ImageDocument, { layer, selection, before }: MadeLayer): DocumentChange {
    const area = intersectRects(rasterBounds(layer), documentBounds(doc));
    return {
      dirty: area,
      selectionDirty: selection.bounds(),
      ...(before?.rect && { layerPixels: [{ layerId: this.sourceId, rect: before.rect }] }),
    };
  }
}

/** Copies the selected pixels into a new layer: see `LayerViaCommand`. */
export class LayerViaCopyCommand extends LayerViaCommand {
  readonly label = 'Layer via Copy';

  constructor(sourceId: LayerId, layerId: LayerId, name: string) {
    super(sourceId, layerId, name, false);
  }
}

/** Cuts the selected pixels out into a new layer: see `LayerViaCommand`. */
export class LayerViaCutCommand extends LayerViaCommand {
  readonly label = 'Layer via Cut';

  constructor(sourceId: LayerId, layerId: LayerId, name: string) {
    super(sourceId, layerId, name, true);
  }
}

/**
 * Pastes pixels as a new layer placed at `index` (0 = bottom), and clears the selection,
 * in one undo step.
 */
export class PasteCommand implements Command {
  readonly label = 'Paste';
  private previous: Selection | null = null;

  constructor(
    readonly layer: RasterLayer,
    readonly index: number,
  ) {}

  apply(doc: ImageDocument): DocumentChange {
    if (findLayer(doc, this.layer.id)) throw new Error(`Duplicate layer ID: ${this.layer.id}`);
    if (!Number.isInteger(this.index) || this.index < 0 || this.index > doc.layers.length) {
      throw new RangeError(`Layer index out of range: ${this.index}`);
    }
    this.previous = doc.selection;
    doc.layers.splice(this.index, 0, this.layer);
    doc.selection = null;
    return this.change(doc);
  }

  revert(doc: ImageDocument): DocumentChange {
    const index = doc.layers.indexOf(this.layer);
    if (index < 0) throw new Error(`Layer not found: ${this.layer.id}`);
    doc.layers.splice(index, 1);
    doc.selection = this.previous;
    return this.change(doc);
  }

  private change(doc: ImageDocument): DocumentChange {
    return {
      dirty: intersectRects(rasterBounds(this.layer), documentBounds(doc)),
      selectionDirty: this.previous?.bounds() ?? null,
    };
  }
}

/**
 * Whether Layer via Copy or Cut can take the selected pixels of `layerId`: there's a
 * selection, the layer exists and is visible (as in Photoshop), and the selection's bounds
 * reach it.
 */
export function selectionReachesLayer(doc: ImageDocument, layerId: LayerId): boolean {
  const layer = findLayer(doc, layerId);
  const bounds = doc.selection?.bounds() ?? null;
  return !!layer?.visible && !!bounds && intersectRects(bounds, rasterBounds(layer)) !== null;
}

/**
 * Copies the layer's selected pixels into a new layer "Layer N" directly above it (see
 * `LayerViaCopyCommand`). Null without a selection, if the layer is missing or hidden, or
 * if the selection misses it. Takes a fresh layer ID.
 */
export function layerViaCopyCommand(
  doc: ImageDocument,
  layerId: LayerId,
): LayerViaCopyCommand | null {
  if (!selectionReachesLayer(doc, layerId)) return null;
  return new LayerViaCopyCommand(layerId, createLayerId(doc), nextLayerName(doc));
}

/** As `layerViaCopyCommand`, but cuts the pixels out of the layer. */
export function layerViaCutCommand(
  doc: ImageDocument,
  layerId: LayerId,
): LayerViaCutCommand | null {
  if (!selectionReachesLayer(doc, layerId)) return null;
  return new LayerViaCutCommand(layerId, createLayerId(doc), nextLayerName(doc));
}

/**
 * Pastes a copy of `pixels` as a new layer "Layer N" with its top-left pixel at (x, y),
 * directly above `aboveId` (on top when that's null or missing), and clears the
 * selection. Takes a fresh layer ID.
 */
export function pasteCommand(
  doc: ImageDocument,
  aboveId: LayerId | null,
  pixels: PixelBuffer,
  x: number,
  y: number,
): PasteCommand {
  const layer = createRasterLayer({
    id: createLayerId(doc),
    name: nextLayerName(doc),
    pixels: clonePixelBuffer(pixels),
    x,
    y,
  });
  return new PasteCommand(layer, indexAbove(doc, aboveId));
}
