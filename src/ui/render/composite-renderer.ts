import type { ImageDocument, Rect } from '../../core';
import { CpuCompositor } from '../../core';

/**
 * Produces a drawable image of the document composite for the viewport. This is the
 * seam for swapping in a GPU compositor later: a WebGL/WebGPU implementation would
 * composite into its own canvas and expose that as `image`.
 */
export interface CompositeRenderer {
  readonly width: number;
  readonly height: number;
  /** The current composite at 1 image pixel = 1 document pixel. */
  readonly image: CanvasImageSource;
  /** Brings `image` up to date for the given dirty regions (all when omitted). */
  update(doc: ImageDocument, dirty?: readonly Rect[]): void;
}

/** Composites on the CPU (core `CpuCompositor`) and uploads dirty regions to a 2D canvas. */
export class CpuCompositeRenderer implements CompositeRenderer {
  readonly image: HTMLCanvasElement;
  private readonly compositor: CpuCompositor;
  private readonly context: CanvasRenderingContext2D;
  private readonly imageData: ImageData;

  constructor(
    readonly width: number,
    readonly height: number,
  ) {
    this.compositor = new CpuCompositor(width, height);
    this.image = document.createElement('canvas');
    this.image.width = width;
    this.image.height = height;
    const context = this.image.getContext('2d');
    if (!context) throw new Error('Canvas 2D is not available');
    this.context = context;
    // Shares memory with the compositor output: no copy before putImageData.
    this.imageData = new ImageData(this.compositor.output.data, width, height);
  }

  update(doc: ImageDocument, dirty?: readonly Rect[]): void {
    for (const r of this.compositor.composite(doc, dirty)) {
      this.context.putImageData(this.imageData, 0, 0, r.x, r.y, r.width, r.height);
    }
  }
}
