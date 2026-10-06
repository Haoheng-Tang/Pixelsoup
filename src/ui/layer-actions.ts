import type { Command, Editor } from '../core';
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
  | 'select-below';

/**
 * Whether `action` would do anything now, for enabling buttons and menu items. Mirrors
 * `runLayerAction` without calling the factories that take layer IDs.
 */
export function canRunLayerAction(editor: Editor, action: LayerAction): boolean {
  const doc = editor.document;
  const id = editor.activeLayerId;
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

/** Runs `action` if it can run. New layers and copies become the active layer. */
export function runLayerAction(editor: Editor, action: LayerAction): void {
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

function execute(editor: Editor, command: Command | null): void {
  if (command) editor.history.execute(command);
}

function selectAt(editor: Editor, index: number): void {
  const { layers } = editor.document;
  if (index >= 0 && index < layers.length) editor.setActiveLayer(layers[index].id);
}
