import type { ImageDocument } from '../document';
import { documentBounds, findLayer, getLayer } from '../document';
import { intersectRects } from '../geometry';
import type { Command, DocumentChange } from '../history/command';
import type { Layer, LayerId } from '../layer';
import { clampOpacity, layerBounds } from '../layer';

/** Canvas region affected by changing a layer's compositing properties. */
function layerChange(doc: ImageDocument, layer: Layer): DocumentChange {
  const bounds = layerBounds(layer);
  const canvas = documentBounds(doc);
  return { dirty: bounds ? intersectRects(bounds, canvas) : canvas };
}

/** Puts a new layer on top of the stack. The layer's ID must not be in use in the document. */
export class AddLayerCommand implements Command {
  constructor(
    readonly layer: Layer,
    readonly label = 'Add Layer',
  ) {}

  apply(doc: ImageDocument): DocumentChange {
    if (findLayer(doc, this.layer.id)) throw new Error(`Duplicate layer ID: ${this.layer.id}`);
    doc.layers.push(this.layer);
    return layerChange(doc, this.layer);
  }

  revert(doc: ImageDocument): DocumentChange {
    const index = doc.layers.indexOf(this.layer);
    if (index < 0) throw new Error(`Layer not found: ${this.layer.id}`);
    doc.layers.splice(index, 1);
    return layerChange(doc, this.layer);
  }
}

export class SetLayerVisibilityCommand implements Command {
  readonly label: string;
  private previous: boolean | null = null;

  constructor(
    readonly layerId: LayerId,
    readonly visible: boolean,
  ) {
    this.label = visible ? 'Show Layer' : 'Hide Layer';
  }

  apply(doc: ImageDocument): DocumentChange {
    const layer = getLayer(doc, this.layerId);
    this.previous ??= layer.visible;
    layer.visible = this.visible;
    return layerChange(doc, layer);
  }

  revert(doc: ImageDocument): DocumentChange {
    const layer = getLayer(doc, this.layerId);
    layer.visible = this.previous ?? layer.visible;
    return layerChange(doc, layer);
  }
}

export class SetLayerOpacityCommand implements Command {
  readonly label = 'Change Layer Opacity';
  private previous: number | null = null;
  private opacity: number;

  /**
   * @param opacity 0–1, clamped.
   * @param mergeKey pass the same key for every update in one gesture (e.g. a slider
   *   drag) so the whole gesture becomes a single undo step.
   */
  constructor(
    readonly layerId: LayerId,
    opacity: number,
    readonly mergeKey?: string,
  ) {
    this.opacity = clampOpacity(opacity);
  }

  apply(doc: ImageDocument): DocumentChange {
    const layer = getLayer(doc, this.layerId);
    this.previous ??= layer.opacity;
    layer.opacity = this.opacity;
    return layerChange(doc, layer);
  }

  revert(doc: ImageDocument): DocumentChange {
    const layer = getLayer(doc, this.layerId);
    layer.opacity = this.previous ?? layer.opacity;
    return layerChange(doc, layer);
  }

  mergeWith(next: Command): boolean {
    if (!(next instanceof SetLayerOpacityCommand) || next.layerId !== this.layerId) return false;
    this.opacity = next.opacity;
    return true;
  }
}
