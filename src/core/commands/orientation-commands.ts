import type { ImageDocument } from '../document';
import { documentBounds } from '../document';
import type { Command, DocumentChange } from '../history/command';
import { assertNever, rasterBounds } from '../layer';
import type { Orientation } from '../orientation';
import {
  inverseOrientation,
  orientPixels,
  orientRect,
  orientedSize,
  swapsSize,
} from '../orientation';
import type { Selection } from '../selection';
import { place } from './layer-growth';

/** Undo labels and menu names. */
export const ORIENTATION_LABELS: Readonly<Record<Orientation, string>> = {
  'rotate-cw': 'Rotate 90° Clockwise',
  'rotate-ccw': 'Rotate 90° Anticlockwise',
  'rotate-180': 'Rotate 180°',
  'flip-horizontal': 'Flip Horizontal',
  'flip-vertical': 'Flip Vertical',
};

/**
 * Turns or flips the whole canvas: every layer's pixels and position, and the selection,
 * move exactly as the canvas does, with no resampling. Layers past the canvas's edges turn
 * with it. Undo applies the inverse orientation, which gives back the same bytes.
 */
export class OrientCanvasCommand implements Command {
  readonly label: string;
  private selectionBefore: Selection | null = null;

  constructor(readonly orientation: Orientation) {
    this.label = ORIENTATION_LABELS[orientation];
  }

  apply(doc: ImageDocument): DocumentChange {
    this.selectionBefore = doc.selection;
    orientDocument(doc, this.orientation);
    doc.selection = this.selectionBefore && this.selectionBefore.orient(this.orientation);
    return this.change(doc, this.orientation);
  }

  revert(doc: ImageDocument): DocumentChange {
    const inverse = inverseOrientation(this.orientation);
    orientDocument(doc, inverse);
    doc.selection = this.selectionBefore;
    return this.change(doc, inverse);
  }

  private change(doc: ImageDocument, applied: Orientation): DocumentChange {
    const canvas = documentBounds(doc);
    return {
      dirty: canvas,
      ...(swapsSize(applied) && doc.width !== doc.height && { resized: true }),
      ...(this.selectionBefore && { selectionDirty: canvas }),
      layerPixels: doc.layers.map((layer) => ({ layerId: layer.id, rect: null })),
    };
  }
}

function orientDocument(doc: ImageDocument, orientation: Orientation): void {
  const { width, height } = doc;
  for (const layer of doc.layers) {
    switch (layer.kind) {
      case 'raster': {
        const { pixels } = layer;
        const area = orientRect(orientation, rasterBounds(layer), width, height);
        const data = orientPixels(orientation, pixels.data, pixels.width, pixels.height, 4);
        const oriented = { width: area.width, height: area.height, data };
        place(layer, { pixels: oriented, x: area.x, y: area.y });
        break;
      }
      default:
        assertNever(layer.kind);
    }
  }
  const size = orientedSize(orientation, width, height);
  doc.width = size.width;
  doc.height = size.height;
}
