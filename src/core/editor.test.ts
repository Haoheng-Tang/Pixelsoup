import { describe, expect, it } from 'vitest';
import { createBlankDocument } from './blank-document';
import { liftSelectionCommand } from './commands/float-commands';
import {
  AddLayerCommand,
  SetLayerOpacityCommand,
  SetLayerVisibilityCommand,
  newLayerCommand,
  removeLayerCommand,
  reorderLayerCommand,
} from './commands/layer-commands';
import { flattenCommand, mergeDownCommand } from './commands/merge-commands';
import { createDocument, createLayerId } from './document';
import type { EditorChange } from './editor';
import { Editor } from './editor';
import { createRasterLayer } from './layer';
import { Selection } from './selection';

function setup() {
  const editor = new Editor(createBlankDocument({ width: 20, height: 10, background: 'white' }));
  const changes: EditorChange[] = [];
  editor.subscribe((change) => changes.push(change));
  const layerId = editor.document.layers[0]?.id ?? '';
  return { editor, changes, layerId };
}

/** An editor on a 10×10 document with a 4×4 layer per name, bottom first, IDs layer-1… */
function stackEditor(...names: string[]) {
  const doc = createDocument(10, 10);
  for (const name of names) {
    doc.layers.push(createRasterLayer({ id: createLayerId(doc), name, width: 4, height: 4 }));
  }
  const editor = new Editor(doc);
  const changes: EditorChange[] = [];
  editor.subscribe((change) => changes.push(change));
  return { editor, doc, changes };
}

function activeName(editor: Editor): string | undefined {
  return editor.activeLayer?.name;
}

describe('Editor dirty tracking', () => {
  it('starts clean and becomes dirty after an edit', () => {
    const { editor, layerId } = setup();
    expect(editor.isDirty).toBe(false);
    editor.history.execute(new SetLayerVisibilityCommand(layerId, false));
    expect(editor.isDirty).toBe(true);
  });

  it('is clean again after undoing back to the saved state', () => {
    const { editor, layerId } = setup();
    editor.history.execute(new SetLayerOpacityCommand(layerId, 0.5));
    editor.history.undo();
    expect(editor.isDirty).toBe(false);
    editor.history.redo();
    expect(editor.isDirty).toBe(true);
  });

  it('is clean after markSaved and dirty when undoing past the save', () => {
    const { editor, layerId, changes } = setup();
    editor.history.execute(new SetLayerOpacityCommand(layerId, 0.5));
    editor.markSaved();
    expect(editor.isDirty).toBe(false);
    expect(changes.at(-1)).toEqual({ dirty: null });

    editor.history.undo();
    expect(editor.isDirty).toBe(true);
    editor.history.redo();
    expect(editor.isDirty).toBe(false);
  });

  it('stays dirty for edits made after the state that was saved', () => {
    const { editor, layerId } = setup();
    editor.history.execute(new SetLayerOpacityCommand(layerId, 0.5));
    const savedState = editor.history.stateId; // read when serialization starts
    editor.history.execute(new SetLayerOpacityCommand(layerId, 0.25)); // edit during the write
    editor.markSaved(savedState);
    expect(editor.isDirty).toBe(true);
    editor.history.undo();
    expect(editor.isDirty).toBe(false);
  });

  it('becomes dirty when a gesture continues after a save', () => {
    const { editor, layerId } = setup();
    editor.history.execute(new SetLayerOpacityCommand(layerId, 0.9, 'drag'));
    editor.markSaved();
    editor.history.execute(new SetLayerOpacityCommand(layerId, 0.5, 'drag'));
    expect(editor.isDirty).toBe(true);
  });
});

describe('Editor.replaceDocument', () => {
  it('swaps the document, starts a fresh clean history and announces the swap', () => {
    const { editor, layerId, changes } = setup();
    editor.history.execute(new SetLayerOpacityCommand(layerId, 0.5));
    const revision = editor.revision;

    const next = createDocument(300, 200);
    editor.replaceDocument(next);

    expect(editor.document).toBe(next);
    expect(editor.isDirty).toBe(false);
    expect(editor.history.canUndo).toBe(false);
    expect(editor.revision).toBe(revision + 1);
    expect(changes.at(-1)).toEqual({
      dirty: { x: 0, y: 0, width: 300, height: 200 },
      documentReplaced: true,
      activeLayerChanged: true,
    });
  });

  it('ignores changes from the previous history', () => {
    const { editor, layerId, changes } = setup();
    const oldHistory = editor.history;
    editor.replaceDocument(createDocument(5, 5));
    const count = changes.length;
    oldHistory.execute(new SetLayerVisibilityCommand(layerId, false));
    expect(changes.length).toBe(count);
    expect(editor.isDirty).toBe(false);
  });
});

describe('Editor active layer', () => {
  it('starts on the top layer, and is null without layers', () => {
    expect(stackEditor('A', 'B', 'C').editor.activeLayerId).toBe('layer-3');
    const empty = new Editor(createDocument(4, 4));
    expect(empty.activeLayerId).toBeNull();
    expect(empty.activeLayer).toBeNull();
  });

  it('is session state: setting it notifies, but is no undo step or unsaved change', () => {
    const { editor, changes } = stackEditor('A', 'B');
    editor.setActiveLayer('layer-1');
    expect(activeName(editor)).toBe('A');
    expect(changes).toEqual([{ dirty: null, activeLayerChanged: true }]);
    expect(editor.history.canUndo).toBe(false);
    expect(editor.isDirty).toBe(false);

    editor.setActiveLayer('layer-1');
    expect(changes).toHaveLength(1);
    expect(() => editor.setActiveLayer('layer-9')).toThrow(/not found/);
    expect(editor.activeLayerId).toBe('layer-1');
  });

  it('moves to the layer below when the active layer is deleted, or above from the bottom', () => {
    const { editor, doc, changes } = stackEditor('A', 'B', 'C');
    editor.setActiveLayer('layer-2');
    editor.history.execute(removeLayerCommand(doc, 'layer-2')!);
    expect(activeName(editor)).toBe('A');
    expect(changes.at(-1)).toMatchObject({ activeLayerChanged: true });

    editor.history.execute(removeLayerCommand(doc, 'layer-1')!);
    expect(activeName(editor)).toBe('C');
  });

  it('stays on its layer when another one is deleted', () => {
    const { editor, doc, changes } = stackEditor('A', 'B', 'C');
    editor.history.execute(removeLayerCommand(doc, 'layer-1')!);
    expect(activeName(editor)).toBe('C');
    expect(changes.at(-1)).not.toHaveProperty('activeLayerChanged');
  });

  it('lands on the merged layer after merge down', () => {
    const { editor, doc } = stackEditor('A', 'B', 'C');
    editor.history.execute(mergeDownCommand(doc, 'layer-3')!);
    expect(editor.activeLayerId).toBe('layer-2');
  });

  it('lands on the flattened layer', () => {
    const { editor, doc } = stackEditor('A', 'B', 'C');
    editor.history.execute(flattenCommand(doc)!);
    expect(editor.activeLayerId).toBe('layer-1');
  });

  it('follows its layer when the layer is reordered', () => {
    const { editor, doc } = stackEditor('A', 'B', 'C', 'D');
    editor.setActiveLayer('layer-1');
    editor.history.execute(reorderLayerCommand(doc, 'layer-1', 2)!);
    expect(activeName(editor)).toBe('A');
    // The neighbour below in the new order takes over when it goes.
    editor.history.execute(removeLayerCommand(doc, 'layer-1')!);
    expect(activeName(editor)).toBe('C');
  });

  it('returns to the layer below when undo removes the active layer', () => {
    const { editor, doc } = stackEditor('A', 'B');
    editor.setActiveLayer('layer-1');
    const command = newLayerCommand(doc, editor.activeLayerId);
    editor.history.execute(command);
    editor.setActiveLayer(command.layer.id);
    editor.history.undo();
    expect(activeName(editor)).toBe('A');
  });

  it('resets to the top layer when the document is replaced', () => {
    const { editor, changes } = stackEditor('A', 'B');
    editor.setActiveLayer('layer-1');
    const next = createDocument(5, 5);
    for (const name of ['X', 'Y']) {
      next.layers.push(createRasterLayer({ id: createLayerId(next), name, width: 1, height: 1 }));
    }
    editor.replaceDocument(next);
    expect(activeName(editor)).toBe('Y');
    expect(changes.at(-1)).toMatchObject({ documentReplaced: true, activeLayerChanged: true });
  });

  it('is null while the document has no layers, and the top layer once it has', () => {
    const doc = createDocument(4, 4);
    const editor = new Editor(doc);
    const layer = createRasterLayer({ id: createLayerId(doc), name: 'A', width: 1, height: 1 });
    editor.history.execute(new AddLayerCommand(layer));
    expect(editor.activeLayerId).toBe(layer.id);
    editor.history.undo();
    expect(editor.activeLayerId).toBeNull();
  });
});

describe('Editor floating selection', () => {
  /** Layers A and B (layer-1, layer-2), with part of B lifted into layer-3. */
  function floating() {
    const setup = stackEditor('A', 'B');
    setup.doc.selection = Selection.fromRect(10, 10, { x: 0, y: 0, width: 2, height: 4 });
    const lift = liftSelectionCommand(setup.doc, 'layer-2');
    if (!lift) throw new Error('Nothing to lift');
    setup.editor.history.execute(lift);
    return setup;
  }

  it('starts with a lift, and keeps the floating layer active', () => {
    const { editor, changes } = floating();
    expect(editor.floating).toMatchObject({ layerId: 'layer-3', sourceId: 'layer-2' });
    expect(editor.activeLayerId).toBe('layer-3');
    expect(changes.at(-1)).toMatchObject({ floatingChanged: true, activeLayerChanged: true });
  });

  it('ends with a commit, which leaves the source layer active', () => {
    const { editor, doc, changes } = floating();
    expect(editor.commitFloating()).toBe(true);
    expect(editor.floating).toBeNull();
    expect(editor.activeLayerId).toBe('layer-2');
    expect(doc.layers.map((l) => l.id)).toEqual(['layer-1', 'layer-2']);
    expect(changes.at(-1)).toMatchObject({ floatingChanged: true, activeLayerChanged: true });
    expect(editor.commitFloating()).toBe(false);
  });

  it('comes and goes with undo and redo', () => {
    const { editor } = floating();
    const record = editor.floating;
    editor.commitFloating();

    editor.history.undo();
    expect(editor.floating).toBe(record);
    expect(editor.activeLayerId).toBe('layer-3');
    editor.history.undo();
    expect(editor.floating).toBeNull();
    expect(editor.activeLayerId).toBe('layer-2');
    editor.history.redo();
    expect(editor.floating).toBe(record);
    expect(editor.activeLayerId).toBe('layer-3');
    editor.history.redo();
    expect(editor.floating).toBeNull();
  });

  it('is committed before another layer becomes active', () => {
    const { editor } = floating();
    editor.setActiveLayer('layer-3');
    expect(editor.floating).not.toBeNull();
    expect(() => editor.setActiveLayer('missing')).toThrow();
    expect(editor.floating).not.toBeNull();

    editor.setActiveLayer('layer-1');
    expect(editor.floating).toBeNull();
    expect(editor.activeLayerId).toBe('layer-1');
    expect(editor.history.undoLabel).toBe('Commit Floating Selection');
  });

  it('is dropped when the document is replaced', () => {
    const { editor, changes } = floating();
    editor.replaceDocument(createDocument(5, 5));
    expect(editor.floating).toBeNull();
    expect(changes.at(-1)).toMatchObject({ documentReplaced: true, floatingChanged: true });
  });

  it('is dropped if its layer stops being directly above its source', () => {
    const { editor, doc } = floating();
    const flatten = flattenCommand(doc);
    if (!flatten) throw new Error('Nothing to flatten');
    editor.history.execute(flatten);
    expect(editor.floating).toBeNull();
    expect(editor.activeLayerId).toBe('layer-1');
  });
});
