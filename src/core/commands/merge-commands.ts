import { compositeLayers } from '../compositor/composite-layers';
import type { ImageDocument } from '../document';
import { MAX_IMAGE_SIZE, documentBounds, findLayerIndex, getLayerIndex } from '../document';
import type { Rect } from '../geometry';
import { intersectRects, unionRects } from '../geometry';
import type { Command, DocumentChange } from '../history/command';
import type { Layer, LayerId } from '../layer';
import { assertNever, createRasterLayer, layerBounds } from '../layer';

/**
 * Merges a layer into the one below it. The result is the compositor's output for the
 * pair alone, so it looks exactly as they did together: opacity is baked in and a hidden
 * layer contributes nothing. It keeps the lower layer's ID and name, is visible at
 * opacity 1, and covers both layers' bounds (or the canvas, should that exceed the
 * maximum image size).
 */
export class MergeDownCommand implements Command {
  readonly label = 'Merge Down';
  private merge: { readonly lower: Layer; readonly upper: Layer; readonly merged: Layer } | null =
    null;

  /** @param layerId the upper layer of the pair. */
  constructor(readonly layerId: LayerId) {}

  apply(doc: ImageDocument): DocumentChange {
    const index = getLayerIndex(doc, this.layerId);
    if (index === 0) throw new Error('There is no layer below to merge into');
    const lower = doc.layers[index - 1];
    const upper = doc.layers[index];
    this.merge ??= { lower, upper, merged: mergeLayers(doc, lower, upper) };
    doc.layers.splice(index - 1, 2, this.merge.merged);
    return pixelsReplaced(doc, this.merge.merged);
  }

  revert(doc: ImageDocument): DocumentChange {
    const index = this.merge ? doc.layers.indexOf(this.merge.merged) : -1;
    if (!this.merge || index < 0) throw new Error('MergeDownCommand was not applied');
    doc.layers.splice(index, 1, this.merge.lower, this.merge.upper);
    return pixelsReplaced(doc, this.merge.merged);
  }
}

function mergeLayers(doc: ImageDocument, lower: Layer, upper: Layer): Layer {
  let area = unionRects(layerBounds(lower), layerBounds(upper)) ?? documentBounds(doc);
  if (area.width > MAX_IMAGE_SIZE || area.height > MAX_IMAGE_SIZE) area = documentBounds(doc);
  return createRasterLayer({
    id: lower.id,
    name: lower.name,
    blendMode: lower.blendMode,
    x: area.x,
    y: area.y,
    pixels: compositeLayers([lower, upper], area),
  });
}

/**
 * Composites every visible layer into one layer the size of the canvas, keeping the ID
 * and name of the bottom visible layer. Hidden layers are discarded and transparent
 * areas stay transparent.
 */
export class FlattenCommand implements Command {
  readonly label = 'Flatten Image';
  private flatten: { readonly before: readonly Layer[]; readonly flat: Layer } | null = null;

  apply(doc: ImageDocument): DocumentChange {
    if (!this.flatten) {
      const base = doc.layers.find((layer) => layer.visible);
      if (!base) throw new Error('There are no visible layers to flatten');
      const pixels = compositeLayers(doc.layers, documentBounds(doc));
      const flat = createRasterLayer({ id: base.id, name: base.name, pixels });
      this.flatten = { before: [...doc.layers], flat };
    }
    doc.layers.splice(0, doc.layers.length, this.flatten.flat);
    return pixelsReplaced(doc, this.flatten.flat);
  }

  revert(doc: ImageDocument): DocumentChange {
    if (!this.flatten) throw new Error('FlattenCommand was not applied');
    doc.layers.splice(0, doc.layers.length, ...this.flatten.before);
    return pixelsReplaced(doc, this.flatten.flat);
  }
}

/**
 * Change for swapping `layer` with the layers it was made from, either way round: its
 * canvas area may look different and the layer with its ID has different pixels.
 */
function pixelsReplaced(doc: ImageDocument, layer: Layer): DocumentChange {
  const bounds = layerBounds(layer);
  const dirty: Rect | null = bounds && intersectRects(bounds, documentBounds(doc));
  return { dirty, layerPixels: [{ layerId: layer.id, rect: null }] };
}

/**
 * Null if there's no layer below, or either layer of the pair is hidden: as in
 * Photoshop, merging never quietly discards a hidden layer.
 */
export function mergeDownCommand(doc: ImageDocument, layerId: LayerId): MergeDownCommand | null {
  const index = findLayerIndex(doc, layerId);
  if (index < 1) return null;
  const lower = doc.layers[index - 1];
  const upper = doc.layers[index];
  return lower.visible && upper.visible ? new MergeDownCommand(layerId) : null;
}

/** Null if no layer is visible, or the document is already one plain canvas-sized layer. */
export function flattenCommand(doc: ImageDocument): FlattenCommand | null {
  if (!doc.layers.some((layer) => layer.visible)) return null;
  if (doc.layers.length === 1 && isFlat(doc, doc.layers[0])) return null;
  return new FlattenCommand();
}

function isFlat(doc: ImageDocument, layer: Layer): boolean {
  if (!layer.visible || layer.opacity !== 1 || layer.blendMode !== 'normal') return false;
  switch (layer.kind) {
    case 'raster':
      return (
        layer.x === 0 &&
        layer.y === 0 &&
        layer.pixels.width === doc.width &&
        layer.pixels.height === doc.height
      );
    default:
      return assertNever(layer.kind);
  }
}
