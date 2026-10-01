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
  /** Active selection, or null when everything is implicitly selected. */
  selection: Selection | null;
}

export function createDocument(width: number, height: number): ImageDocument {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0) {
    throw new RangeError(`Invalid document size ${width}x${height}`);
  }
  return { width, height, layers: [], selection: null };
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
