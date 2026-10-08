import type { ImageDocument } from './document';
import { findLayerIndex } from './document';
import type { LayerId } from './layer';
import type { PixelSnapshot } from './pixel-snapshot';
import type { Selection } from './selection';

/** Name of the layer that holds a floating selection. */
export const FLOATING_LAYER_NAME = 'Floating selection';

/**
 * Pixels lifted out of a layer by the Move tool. They float in a layer of their own,
 * directly above the layer they came from (the source), until they are committed back
 * into it.
 *
 * Which selection floats is session state that `Editor` keeps, like the active layer;
 * the lift and commit commands report it in `DocumentChange.floating` so that undo and
 * redo bring it back. While it floats, the source layer doesn't change: anything that
 * would change it commits first.
 */
export interface FloatingSelection {
  /** The floating layer. */
  readonly layerId: LayerId;
  /** The layer the pixels came from, which they are committed into. */
  readonly sourceId: LayerId;
  /** The selection when lifted. The selection follows the float by moving this. */
  readonly selection: Selection;
  /** Canvas position of the floating layer when lifted: the selection's bounds. */
  readonly x: number;
  readonly y: number;
  /**
   * The source's pixels under the selection before the lift cut them out, so that
   * committing the float where it was lifted restores them exactly. Null for a copy,
   * which leaves the source untouched.
   */
  readonly before: PixelSnapshot | null;
}

/** True if the floating layer is in `doc`, directly above its source layer. */
export function isFloatingIn(doc: ImageDocument, floating: FloatingSelection): boolean {
  const index = findLayerIndex(doc, floating.layerId);
  return index > 0 && doc.layers[index - 1].id === floating.sourceId;
}
