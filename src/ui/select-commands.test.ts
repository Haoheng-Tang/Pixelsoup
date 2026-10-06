import { describe, expect, it } from 'vitest';
import { createDocument, Editor, Selection, SetSelectionCommand } from '../core';
import { runSelectCommand } from './select-commands';

describe('runSelectCommand', () => {
  it('selects all, inverts and deselects as undoable steps', () => {
    const editor = new Editor(createDocument(4, 4));
    const doc = editor.document;
    editor.history.execute(
      new SetSelectionCommand(Selection.fromRect(4, 4, { x: 0, y: 0, width: 4, height: 1 })),
    );

    runSelectCommand(editor, 'inverse');
    expect(doc.selection?.bounds()).toEqual({ x: 0, y: 1, width: 4, height: 3 });
    runSelectCommand(editor, 'select-all');
    expect(doc.selection?.bounds()).toEqual({ x: 0, y: 0, width: 4, height: 4 });
    runSelectCommand(editor, 'deselect');
    expect(doc.selection).toBeNull();

    expect(editor.history.undoLabel).toBe('Deselect');
    editor.history.undo();
    expect(editor.history.undoLabel).toBe('Select All');
    expect(doc.selection?.bounds()).toEqual({ x: 0, y: 0, width: 4, height: 4 });
  });

  it('records nothing when the command would not change the selection', () => {
    const editor = new Editor(createDocument(4, 4));
    runSelectCommand(editor, 'deselect');
    runSelectCommand(editor, 'inverse');
    expect(editor.history.canUndo).toBe(false);
    runSelectCommand(editor, 'select-all');
    runSelectCommand(editor, 'select-all');
    editor.history.undo();
    expect(editor.history.canUndo).toBe(false);
  });
});
