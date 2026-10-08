import { compositeLayers } from '../compositor/composite-layers';
import type { ImageDocument } from '../document';
import { createLayerId, documentBounds, findLayer, getLayer, getLayerIndex } from '../document';
import type { FloatingSelection } from '../floating-selection';
import { FLOATING_LAYER_NAME, isFloatingIn } from '../floating-selection';
import { containsRect, intersectRects, unionRects } from '../geometry';
import type { Command, DocumentChange } from '../history/command';
import type { LayerId, RasterLayer } from '../layer';
import { assertNever, createRasterLayer, rasterBounds, toLayerSpace } from '../layer';
import type { PixelBuffer } from '../pixel-buffer';
import { createPixelBuffer } from '../pixel-buffer';
import { PixelSnapshot } from '../pixel-snapshot';
import type { Selection } from '../selection';
import type { Placement } from './layer-growth';
import { place, placementOf } from './layer-growth';
import { mergeArea } from './merge-commands';

/**
 * Lifts the selected pixels of a layer (the source) into a new floating layer directly
 * above it, the size of the selection's bounds, for the Move tool to move. The float
 * takes the source's opacity, visibility and blend mode, so the pixels look as they did.
 *
 * Coverage weights each pixel, as for every pixel edit: with coverage c, the float gets
 * alpha round(a × c / 255) of a pixel with alpha a and, unless copying, the source keeps
 * the rest. In straight alpha, weighting a pixel scales its alpha; its colour is
 * unchanged. Copying leaves the source untouched.
 */
export class LiftSelectionCommand implements Command {
  readonly label: string;
  private lifted: { readonly layer: RasterLayer; readonly floating: FloatingSelection } | null =
    null;

  /**
   * @param floatId the floating layer's ID, from `createLayerId(doc)`.
   * @param copy copy the selected pixels instead of cutting them out of the source.
   */
  constructor(
    readonly sourceId: LayerId,
    readonly floatId: LayerId,
    readonly copy = false,
  ) {
    this.label = copy ? 'Copy Selection' : 'Lift Selection';
  }

  apply(doc: ImageDocument): DocumentChange {
    const index = getLayerIndex(doc, this.sourceId);
    const source = doc.layers[index];
    if (findLayer(doc, this.floatId)) throw new Error(`Duplicate layer ID: ${this.floatId}`);
    if (!this.lifted) {
      if (!doc.selection) throw new Error('There is no selection to lift');
      this.lifted = lift(source, doc.selection, this.floatId, this.copy);
    } else if (this.lifted.floating.before) {
      // Redo: the source is as it was before the first lift, so cutting again matches.
      splitPixels(source, this.lifted.floating.selection, null, true);
    }
    doc.layers.splice(index + 1, 0, this.lifted.layer);
    return { ...liftChange(this.lifted.floating), floating: this.lifted.floating };
  }

  revert(doc: ImageDocument): DocumentChange {
    const index = this.lifted ? doc.layers.indexOf(this.lifted.layer) : -1;
    if (!this.lifted || index < 0) throw new Error('LiftSelectionCommand was not applied');
    doc.layers.splice(index, 1);
    this.lifted.floating.before?.restore(getLayer(doc, this.sourceId).pixels);
    return { ...liftChange(this.lifted.floating), floating: null };
  }
}

function lift(
  source: RasterLayer,
  selection: Selection,
  floatId: LayerId,
  copy: boolean,
): { layer: RasterLayer; floating: FloatingSelection } {
  const bounds = selection.bounds();
  if (!bounds) throw new Error('There is no selection to lift');
  const area = intersectRects(bounds, rasterBounds(source));
  const before =
    copy || !area ? null : PixelSnapshot.capture(source.pixels, toLayerSpace(source, area));
  const layer = createRasterLayer({
    id: floatId,
    name: FLOATING_LAYER_NAME,
    x: bounds.x,
    y: bounds.y,
    pixels: createPixelBuffer(bounds.width, bounds.height),
    opacity: source.opacity,
    visible: source.visible,
    blendMode: source.blendMode,
  });
  splitPixels(source, selection, layer, !copy);
  const floating: FloatingSelection = {
    layerId: floatId,
    sourceId: source.id,
    selection,
    x: bounds.x,
    y: bounds.y,
    before,
  };
  return { layer, floating };
}

/**
 * Splits the source's pixels under the selection by coverage: the selected part goes
 * into `float` (when given) and, with `cut`, out of the source. Pixels left with no
 * alpha become transparent black.
 */
function splitPixels(
  source: RasterLayer,
  selection: Selection,
  float: RasterLayer | null,
  cut: boolean,
): void {
  const bounds = selection.bounds();
  const area = bounds && intersectRects(bounds, rasterBounds(source));
  if (!area) return;
  const mask = selection.mask;
  const src = source.pixels;
  const data = src.data;
  const out = float?.pixels.data;
  const outWidth = float?.pixels.width ?? 0;
  for (let y = area.y; y < area.y + area.height; y++) {
    let m = y * selection.width + area.x;
    let s = ((y - source.y) * src.width + area.x - source.x) * 4;
    let f = float ? ((y - float.y) * outWidth + area.x - float.x) * 4 : 0;
    for (let n = 0; n < area.width; n++, m++, s += 4, f += 4) {
      const c = mask[m];
      const a = data[s + 3];
      if (c === 0 || a === 0) continue;
      // There are no .5 ties (2·a·c is even, 255 odd), so a − lifted also equals
      // round(a × (255 − c) / 255): the two parts are both correctly rounded.
      const lifted = c === 255 ? a : Math.round((a * c) / 255);
      if (out && lifted > 0) {
        out[f] = data[s];
        out[f + 1] = data[s + 1];
        out[f + 2] = data[s + 2];
        out[f + 3] = lifted;
      }
      if (!cut) continue;
      if (lifted === a) data[s] = data[s + 1] = data[s + 2] = data[s + 3] = 0;
      else data[s + 3] = a - lifted;
    }
  }
}

function liftChange(floating: FloatingSelection): DocumentChange {
  const { before } = floating;
  const dirty = floating.selection.bounds();
  return before?.rect
    ? { dirty, layerPixels: [{ layerId: floating.sourceId, rect: before.rect }] }
    : { dirty };
}

/** The source's state on either side of a commit. */
type CommitPlan =
  /** Nothing to change: a copy committed where it was lifted. */
  | { readonly kind: 'none' }
  /** Pixels changed inside the source's bounds. */
  | { readonly kind: 'in-place'; readonly undo: PixelSnapshot; readonly redo: PixelSnapshot }
  /** The source grew to take in pixels moved past its edges. */
  | { readonly kind: 'grow'; readonly undo: Placement; readonly redo: Placement };

/**
 * Merges a floating selection back into its source layer and removes the floating
 * layer, in one undo step; undo floats it again.
 *
 * The float's pixels are composited onto the source's own pixels with the merge-down
 * blend math, whatever either layer's opacity, visibility and blend mode, and the source
 * keeps its ID, name and those properties. Committed where it was lifted, the source gets
 * back exactly the pixels it had, which compositing alone can't promise for partly
 * selected pixels. Pixels moved past the source's edges make it grow to take them in, as
 * merging does.
 */
export class CommitFloatingCommand implements Command {
  readonly label = 'Commit Floating Selection';
  private committed: { readonly float: RasterLayer; readonly plan: CommitPlan } | null = null;

  constructor(readonly floating: FloatingSelection) {}

  apply(doc: ImageDocument): DocumentChange {
    if (!isFloatingIn(doc, this.floating)) {
      throw new Error('The floating layer must be directly above its source layer');
    }
    const index = getLayerIndex(doc, this.floating.layerId);
    const source = doc.layers[index - 1];
    const float = doc.layers[index];
    if (!this.committed) {
      this.committed = { float, plan: commitInto(doc, source, float, this.floating) };
    } else {
      restoreSource(source, this.committed.plan, 'redo');
    }
    doc.layers.splice(index, 1);
    return { ...commitChange(doc, source, this.committed), floating: null };
  }

  revert(doc: ImageDocument): DocumentChange {
    if (!this.committed) throw new Error('CommitFloatingCommand was not applied');
    const index = getLayerIndex(doc, this.floating.sourceId);
    const source = doc.layers[index];
    restoreSource(source, this.committed.plan, 'undo');
    doc.layers.splice(index + 1, 0, this.committed.float);
    return { ...commitChange(doc, source, this.committed), floating: this.floating };
  }
}

function commitInto(
  doc: ImageDocument,
  source: RasterLayer,
  float: RasterLayer,
  floating: FloatingSelection,
): CommitPlan {
  if (float.x === floating.x && float.y === floating.y) {
    const rect = floating.before?.rect;
    if (!floating.before || !rect) return { kind: 'none' };
    const undo = PixelSnapshot.capture(source.pixels, rect);
    floating.before.restore(source.pixels);
    return { kind: 'in-place', undo, redo: floating.before };
  }

  // The float is merged into the source's own pixels, not the layer into the canvas, so
  // both count as plain opaque layers here; the source keeps its opacity, visibility and
  // blend mode.
  const plain = { visible: true, opacity: 1, blendMode: 'normal' } as const;
  const raw: RasterLayer = { ...source, ...plain };
  const lifted: RasterLayer = { ...float, ...plain };
  const floatBounds = rasterBounds(float);
  if (containsRect(rasterBounds(source), floatBounds)) {
    const rect = toLayerSpace(source, floatBounds);
    const undo = PixelSnapshot.capture(source.pixels, rect);
    putPixels(source.pixels, compositeLayers([raw, lifted], floatBounds), rect.x, rect.y);
    return { kind: 'in-place', undo, redo: PixelSnapshot.capture(source.pixels, rect) };
  }
  const area = mergeArea(doc, raw, lifted);
  const undo = placementOf(source);
  const redo: Placement = { pixels: compositeLayers([raw, lifted], area), x: area.x, y: area.y };
  place(source, redo);
  return { kind: 'grow', undo, redo };
}

function restoreSource(source: RasterLayer, plan: CommitPlan, side: 'undo' | 'redo'): void {
  switch (plan.kind) {
    case 'none':
      return;
    case 'in-place':
      plan[side].restore(source.pixels);
      return;
    case 'grow':
      place(source, plan[side]);
      return;
    default:
      assertNever(plan);
  }
}

function commitChange(
  doc: ImageDocument,
  source: RasterLayer,
  { float, plan }: { readonly float: RasterLayer; readonly plan: CommitPlan },
): DocumentChange {
  const canvas = documentBounds(doc);
  const floatBounds = rasterBounds(float);
  switch (plan.kind) {
    case 'none':
      return { dirty: intersectRects(floatBounds, canvas) };
    case 'in-place': {
      const rect = plan.undo.rect;
      const changed = rect && { ...rect, x: rect.x + source.x, y: rect.y + source.y };
      const area = unionRects(floatBounds, changed);
      return {
        dirty: area && intersectRects(area, canvas),
        ...(rect && { layerPixels: [{ layerId: source.id, rect }] }),
      };
    }
    case 'grow': {
      const { redo } = plan;
      const grown = { x: redo.x, y: redo.y, width: redo.pixels.width, height: redo.pixels.height };
      const area = unionRects(unionRects(floatBounds, grown), {
        x: plan.undo.x,
        y: plan.undo.y,
        width: plan.undo.pixels.width,
        height: plan.undo.pixels.height,
      });
      return {
        dirty: area && intersectRects(area, canvas),
        layerPixels: [{ layerId: source.id, rect: null }],
      };
    }
    default:
      return assertNever(plan);
  }
}

/** Copies all of `pixels` into `target` with its top-left pixel at (x, y); it must fit. */
function putPixels(target: PixelBuffer, pixels: PixelBuffer, x: number, y: number): void {
  const rowBytes = pixels.width * 4;
  for (let row = 0; row < pixels.height; row++) {
    const from = row * rowBytes;
    target.data.set(
      pixels.data.subarray(from, from + rowBytes),
      ((y + row) * target.width + x) * 4,
    );
  }
}

/**
 * Lifts the selected pixels of `sourceId` into a floating layer, or copies them. Null if
 * there's no selection or no such layer, or the selection misses the layer. Takes a fresh
 * layer ID for the float.
 */
export function liftSelectionCommand(
  doc: ImageDocument,
  sourceId: LayerId,
  copy = false,
): LiftSelectionCommand | null {
  const source = findLayer(doc, sourceId);
  const bounds = doc.selection?.bounds() ?? null;
  if (!source || !bounds || !intersectRects(bounds, rasterBounds(source))) return null;
  return new LiftSelectionCommand(sourceId, createLayerId(doc), copy);
}

/** Null unless the floating layer is in the document, directly above its source. */
export function commitFloatingCommand(
  doc: ImageDocument,
  floating: FloatingSelection,
): CommitFloatingCommand | null {
  return isFloatingIn(doc, floating) ? new CommitFloatingCommand(floating) : null;
}
