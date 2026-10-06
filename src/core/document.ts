import type { Rect } from './geometry';
import type { Layer, LayerId } from './layer';
import type { Selection } from './selection';

/**
 * An image being edited: fixed canvas size, an ordered layer stack, and an optional
 * selection. Named `ImageDocument` to avoid clashing with the DOM's global `Document`.
 *
 * Documents are plain mutable data, but only `Command`s (run through `History`)
 * may mutate them, so every change is undoable and reported to listeners.
 */
export interface ImageDocument {
  readonly width: number;
  readonly height: number;
  /** Layer stack ordered bottom (index 0) to top. */
  readonly layers: Layer[];
  /**
   * Active selection, or null when everything is implicitly selected. Never an empty
   * selection: `SetSelectionCommand` stores "nothing selected" as null.
   */
  selection: Selection | null;
  /**
   * ID allocator state for `createLayerId`, not document content: it only grows (undo
   * doesn't rewind it), so an ID is never reused within a document. Not saved to files;
   * rebuilt from the layer IDs on load.
   */
  nextLayerNumber: number;
}

/** Largest width or height, in pixels, of a document or a layer. */
export const MAX_IMAGE_SIZE = 8192;

export function isValidImageSize(width: number, height: number): boolean {
  return (
    Number.isInteger(width) &&
    Number.isInteger(height) &&
    width >= 1 &&
    height >= 1 &&
    width <= MAX_IMAGE_SIZE &&
    height <= MAX_IMAGE_SIZE
  );
}

export function createDocument(width: number, height: number): ImageDocument {
  if (!isValidImageSize(width, height)) {
    throw new RangeError(`Invalid document size ${width}x${height}`);
  }
  return { width, height, layers: [], selection: null, nextLayerNumber: 1 };
}

/**
 * Returns an ID (`layer-1`, `layer-2`, …) that no layer in `doc` uses and that `doc` has
 * not handed out before. IDs are only unique within their document.
 */
export function createLayerId(doc: ImageDocument): LayerId {
  let id: LayerId;
  do {
    id = `layer-${doc.nextLayerNumber++}`;
  } while (findLayer(doc, id));
  return id;
}

export function documentBounds(doc: ImageDocument): Rect {
  return { x: 0, y: 0, width: doc.width, height: doc.height };
}

export function findLayer(doc: ImageDocument, id: LayerId): Layer | undefined {
  return doc.layers.find((layer) => layer.id === id);
}

export function getLayer(doc: ImageDocument, id: LayerId): Layer {
  const layer = findLayer(doc, id);
  if (!layer) throw new Error(`Layer not found: ${id}`);
  return layer;
}

/** Stack index (0 = bottom) of the layer with `id`, or -1 if there is none. */
export function findLayerIndex(doc: ImageDocument, id: LayerId): number {
  return doc.layers.findIndex((layer) => layer.id === id);
}

/** Stack index (0 = bottom) of the layer with `id`. Throws if there is none. */
export function getLayerIndex(doc: ImageDocument, id: LayerId): number {
  const index = findLayerIndex(doc, id);
  if (index < 0) throw new Error(`Layer not found: ${id}`);
  return index;
}
