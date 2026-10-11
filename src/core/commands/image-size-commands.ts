import type { ImageDocument } from '../document';
import { MAX_IMAGE_SIZE, documentBounds, isValidImageSize } from '../document';
import { intersectRects } from '../geometry';
import type { Command, DocumentChange } from '../history/command';
import type { RasterLayer } from '../layer';
import { assertNever, rasterBounds, toLayerSpace } from '../layer';
import { copyPixels, createPixelBuffer } from '../pixel-buffer';
import type { Interpolation } from '../resample/kernels';
import { resizePixels } from '../resample/resize';
import type { Selection } from '../selection';
import type { Placement } from './layer-growth';
import { place, placementOf } from './layer-growth';

/** A layer's placement on either side of the resample. */
interface Resampled {
  readonly layer: RasterLayer;
  readonly before: Placement;
  readonly after: Placement;
}

interface CanvasState {
  readonly width: number;
  readonly height: number;
  readonly selection: Selection | null;
}

/**
 * Image Size: scales the whole document to `width` × `height`. Every layer is resampled by
 * the same factors, width / old width across and height / old height down, with its edges
 * rounded to whole pixels, so layers that met still meet. Resampling stops at each layer's
 * edges, so a layer stays as opaque right up to them. A layer that would end up bigger
 * than the maximum image size is cut to the canvas first. The selection is cleared.
 *
 * Undo puts back every layer's old buffer, which the command keeps (with the new ones, for
 * redo), as merges and flattens keep whole layers.
 */
export class ResampleDocumentCommand implements Command {
  readonly label = 'Image Size';
  private before: CanvasState | null = null;
  private resampled: readonly Resampled[] = [];

  constructor(
    readonly width: number,
    readonly height: number,
    readonly interpolation: Interpolation,
  ) {
    if (!isValidImageSize(width, height)) {
      throw new RangeError(`Invalid image size ${width}x${height}`);
    }
  }

  apply(doc: ImageDocument): DocumentChange {
    const before: CanvasState = { width: doc.width, height: doc.height, selection: doc.selection };
    if (!this.before) {
      this.resampled = doc.layers.map((layer) => {
        switch (layer.kind) {
          case 'raster':
            return { layer, before: placementOf(layer), after: this.scaled(doc, layer) };
          default:
            return assertNever(layer.kind);
        }
      });
    }
    this.before = before;
    for (const { layer, after } of this.resampled) place(layer, after);
    doc.width = this.width;
    doc.height = this.height;
    doc.selection = null;
    return this.change(doc, before);
  }

  revert(doc: ImageDocument): DocumentChange {
    const before = this.before;
    if (!before) throw new Error('ResampleDocumentCommand was not applied');
    const after: CanvasState = { width: doc.width, height: doc.height, selection: doc.selection };
    for (const resampled of this.resampled) place(resampled.layer, resampled.before);
    doc.width = before.width;
    doc.height = before.height;
    doc.selection = before.selection;
    return this.change(doc, after);
  }

  /** The layer resampled to the new size, or cut to the canvas first if it'd be too big. */
  private scaled(doc: ImageDocument, layer: RasterLayer): Placement {
    const scaleX = this.width / doc.width;
    const scaleY = this.height / doc.height;
    let area = rasterBounds(layer);
    let pixels = layer.pixels;
    if (
      scaledSpan(area.x, area.width, scaleX) > MAX_IMAGE_SIZE ||
      scaledSpan(area.y, area.height, scaleY) > MAX_IMAGE_SIZE
    ) {
      const onCanvas = intersectRects(area, documentBounds(doc));
      if (!onCanvas) return { pixels: createPixelBuffer(this.width, this.height), x: 0, y: 0 };
      pixels = copyPixels(layer.pixels, toLayerSpace(layer, onCanvas));
      area = onCanvas;
    }
    const x = scaledEdge(area.x, scaleX);
    const y = scaledEdge(area.y, scaleY);
    const width = scaledSpan(area.x, area.width, scaleX);
    const height = scaledSpan(area.y, area.height, scaleY);
    return { pixels: resizePixels(pixels, width, height, this.interpolation), x, y };
  }

  private change(doc: ImageDocument, other: CanvasState): DocumentChange {
    const canvas = documentBounds(doc);
    const resized = doc.width !== other.width || doc.height !== other.height;
    return {
      dirty: canvas,
      ...(resized && { resized }),
      ...((doc.selection !== null || other.selection !== null) && { selectionDirty: canvas }),
      layerPixels: doc.layers.map((layer) => ({ layerId: layer.id, rect: null })),
    };
  }
}

/** Where a layer edge at `edge` lands after scaling: rounded, so shared edges stay shared. */
function scaledEdge(edge: number, scale: number): number {
  return Math.round(edge * scale) || 0; // never −0
}

/** A span's length after scaling both its edges, at least 1 pixel. */
function scaledSpan(start: number, length: number, scale: number): number {
  return Math.max(1, scaledEdge(start + length, scale) - scaledEdge(start, scale));
}

/** Image Size, or null if the size wouldn't change. */
export function imageSizeCommand(
  doc: ImageDocument,
  width: number,
  height: number,
  interpolation: Interpolation,
): ResampleDocumentCommand | null {
  if (width === doc.width && height === doc.height) return null;
  return new ResampleDocumentCommand(width, height, interpolation);
}
