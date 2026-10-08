import type { ImageDocument } from '../document';
import { documentBounds, findLayer, getLayer } from '../document';
import { intersectRects, unionRects } from '../geometry';
import type { Command, DocumentChange } from '../history/command';
import type { Layer, LayerId } from '../layer';
import { layerBounds } from '../layer';
import type { Selection } from '../selection';

export interface MoveLayerOptions {
  /** Defaults to 'Move Layer'. */
  readonly label?: string;
  /**
   * Pass the same key for every step of one gesture (a drag, or a run of arrow-key
   * nudges) so the whole gesture becomes a single undo step.
   */
  readonly mergeKey?: string;
  /**
   * The selection after the move (null deselects), changed in the same undo step so that
   * an outline can travel with the pixels it surrounds. Left alone when omitted.
   */
  readonly selection?: Selection | null;
}

/**
 * Moves a layer so that its top-left pixel is at (x, y) on the canvas. Only the offset
 * changes, not the pixels, so the layer isn't listed in `layerPixels`. Positions may be
 * negative or put the layer entirely off the canvas.
 */
export class MoveLayerCommand implements Command {
  readonly label: string;
  readonly mergeKey: string | undefined;
  private x: number;
  private y: number;
  /** Undefined: the command doesn't touch the selection. */
  private selection: Selection | null | undefined;
  private previous: { x: number; y: number; selection: Selection | null } | null = null;

  constructor(
    readonly layerId: LayerId,
    x: number,
    y: number,
    options: MoveLayerOptions = {},
  ) {
    if (!Number.isInteger(x) || !Number.isInteger(y)) {
      throw new RangeError(`Layers move to whole pixels, not ${x}, ${y}`);
    }
    this.x = x;
    this.y = y;
    this.label = options.label ?? 'Move Layer';
    this.mergeKey = options.mergeKey;
    this.selection = options.selection === undefined ? undefined : nonEmpty(options.selection);
  }

  apply(doc: ImageDocument): DocumentChange {
    const layer = getLayer(doc, this.layerId);
    if (
      this.selection &&
      (this.selection.width !== doc.width || this.selection.height !== doc.height)
    ) {
      throw new RangeError(
        `Selection is ${this.selection.width}x${this.selection.height}, document is ${doc.width}x${doc.height}`,
      );
    }
    this.previous ??= { x: layer.x, y: layer.y, selection: doc.selection };
    return moveTo(doc, layer, this.x, this.y, this.selection);
  }

  revert(doc: ImageDocument): DocumentChange {
    if (!this.previous) throw new Error('MoveLayerCommand was not applied');
    const { x, y, selection } = this.previous;
    return moveTo(
      doc,
      getLayer(doc, this.layerId),
      x,
      y,
      this.selection === undefined ? undefined : selection,
    );
  }

  mergeWith(next: Command): boolean {
    if (!(next instanceof MoveLayerCommand) || next.layerId !== this.layerId) return false;
    this.x = next.x;
    this.y = next.y;
    if (next.selection !== undefined) this.selection = next.selection;
    return true;
  }
}

function moveTo(
  doc: ImageDocument,
  layer: Layer,
  x: number,
  y: number,
  selection: Selection | null | undefined,
): DocumentChange {
  const before = layerBounds(layer);
  layer.x = x;
  layer.y = y;
  const area = unionRects(before, layerBounds(layer));
  const dirty = area && intersectRects(area, documentBounds(doc));
  if (selection === undefined) return { dirty };
  const outline = doc.selection?.bounds() ?? null;
  doc.selection = selection;
  return { dirty, selectionDirty: unionRects(outline, selection?.bounds() ?? null) };
}

function nonEmpty(selection: Selection | null): Selection | null {
  return selection && !selection.isEmpty ? selection : null;
}

/**
 * Moves a layer to (x, y). Null if the layer doesn't exist or is already there, unless
 * the selection would change.
 */
export function moveLayerCommand(
  doc: ImageDocument,
  layerId: LayerId,
  x: number,
  y: number,
  options: MoveLayerOptions = {},
): MoveLayerCommand | null {
  const layer = findLayer(doc, layerId);
  if (!layer) return null;
  const selection = options.selection === undefined ? undefined : nonEmpty(options.selection);
  const current = doc.selection;
  const selectionChanges =
    selection !== undefined &&
    (selection === null || current === null ? selection !== current : !selection.equals(current));
  if (layer.x === x && layer.y === y && !selectionChanges) return null;
  return new MoveLayerCommand(layerId, x, y, options);
}
