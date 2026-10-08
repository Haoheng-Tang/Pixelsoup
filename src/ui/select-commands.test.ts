import { describe, expect, it } from 'vitest';
import {
  createDocument,
  createLayerId,
  createRasterLayer,
  Editor,
  liftSelectionCommand,
  Selection,
  SetSelectionCommand,
} from '../core';
import type { SelectCommand } from './select-commands';
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

  it('commits a floating selection first', () => {
    for (const command of ['select-all', 'deselect', 'inverse'] satisfies SelectCommand[]) {
      const doc = createDocument(4, 4);
      doc.layers.push(
        createRasterLayer({ id: createLayerId(doc), name: 'A', width: 4, height: 4 }),
      );
      const editor = new Editor(doc);
      const area = { x: 0, y: 0, width: 2, height: 2 };
      editor.history.execute(new SetSelectionCommand(Selection.fromRect(4, 4, area)));
      const lift = liftSelectionCommand(doc, 'layer-1');
      if (!lift) throw new Error('Nothing to lift');
      editor.history.execute(lift);

      runSelectCommand(editor, command);
      expect(editor.floating).toBeNull();
      expect(doc.layers).toHaveLength(1);
      editor.history.undo();
      expect(editor.history.undoLabel).toBe('Commit Floating Selection');
    }
  });
});
