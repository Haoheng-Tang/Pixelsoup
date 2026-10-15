import type { CpuCompositor, ImageDocument, LayerId, Rect } from '../../core';
import { SplitCompositor } from './split-compositor';

/**
 * Produces a drawable image of the document composite for the viewport. This is the
 * seam for swapping in a GPU compositor later: a WebGL/WebGPU implementation would
 * composite into its own canvas and expose that as `image`.
 */
export interface CompositeRenderer {
  readonly width: number;
  readonly height: number;
  /**
   * The current composite at 1 image pixel = 1 document pixel. While a layer is
   * suppressed, only the layers below it.
   */
  readonly image: CanvasImageSource;
  /**
   * The visible layers above the suppressed one, composited onto transparency, to draw
   * over its preview; null while no layer is suppressed or none is above it.
   */
  readonly above: CanvasImageSource | null;
  /** The layer left out of the composite, or null. */
  readonly suppressed: LayerId | null;
  /** Brings `image` and `above` up to date for the given dirty regions (all when omitted). */
  update(doc: ImageDocument, dirty?: readonly Rect[]): void;
  /**
   * Leaves `layerId` out of the composite from now on, for a preview drawn in its place
   * (Free Transform), or with null puts it back. The document isn't changed. Returns the
   * areas to `update` for that to show.
   */
  suppress(doc: ImageDocument, layerId: LayerId | null): Rect[];
}

/** A canvas showing a compositor's output, which it shares memory with. */
interface OutputCanvas {
  readonly compositor: CpuCompositor;
  readonly canvas: HTMLCanvasElement;
  readonly context: CanvasRenderingContext2D;
  readonly imageData: ImageData;
}

function outputCanvas(compositor: CpuCompositor): OutputCanvas {
  const { width, height, output } = compositor;
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Canvas 2D is not available');
  // Shares memory with the compositor output: no copy before putImageData.
  return { compositor, canvas, context, imageData: new ImageData(output.data, width, height) };
}

function upload(target: OutputCanvas, areas: readonly Rect[]): void {
  for (const r of areas) {
    target.context.putImageData(target.imageData, 0, 0, r.x, r.y, r.width, r.height);
  }
}

/** Composites on the CPU (core `CpuCompositor`) and uploads dirty regions to 2D canvases. */
export class CpuCompositeRenderer implements CompositeRenderer {
  private readonly split: SplitCompositor;
  private readonly main: OutputCanvas;
  private aboveCanvas: OutputCanvas | null = null;

  constructor(
    readonly width: number,
    readonly height: number,
  ) {
    this.split = new SplitCompositor(width, height);
    this.main = outputCanvas(this.split.below);
  }

  get image(): HTMLCanvasElement {
    return this.main.canvas;
  }

  get above(): HTMLCanvasElement | null {
    return this.aboveCanvas?.canvas ?? null;
  }

  get suppressed(): LayerId | null {
    return this.split.suppressed;
  }

  update(doc: ImageDocument, dirty?: readonly Rect[]): void {
    const updated = this.split.composite(doc, dirty);
    upload(this.main, updated.below);
    const above = this.split.above;
    if (!above) {
      this.aboveCanvas = null;
      return;
    }
    if (this.aboveCanvas?.compositor !== above) this.aboveCanvas = outputCanvas(above);
    upload(this.aboveCanvas, updated.above);
  }

  suppress(doc: ImageDocument, layerId: LayerId | null): Rect[] {
    const areas = this.split.suppress(doc, layerId);
    if (!this.split.above) this.aboveCanvas = null;
    return areas;
  }
}
