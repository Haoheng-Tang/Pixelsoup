import type { ImageDocument } from '../document';
import {
  createLayerId,
  documentBounds,
  findLayer,
  findLayerIndex,
  getLayer,
  getLayerIndex,
} from '../document';
import { intersectRects } from '../geometry';
import type { Command, DocumentChange } from '../history/command';
import type { Layer, LayerId } from '../layer';
import { clampOpacity, createRasterLayer, duplicateLayer, layerBounds } from '../layer';

/** Canvas region affected by changing a layer's compositing properties. */
function layerChange(doc: ImageDocument, layer: Layer): DocumentChange {
  const bounds = layerBounds(layer);
  const canvas = documentBounds(doc);
  return { dirty: bounds ? intersectRects(bounds, canvas) : canvas };
}

/**
 * Puts a new layer into the stack: at `index` (0 = bottom), or on top when omitted. The
 * layer's ID must not be in use in the document.
 */
export class AddLayerCommand implements Command {
  constructor(
    readonly layer: Layer,
    readonly label = 'Add Layer',
    readonly index?: number,
  ) {}

  apply(doc: ImageDocument): DocumentChange {
    if (findLayer(doc, this.layer.id)) throw new Error(`Duplicate layer ID: ${this.layer.id}`);
    const index = this.index ?? doc.layers.length;
    assertIndex(index, doc.layers.length + 1);
    doc.layers.splice(index, 0, this.layer);
    return layerChange(doc, this.layer);
  }

  revert(doc: ImageDocument): DocumentChange {
    const index = doc.layers.indexOf(this.layer);
    if (index < 0) throw new Error(`Layer not found: ${this.layer.id}`);
    doc.layers.splice(index, 1);
    return layerChange(doc, this.layer);
  }
}

/** Removes a layer. A document's only layer can't be removed. */
export class RemoveLayerCommand implements Command {
  readonly label = 'Delete Layer';
  private removed: { readonly layer: Layer; readonly index: number } | null = null;

  constructor(readonly layerId: LayerId) {}

  apply(doc: ImageDocument): DocumentChange {
    const index = getLayerIndex(doc, this.layerId);
    if (doc.layers.length <= 1) throw new Error('A document must keep at least one layer');
    const [layer] = doc.layers.splice(index, 1) as [Layer];
    this.removed = { layer, index };
    return layerChange(doc, layer);
  }

  revert(doc: ImageDocument): DocumentChange {
    if (!this.removed) throw new Error('RemoveLayerCommand was not applied');
    const { layer, index } = this.removed;
    doc.layers.splice(index, 0, layer);
    return layerChange(doc, layer);
  }
}

/**
 * Copies a layer, pixels and all, into a new layer directly above it, named `name` or by
 * default "<name> copy" (see `duplicateName`). The copy is made when the command is first
 * applied.
 */
export class DuplicateLayerCommand implements Command {
  readonly label = 'Duplicate Layer';
  private copy: Layer | null = null;

  /**
   * @param copyId the copy's ID, from `createLayerId(doc)`.
   * @param name the copy's name; must not be blank.
   */
  constructor(
    readonly sourceId: LayerId,
    readonly copyId: LayerId,
    readonly name?: string,
  ) {
    if (name?.trim() === '') throw new RangeError('Layer names cannot be empty');
  }

  apply(doc: ImageDocument): DocumentChange {
    const index = getLayerIndex(doc, this.sourceId);
    if (findLayer(doc, this.copyId)) throw new Error(`Duplicate layer ID: ${this.copyId}`);
    const source = doc.layers[index];
    this.copy ??= duplicateLayer(source, this.copyId, this.name ?? duplicateName(source.name));
    doc.layers.splice(index + 1, 0, this.copy);
    return layerChange(doc, this.copy);
  }

  revert(doc: ImageDocument): DocumentChange {
    const index = this.copy ? doc.layers.indexOf(this.copy) : -1;
    if (!this.copy || index < 0) throw new Error(`Layer not found: ${this.copyId}`);
    doc.layers.splice(index, 1);
    return layerChange(doc, this.copy);
  }
}

/** Moves a layer to stack position `toIndex` (0 = bottom); the layers in between shift over. */
export class ReorderLayerCommand implements Command {
  readonly label = 'Reorder Layer';
  private from: number | null = null;

  constructor(
    readonly layerId: LayerId,
    readonly toIndex: number,
  ) {}

  apply(doc: ImageDocument): DocumentChange {
    const from = getLayerIndex(doc, this.layerId);
    assertIndex(this.toIndex, doc.layers.length);
    this.from ??= from;
    return moveLayer(doc, from, this.toIndex);
  }

  revert(doc: ImageDocument): DocumentChange {
    const at = getLayerIndex(doc, this.layerId);
    return moveLayer(doc, at, this.from ?? at);
  }
}

/** Only the moved layer's area can look different: the others keep their order. */
function moveLayer(doc: ImageDocument, from: number, to: number): DocumentChange {
  const [layer] = doc.layers.splice(from, 1) as [Layer];
  doc.layers.splice(to, 0, layer);
  return layerChange(doc, layer);
}

export class RenameLayerCommand implements Command {
  readonly label = 'Rename Layer';
  private previous: string | null = null;

  constructor(
    readonly layerId: LayerId,
    readonly name: string,
  ) {
    if (name.trim() === '') throw new RangeError('Layer names cannot be empty');
  }

  apply(doc: ImageDocument): DocumentChange {
    const layer = getLayer(doc, this.layerId);
    this.previous ??= layer.name;
    layer.name = this.name;
    return { dirty: null };
  }

  revert(doc: ImageDocument): DocumentChange {
    const layer = getLayer(doc, this.layerId);
    layer.name = this.previous ?? layer.name;
    return { dirty: null };
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

// Factories for the UI: each returns null when its command would change nothing or isn't
// allowed, so callers can disable the matching button or menu item.

/**
 * A new transparent layer the size of the canvas named "Layer N" (one past the highest
 * such number in use), placed directly above `aboveId`, or on top when that's null or
 * not in the document. Takes a fresh layer ID from the document.
 */
export function newLayerCommand(doc: ImageDocument, aboveId: LayerId | null): AddLayerCommand {
  const layer = createRasterLayer({
    id: createLayerId(doc),
    name: nextLayerName(doc),
    width: doc.width,
    height: doc.height,
  });
  return new AddLayerCommand(layer, 'New Layer', indexAbove(doc, aboveId));
}

/** Stack index directly above `layerId`, or the top when it's null or not in the document. */
export function indexAbove(doc: ImageDocument, layerId: LayerId | null): number {
  const index = layerId === null ? -1 : findLayerIndex(doc, layerId);
  return index < 0 ? doc.layers.length : index + 1;
}

/** "Layer N", one past the highest such number among the document's layer names. */
export function nextLayerName(doc: ImageDocument): string {
  let highest = 0;
  for (const layer of doc.layers) {
    const match = /^Layer (\d+)$/.exec(layer.name);
    if (match) highest = Math.max(highest, Number(match[1]));
  }
  return `Layer ${highest + 1}`;
}

/** The name a copy of a layer named `name` gets by default: "<name> copy". */
export function duplicateName(name: string): string {
  return `${name} copy`;
}

/** Null unless the layer exists and isn't the document's only layer. */
export function removeLayerCommand(
  doc: ImageDocument,
  layerId: LayerId,
): RemoveLayerCommand | null {
  return findLayer(doc, layerId) && doc.layers.length > 1 ? new RemoveLayerCommand(layerId) : null;
}

/**
 * Copies the layer as "<name> copy", or as `name` (trimmed) if given. Null if the layer
 * doesn't exist or `name` is blank. Takes a fresh layer ID for the copy.
 */
export function duplicateLayerCommand(
  doc: ImageDocument,
  layerId: LayerId,
  name?: string,
): DuplicateLayerCommand | null {
  const trimmed = name?.trim();
  if (!findLayer(doc, layerId) || trimmed === '') return null;
  return new DuplicateLayerCommand(layerId, createLayerId(doc), trimmed);
}

/** Null if the layer doesn't exist, is already at `toIndex`, or `toIndex` is out of range. */
export function reorderLayerCommand(
  doc: ImageDocument,
  layerId: LayerId,
  toIndex: number,
): ReorderLayerCommand | null {
  const from = findLayerIndex(doc, layerId);
  if (from < 0 || from === toIndex || !isIndex(toIndex, doc.layers.length)) return null;
  return new ReorderLayerCommand(layerId, toIndex);
}

/** Null if the layer doesn't exist, the name is blank, or it's unchanged. */
export function renameLayerCommand(
  doc: ImageDocument,
  layerId: LayerId,
  name: string,
): RenameLayerCommand | null {
  const layer = findLayer(doc, layerId);
  if (!layer || name.trim() === '' || name === layer.name) return null;
  return new RenameLayerCommand(layerId, name);
}

function isIndex(index: number, length: number): boolean {
  return Number.isInteger(index) && index >= 0 && index < length;
}

function assertIndex(index: number, length: number): void {
  if (!isIndex(index, length)) throw new RangeError(`Layer index out of range: ${index}`);
}
