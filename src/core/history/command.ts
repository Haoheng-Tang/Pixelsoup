import type { ImageDocument } from '../document';
import type { FloatingSelection } from '../floating-selection';
import type { Rect } from '../geometry';
import type { LayerId } from '../layer';

/** What a command (or undo/redo) changed, so views can update incrementally. */
export interface DocumentChange {
  /** Canvas-space region whose composite may have changed, or null if no pixels changed. */
  readonly dirty: Rect | null;
  /**
   * True when the canvas changed size (crop, canvas or image size, a 90° rotation). Views
   * sized to the canvas rebuild; `dirty` then covers the whole new canvas.
   */
  readonly resized?: boolean;
  /**
   * Canvas-space region covering the selection's old and new bounds when the selection
   * changed (null or absent if it didn't). The composite is unaffected; views redraw the
   * selection outline.
   */
  readonly selectionDirty?: Rect | null;
  /**
   * Layers whose own pixels changed, for views of single layers such as thumbnails.
   * Absent if none did. Adding, removing, reordering or restyling layers isn't listed.
   */
  readonly layerPixels?: readonly LayerPixelsChange[];
  /**
   * The floating selection after this change, for changes that start, end or edit one
   * (absent otherwise): lifting, committing, and painting on the floating layer.
   * `Editor` keeps it as session state.
   */
  readonly floating?: FloatingSelection | null;
}

export interface LayerPixelsChange {
  readonly layerId: LayerId;
  /** Layer-space region that changed, or null if the whole layer may have, size included. */
  readonly rect: Rect | null;
}

/**
 * A reversible document mutation. Every document edit goes through a Command executed
 * by `History`; nothing else may mutate an `ImageDocument`.
 *
 * `apply` is called for the initial execution and for every redo; `revert` undoes it.
 * Commands capture whatever state they need to revert on their first `apply`.
 */
export interface Command {
  /** Human-readable name, e.g. for "Undo Change Layer Opacity". */
  readonly label: string;
  /**
   * Consecutive commands sharing the same defined `mergeKey` may be coalesced into one
   * undo step via `mergeWith` (e.g. all opacity updates during a single slider drag).
   */
  readonly mergeKey?: string | undefined;
  /**
   * False for commands that change only state that isn't saved with the document, such
   * as the selection. They are undoable but don't make the document unsaved. Default true.
   */
  readonly changesContent?: boolean;
  apply(doc: ImageDocument): DocumentChange;
  revert(doc: ImageDocument): DocumentChange;
  /** Absorb `next` (already applied) into this command. Return false to refuse. */
  mergeWith?(next: Command): boolean;
}
