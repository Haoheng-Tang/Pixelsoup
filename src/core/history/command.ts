import type { ImageDocument } from '../document';
import type { Rect } from '../geometry';

/** What a command (or undo/redo) changed, so views can update incrementally. */
export interface DocumentChange {
  /** Canvas-space region whose composite may have changed, or null if no pixels changed. */
  readonly dirty: Rect | null;
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
  apply(doc: ImageDocument): DocumentChange;
  revert(doc: ImageDocument): DocumentChange;
  /** Absorb `next` (already applied) into this command. Return false to refuse. */
  mergeWith?(next: Command): boolean;
}
