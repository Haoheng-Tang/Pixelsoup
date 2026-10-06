import { describe, expect, it } from 'vitest';
import { createBlankDocument } from './blank-document';
import { SetLayerOpacityCommand, SetLayerVisibilityCommand } from './commands/layer-commands';
import { createDocument } from './document';
import type { EditorChange } from './editor';
import { Editor } from './editor';

function setup() {
  const editor = new Editor(createBlankDocument({ width: 20, height: 10, background: 'white' }));
  const changes: EditorChange[] = [];
  editor.subscribe((change) => changes.push(change));
  const layerId = editor.document.layers[0]?.id ?? '';
  return { editor, changes, layerId };
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
