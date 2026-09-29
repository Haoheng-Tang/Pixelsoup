import type { ImageDocument } from '../document';
import type { Rect } from '../geometry';

/**
 * Flattens a document's visible layers into a single output image.
 *
 * Implementations own their output (a CPU pixel buffer today; a GPU texture for a
 * future WebGL/WebGPU compositor) and update it incrementally: callers pass the
 * canvas-space regions that changed and only those need recompositing.
 */
export interface Compositor {
  readonly width: number;
  readonly height: number;
  /**
   * Recomposites `dirty` regions of `doc` into the output. Regions are rounded out to
   * whole pixels and clipped to the canvas; omit `dirty` to recomposite everything.
   * Returns the clipped regions that were actually updated.
   */
  composite(doc: ImageDocument, dirty?: readonly Rect[]): Rect[];
}
