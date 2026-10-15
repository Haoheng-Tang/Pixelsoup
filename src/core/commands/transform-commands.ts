import type { ImageDocument } from '../document';
import { MAX_IMAGE_SIZE, documentBounds, findLayer, getLayer } from '../document';
import type { FloatingSelection } from '../floating-selection';
import type { Rect } from '../geometry';
import { intersectRects, unionRects } from '../geometry';
import type { Command, DocumentChange } from '../history/command';
import type { LayerId, RasterLayer } from '../layer';
import { assertNever, rasterBounds } from '../layer';
import type { Orientation } from '../orientation';
import { orientPixels } from '../orientation';
import { createPixelBuffer } from '../pixel-buffer';
import type { Affine } from '../resample/affine';
import {
  IDENTITY,
  aboutPivot,
  alignToPixels,
  invert,
  multiply,
  rotation,
  scaling,
  transformedBounds,
  translation,
} from '../resample/affine';
import type { Interpolation } from '../resample/kernels';
import { transformPixels } from '../resample/transform';
import type { Selection } from '../selection';
import type { Placement } from './layer-growth';
import { place, placementOf } from './layer-growth';
import { ORIENTATION_LABELS } from './orientation-commands';

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

/** Where a layer's pixels go, and how its floating selection's outline follows them. */
interface Mapping {
  readonly after: Placement;
  /** Takes the outline's canvas coordinates (of pixel edges) to where they end up. */
  readonly outline: Affine;
  readonly interpolation: Interpolation;
}

/**
 * Replaces one raster layer's pixels and place in one undo step, which puts the old buffer
 * back. A floating selection's layer takes its outline along, mapped the same way so the
 * ants follow the pixels, and is marked edited. Any other layer must have its floating
 * selection committed first, as for other edits. Like moving a layer, it isn't a pixel edit
 * and ignores the selection.
 */
abstract class MapLayerCommand implements Command {
  abstract readonly label: string;
  private mapped: Transformed | null = null;

  constructor(
    readonly layerId: LayerId,
    private readonly floating: FloatingSelection | null | undefined,
  ) {}

  apply(doc: ImageDocument): DocumentChange {
    const layer = rasterLayer(doc, this.layerId);
    this.mapped ??= this.mapLayer(doc, layer);
    const { before, after, float } = this.mapped;
    place(layer, after);
    if (float) doc.selection = float.selectionAfter;
    return transformChange(doc, layer.id, before, after, float && afterSide(float));
  }

  revert(doc: ImageDocument): DocumentChange {
    const mapped = this.mapped;
    if (!mapped) throw new Error(`${this.label} was not applied`);
    const { before, after, float } = mapped;
    const layer = rasterLayer(doc, this.layerId);
    place(layer, before);
    if (float) doc.selection = float.selectionBefore;
    return transformChange(doc, layer.id, after, before, float && beforeSide(float));
  }

  protected abstract map(doc: ImageDocument, layer: RasterLayer): Mapping;

  private mapLayer(doc: ImageDocument, layer: RasterLayer): Transformed {
    const before = placementOf(layer);
    const { after, outline: affine, interpolation } = this.map(doc, layer);
    const floating = this.floating;
    if (!floating || floating.layerId !== layer.id) return { before, after, float: null };
    // The outline as lifted, moved to where the layer is now and mapped with it.
    const outline = floating.selection.transform(
      multiply(affine, translation(layer.x - floating.x, layer.y - floating.y)),
      interpolation,
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

/**
 * Maps one raster layer through `affine`, which takes canvas coordinates (of pixel edges)
 * to canvas coordinates. The pixels are resampled into a new buffer covering their
 * transformed whole-pixel bounds; outside the old buffer counts as transparent, so the new
 * edges are anti-aliased. Should those bounds exceed the maximum image size, only the part
 * on the canvas is kept. A floating selection's outline is transformed with its layer.
 */
export class TransformLayerCommand extends MapLayerCommand {
  readonly label: string;

  constructor(
    layerId: LayerId,
    readonly affine: Affine,
    readonly interpolation: Interpolation,
    options: TransformLayerOptions = {},
  ) {
    super(layerId, options.floating);
    if (!invert(affine)) throw new RangeError('The transform would flatten the layer');
    this.label = options.label ?? 'Transform Layer';
  }

  protected map(doc: ImageDocument, layer: RasterLayer): Mapping {
    const { affine, interpolation } = this;
    const after = transformedPlacement(doc, layer, affine, interpolation);
    return { after, outline: affine, interpolation };
  }
}

/**
 * Turns or flips one layer about the centre of its bounds, moving its pixels exactly as
 * turning the canvas does, with no resampling. Quarter turns of a layer whose width and
 * height differ by an odd number land half a pixel off the grid, and move on by half a
 * pixel (`alignToPixels`), so the opposite turn brings the layer back where it was. A
 * floating selection's outline turns or flips with its layer.
 */
export class OrientLayerCommand extends MapLayerCommand {
  readonly label: string;

  constructor(
    layerId: LayerId,
    readonly orientation: Orientation,
    floating: FloatingSelection | null = null,
  ) {
    super(layerId, floating);
    this.label = ORIENTATION_LABELS[orientation];
  }

  protected map(_doc: ImageDocument, layer: RasterLayer): Mapping {
    const { orientation } = this;
    const { pixels } = layer;
    const bounds = rasterBounds(layer);
    const pivotX = bounds.x + bounds.width / 2;
    const pivotY = bounds.y + bounds.height / 2;
    const affine = alignToPixels(
      aboutPivot(orientationMatrix(orientation), pivotX, pivotY),
      bounds,
    );
    const { x, y, width, height } = transformedBounds(affine, bounds);
    const data = orientPixels(orientation, pixels.data, pixels.width, pixels.height, 4);
    // Pixel centres land on pixel centres, so the nearest pixel moves the outline exactly.
    return {
      after: { pixels: { width, height, data }, x, y },
      outline: affine,
      interpolation: 'nearest',
    };
  }
}

/** `orientation` as a map about the origin. */
function orientationMatrix(orientation: Orientation): Affine {
  switch (orientation) {
    case 'rotate-cw':
      return rotation(90);
    case 'rotate-ccw':
      return rotation(-90);
    case 'rotate-180':
      return rotation(180);
    case 'flip-horizontal':
      return scaling(-1, 1);
    case 'flip-vertical':
      return scaling(1, -1);
    default:
      return assertNever(orientation);
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
 * Turns or flips a layer as `OrientLayerCommand` does, or returns null if there's no such
 * layer or it's hidden. Pass the editor's floating selection, whose outline follows its layer.
 */
export function orientLayerCommand(
  doc: ImageDocument,
  layerId: LayerId,
  orientation: Orientation,
  floating: FloatingSelection | null = null,
): OrientLayerCommand | null {
  const layer = findLayer(doc, layerId);
  if (!layer || !layer.visible) return null;
  return new OrientLayerCommand(layerId, orientation, floating);
}
