import type { Command, Editor, LayerId } from '../core';
import {
  assertNever,
  duplicateLayerCommand,
  findLayerIndex,
  flattenCommand,
  mergeDownCommand,
  newLayerCommand,
  removeLayerCommand,
  reorderLayerCommand,
} from '../core';

/** Layer menu, layer panel and shortcut actions. All act on the active layer. */
export type LayerAction =
  | 'new'
  | 'duplicate'
  | 'delete'
  | 'merge-down'
  | 'flatten'
  | 'move-up'
  | 'move-down'
  | 'select-above'
  | 'select-below'
  | 'commit-floating';

/**
 * Actions a floating selection's layer can't take: they would take it away from its
 * source layer, or leave a copy that floats in place of the real thing.
 */
const NOT_WHILE_FLOATING: ReadonlySet<LayerAction> = new Set([
  'duplicate',
  'delete',
  'move-up',
  'move-down',
]);

/**
 * Whether `action` would do anything now, for enabling buttons and menu items. Mirrors
 * `runLayerAction` without calling the factories that take layer IDs.
 */
export function canRunLayerAction(editor: Editor, action: LayerAction): boolean {
  const doc = editor.document;
  const id = editor.activeLayerId;
  if (action === 'commit-floating') return editor.floating !== null;
  if (editor.floating) {
    if (NOT_WHILE_FLOATING.has(action)) return false;
    // Merging a floating selection down commits it.
    if (action === 'merge-down') return true;
  }
  if (action === 'new') return true;
  if (action === 'flatten') return flattenCommand(doc) !== null;
  const index = id === null ? -1 : findLayerIndex(doc, id);
  if (id === null || index < 0) return false;
  switch (action) {
    case 'duplicate':
      return true;
    case 'delete':
      return removeLayerCommand(doc, id) !== null;
    case 'merge-down':
      return mergeDownCommand(doc, id) !== null;
    case 'move-up':
    case 'select-above':
      return index < doc.layers.length - 1;
    case 'move-down':
    case 'select-below':
      return index > 0;
    default:
      return assertNever(action);
  }
}

/**
 * Runs `action` if it can run. New layers and copies become the active layer. A floating
 * selection is committed by merging it down, and first by adding a layer or flattening.
 */
export function runLayerAction(editor: Editor, action: LayerAction): void {
  if (action === 'commit-floating') {
    editor.commitFloating();
    return;
  }
  if (editor.floating) {
    if (NOT_WHILE_FLOATING.has(action)) return;
    if (action === 'merge-down' || action === 'new' || action === 'flatten') {
      editor.commitFloating();
      if (action === 'merge-down') return;
    }
  }
  const doc = editor.document;
  const id = editor.activeLayerId;
  if (action === 'new') {
    const command = newLayerCommand(doc, id);
    editor.history.execute(command);
    editor.setActiveLayer(command.layer.id);
    return;
  }
  if (action === 'flatten') {
    execute(editor, flattenCommand(doc));
    return;
  }
  const index = id === null ? -1 : findLayerIndex(doc, id);
  if (id === null || index < 0) return;
  switch (action) {
    case 'duplicate': {
      const command = duplicateLayerCommand(doc, id);
      if (!command) return;
      editor.history.execute(command);
      editor.setActiveLayer(command.copyId);
      return;
    }
    case 'delete':
      execute(editor, removeLayerCommand(doc, id));
      return;
    case 'merge-down':
      execute(editor, mergeDownCommand(doc, id));
      return;
    case 'move-up':
      execute(editor, reorderLayerCommand(doc, id, index + 1));
      return;
    case 'move-down':
      execute(editor, reorderLayerCommand(doc, id, index - 1));
      return;
    case 'select-above':
      selectAt(editor, index + 1);
      return;
    case 'select-below':
      selectAt(editor, index - 1);
      return;
    default:
      assertNever(action);
  }
}

/**
 * Commits the floating selection if it was lifted from `layerId`. Call before changing
 * that layer's visibility or opacity: the float took them when lifted, and its source
 * mustn't change while it floats.
 */
export function commitFloatingFrom(editor: Editor, layerId: LayerId): void {
  if (editor.floating?.sourceId === layerId) editor.commitFloating();
}

function execute(editor: Editor, command: Command | null): void {
  if (command) editor.history.execute(command);
}

function selectAt(editor: Editor, index: number): void {
  const { layers } = editor.document;
  if (index >= 0 && index < layers.length) editor.setActiveLayer(layers[index].id);
}
