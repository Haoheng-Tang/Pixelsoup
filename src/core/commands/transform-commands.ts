import type { ImageDocument } from '../document';
import { MAX_IMAGE_SIZE, documentBounds, findLayer, getLayer } from '../document';
import type { FloatingSelection } from '../floating-selection';
import type { Rect } from '../geometry';
import { intersectRects, unionRects } from '../geometry';
import type { Command, DocumentChange } from '../history/command';
import type { LayerId, RasterLayer } from '../layer';
import { assertNever, layerBounds } from '../layer';
import { createPixelBuffer } from '../pixel-buffer';
import type { Affine } from '../resample/affine';
import {
  IDENTITY,
  aboutPivot,
  alignToPixels,
  invert,
  multiply,
  rotation,
  transformedBounds,
  translation,
} from '../resample/affine';
import type { Interpolation } from '../resample/kernels';
import { transformPixels } from '../resample/transform';
import type { Selection } from '../selection';
import type { Placement } from './layer-growth';
import { place, placementOf } from './layer-growth';

export interface TransformLayerOptions {
  /** The undo label: "Transform Layer" unless given. */
  readonly label?: string;
  /**
   * The editor's floating selection. If the command transforms its layer, the selection's
   * outline is transformed with it.
   */
  readonly floating?: FloatingSelection | null;
}

/** A floating selection, and the document's selection, before and after a transform. */
interface FloatChange {
  readonly before: FloatingSelection;
  readonly after: FloatingSelection;
  readonly selectionBefore: Selection | null;
  readonly selectionAfter: Selection | null;
}

interface Transformed {
  readonly before: Placement;
  readonly after: Placement;
  readonly float: FloatChange | null;
}

/**
 * Maps one raster layer through `affine`, which takes canvas coordinates (of pixel edges)
 * to canvas coordinates. The pixels are resampled into a new buffer covering their
 * transformed whole-pixel bounds; outside the old buffer counts as transparent, so the new
 * edges are anti-aliased. Should those bounds exceed the maximum image size, only the part
 * on the canvas is kept. Undo puts the old buffer back.
 *
 * Transforming a floating selection's layer transforms its outline the same way, so the
 * ants follow the pixels, and marks it edited. Transforming any other layer must commit a
 * floating selection first, as other edits do. Like moving a layer, it isn't a pixel edit
 * and ignores the selection.
 */
export class TransformLayerCommand implements Command {
  readonly label: string;
  private transformed: Transformed | null = null;

  constructor(
    readonly layerId: LayerId,
    readonly affine: Affine,
    readonly interpolation: Interpolation,
    private readonly options: TransformLayerOptions = {},
  ) {
    if (!invert(affine)) throw new RangeError('The transform would flatten the layer');
    this.label = options.label ?? 'Transform Layer';
  }

  apply(doc: ImageDocument): DocumentChange {
    const layer = rasterLayer(doc, this.layerId);
    this.transformed ??= this.transform(doc, layer);
    const { before, after, float } = this.transformed;
    place(layer, after);
    if (float) doc.selection = float.selectionAfter;
    return transformChange(doc, layer.id, before, after, float && afterSide(float));
  }

  revert(doc: ImageDocument): DocumentChange {
    const transformed = this.transformed;
    if (!transformed) throw new Error('TransformLayerCommand was not applied');
    const { before, after, float } = transformed;
    const layer = rasterLayer(doc, this.layerId);
    place(layer, before);
    if (float) doc.selection = float.selectionBefore;
    return transformChange(doc, layer.id, after, before, float && beforeSide(float));
  }

  private transform(doc: ImageDocument, layer: RasterLayer): Transformed {
    const before = placementOf(layer);
    const after = transformedPlacement(doc, layer, this.affine, this.interpolation);
    const floating = this.options.floating;
    if (!floating || floating.layerId !== layer.id) return { before, after, float: null };
    // The outline as lifted, moved to where the layer is now and transformed with it.
    const outline = floating.selection.transform(
      multiply(this.affine, translation(layer.x - floating.x, layer.y - floating.y)),
      this.interpolation,
    );
    const float: FloatChange = {
      before: floating,
      after: { ...floating, selection: outline, x: after.x, y: after.y, edited: true },
      selectionBefore: doc.selection,
      selectionAfter: outline.isEmpty ? null : outline,
    };
    return { before, after, float };
  }
}

function rasterLayer(doc: ImageDocument, id: LayerId): RasterLayer {
  const layer = getLayer(doc, id);
  switch (layer.kind) {
    case 'raster':
      return layer;
    default:
      return assertNever(layer.kind);
  }
}

/**
 * The layer's pixels mapped through `affine`: a transparent canvas-sized layer if none
 * would be left on the canvas after cutting them to it for being too big.
 */
function transformedPlacement(
  doc: ImageDocument,
  layer: RasterLayer,
  affine: Affine,
  interpolation: Interpolation,
): Placement {
  const { pixels } = layer;
  const m = multiply(affine, translation(layer.x, layer.y));
  const bounds = transformedBounds(m, { x: 0, y: 0, width: pixels.width, height: pixels.height });
  const tooBig = bounds.width > MAX_IMAGE_SIZE || bounds.height > MAX_IMAGE_SIZE;
  const clip = tooBig ? documentBounds(doc) : undefined;
  return (
    transformPixels(pixels, m, interpolation, clip) ?? {
      pixels: createPixelBuffer(doc.width, doc.height),
      x: 0,
      y: 0,
    }
  );
}

/** What the floating selection and the document's selection change to, one way or the other. */
interface SelectionSide {
  readonly floating: FloatingSelection;
  readonly from: Selection | null;
  readonly to: Selection | null;
}

function afterSide(float: FloatChange): SelectionSide {
  return { floating: float.after, from: float.selectionBefore, to: float.selectionAfter };
}

function beforeSide(float: FloatChange): SelectionSide {
  return { floating: float.before, from: float.selectionAfter, to: float.selectionBefore };
}

function transformChange(
  doc: ImageDocument,
  layerId: LayerId,
  from: Placement,
  to: Placement,
  selection: SelectionSide | null,
): DocumentChange {
  const area = unionRects(boundsOf(from), boundsOf(to));
  return {
    dirty: area && intersectRects(area, documentBounds(doc)),
    layerPixels: [{ layerId, rect: null }],
    ...(selection && {
      selectionDirty: unionRects(selection.from?.bounds() ?? null, selection.to?.bounds() ?? null),
      floating: selection.floating,
    }),
  };
}

function boundsOf(placement: Placement): Rect {
  const { pixels, x, y } = placement;
  return { x, y, width: pixels.width, height: pixels.height };
}

/**
 * Transforms a layer as `TransformLayerCommand` does, or returns null if there's no such
 * layer, it's hidden, or `affine` would leave it as it is or flatten it. Pass the editor's
 * floating selection, whose outline follows its layer.
 */
export function transformLayerCommand(
  doc: ImageDocument,
  layerId: LayerId,
  affine: Affine,
  interpolation: Interpolation,
  options: TransformLayerOptions = {},
): TransformLayerCommand | null {
  const layer = findLayer(doc, layerId);
  const identity = affine.every((value, i) => value === IDENTITY[i]);
  if (!layer || !layer.visible || identity || !invert(affine)) return null;
  return new TransformLayerCommand(layerId, affine, interpolation, options);
}

/**
 * Rotate Layer: turns a layer `degrees` clockwise about its centre, with bilinear
 * interpolation, shifted by less than a pixel so that its new bounds start on a pixel
 * corner (which makes quarter turns exact). A floating selection's layer turns with its
 * outline, as "Rotate Selection". Null if there's no such layer, it's hidden, or the angle
 * is a whole number of turns.
 */
export function rotateLayerCommand(
  doc: ImageDocument,
  layerId: LayerId,
  degrees: number,
  floating: FloatingSelection | null,
): TransformLayerCommand | null {
  const layer = findLayer(doc, layerId);
  const bounds = layer && layerBounds(layer);
  if (!bounds || !Number.isFinite(degrees) || degrees % 360 === 0) return null;
  const centreX = bounds.x + bounds.width / 2;
  const centreY = bounds.y + bounds.height / 2;
  const affine = alignToPixels(aboutPivot(rotation(degrees), centreX, centreY), bounds);
  const label = floating?.layerId === layerId ? 'Rotate Selection' : 'Rotate Layer';
  return transformLayerCommand(doc, layerId, affine, 'bilinear', { label, floating });
}
