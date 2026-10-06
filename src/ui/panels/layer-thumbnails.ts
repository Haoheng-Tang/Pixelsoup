import type { Editor, EditorChange, LayerId, PixelBuffer } from '../../core';
import { findLayer } from '../../core';
import { fitSize, renderThumbnail } from './thumbnail-pixels';

/** Largest thumbnail, in CSS pixels. */
export const THUMBNAIL_WIDTH = 64;
export const THUMBNAIL_HEIGHT = 40;
/** Checkerboard squares behind thumbnails, in CSS pixels. */
const CHECKER_SIZE = 4;

/** What the renderer needs from the browser; tests substitute their own. */
export interface ThumbnailEnvironment {
  requestFrame(callback: () => void): number;
  cancelFrame(handle: number): void;
  pixelRatio(): number;
  /** Calls `onChange` whenever the pixel ratio changes, until the returned function is called. */
  watchPixelRatio(onChange: () => void): () => void;
  draw(canvas: HTMLCanvasElement, pixels: PixelBuffer, pixelRatio: number): void;
}

/** What a canvas last showed, to tell whether it's stale. */
interface Drawn {
  readonly pixels: PixelBuffer;
  readonly version: number;
  readonly generation: number;
  readonly ratio: number;
}

/**
 * Draws the layer panel's thumbnails outside React, like the viewport. Rows hand over
 * their canvases with `attach`. A thumbnail is redrawn only when its layer's pixels change
 * (a `layerPixels` entry in a change, or a new buffer), the document is replaced or the
 * pixel ratio changes, and at most once per animation frame however many changes arrive.
 */
export class LayerThumbnails {
  private readonly canvases = new Map<LayerId, HTMLCanvasElement>();
  private readonly drawn = new WeakMap<HTMLCanvasElement, Drawn>();
  /** Bumped for a layer whenever a change reports new pixels for it. */
  private readonly versions = new Map<LayerId, number>();
  /** Bumped when the document is replaced, as layer IDs repeat across documents. */
  private generation = 0;
  private frame = 0;

  constructor(
    private readonly editor: Editor,
    private readonly env: ThumbnailEnvironment = browserEnvironment,
  ) {}

  /** Starts following the editor; returns a function that stops. */
  start(): () => void {
    const unsubscribe = this.editor.subscribe((change) => this.onChange(change));
    const unwatch = this.env.watchPixelRatio(() => this.schedule());
    this.schedule();
    return () => {
      unsubscribe();
      unwatch();
      if (this.frame !== 0) this.env.cancelFrame(this.frame);
      this.frame = 0;
    };
  }

  /** Shows the layer's thumbnail in `canvas` until the returned function is called. */
  attach(layerId: LayerId, canvas: HTMLCanvasElement): () => void {
    this.canvases.set(layerId, canvas);
    this.schedule();
    return () => {
      if (this.canvases.get(layerId) === canvas) this.canvases.delete(layerId);
    };
  }

  private onChange(change: EditorChange): void {
    if (change.documentReplaced) {
      this.generation++;
      this.versions.clear();
    }
    for (const { layerId } of change.layerPixels ?? []) {
      this.versions.set(layerId, (this.versions.get(layerId) ?? 0) + 1);
    }
    this.schedule();
  }

  private schedule(): void {
    if (this.frame === 0) this.frame = this.env.requestFrame(() => this.flush());
  }

  private flush(): void {
    this.frame = 0;
    const doc = this.editor.document;
    const ratio = this.env.pixelRatio();
    for (const [layerId, canvas] of this.canvases) {
      const layer = findLayer(doc, layerId);
      if (!layer) continue;
      const now: Drawn = {
        pixels: layer.pixels,
        version: this.versions.get(layerId) ?? 0,
        generation: this.generation,
        ratio,
      };
      const last = this.drawn.get(canvas);
      if (
        last?.pixels === now.pixels &&
        last.version === now.version &&
        last.generation === now.generation &&
        last.ratio === now.ratio
      ) {
        continue;
      }
      this.env.draw(canvas, layer.pixels, ratio);
      this.drawn.set(canvas, now);
    }
  }
}

const browserEnvironment: ThumbnailEnvironment = {
  requestFrame: (callback) => requestAnimationFrame(callback),
  cancelFrame: (handle) => cancelAnimationFrame(handle),
  pixelRatio: () => window.devicePixelRatio || 1,
  watchPixelRatio,
  draw: drawThumbnail,
};

function watchPixelRatio(onChange: () => void): () => void {
  let query: MediaQueryList | null = null;
  const changed = () => {
    listen();
    onChange();
  };
  const listen = () => {
    query?.removeEventListener('change', changed);
    query = window.matchMedia(`(resolution: ${window.devicePixelRatio || 1}dppx)`);
    query.addEventListener('change', changed);
  };
  listen();
  return () => query?.removeEventListener('change', changed);
}

/** Draws at device resolution: the canvas's CSS size is its pixel size over the ratio. */
function drawThumbnail(canvas: HTMLCanvasElement, pixels: PixelBuffer, ratio: number): void {
  const size = fitSize(
    pixels.width,
    pixels.height,
    Math.round(THUMBNAIL_WIDTH * ratio),
    Math.round(THUMBNAIL_HEIGHT * ratio),
  );
  canvas.width = size.width;
  canvas.height = size.height;
  canvas.style.width = `${size.width / ratio}px`;
  canvas.style.height = `${size.height / ratio}px`;
  const context = canvas.getContext('2d');
  if (!context) return;
  const image = context.createImageData(size.width, size.height);
  renderThumbnail(pixels, image, Math.max(1, Math.round(CHECKER_SIZE * ratio)));
  context.putImageData(image, 0, 0);
}
