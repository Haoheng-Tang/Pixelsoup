import { describe, expect, it } from 'vitest';
import { createBlankDocument } from '../blank-document';
import { Editor } from '../editor';
import type { EditorChange } from '../editor';
import { Selection } from '../selection';
import { SetLayerOpacityCommand } from './layer-commands';
import {
  deselectCommand,
  invertSelectionCommand,
  SetSelectionCommand,
  selectAllCommand,
} from './selection-commands';

function setup() {
  const editor = new Editor(createBlankDocument({ width: 10, height: 8, background: 'white' }));
  const changes: EditorChange[] = [];
  editor.subscribe((change) => changes.push(change));
  return { editor, doc: editor.document, changes };
}

const rect = (x: number, y: number, width: number, height: number) =>
  Selection.fromRect(10, 8, { x, y, width, height });

describe('SetSelectionCommand', () => {
  it('sets the selection and restores the previous one on undo', () => {
    const { editor, doc } = setup();
    const first = rect(1, 1, 2, 2);
    const second = rect(5, 4, 3, 3);
    editor.history.execute(new SetSelectionCommand(first));
    editor.history.execute(new SetSelectionCommand(second));
    expect(doc.selection).toBe(second);

    editor.history.undo();
    expect(doc.selection).toBe(first);
    editor.history.undo();
    expect(doc.selection).toBeNull();
    editor.history.redo();
    editor.history.redo();
    expect(doc.selection).toBe(second);
  });

  it('reports the old and new bounds as selectionDirty, with no composite change', () => {
    const { editor, changes } = setup();
    editor.history.execute(new SetSelectionCommand(rect(1, 1, 2, 2)));
    expect(changes.at(-1)).toEqual({
      dirty: null,
      selectionDirty: { x: 1, y: 1, width: 2, height: 2 },
    });
    editor.history.execute(new SetSelectionCommand(rect(5, 4, 3, 3)));
    expect(changes.at(-1)).toEqual({
      dirty: null,
      selectionDirty: { x: 1, y: 1, width: 7, height: 6 },
    });
    editor.history.undo();
    expect(changes.at(-1)?.selectionDirty).toEqual({ x: 1, y: 1, width: 7, height: 6 });
  });

  it('stores an empty selection as null', () => {
    const { editor, doc } = setup();
    editor.history.execute(new SetSelectionCommand(rect(1, 1, 2, 2)));
    editor.history.execute(new SetSelectionCommand(Selection.empty(10, 8)));
    expect(doc.selection).toBeNull();
  });

  it('rejects a selection of the wrong size', () => {
    const { editor } = setup();
    const wrong = Selection.selectAll(8, 10);
    expect(() => editor.history.execute(new SetSelectionCommand(wrong))).toThrow(RangeError);
  });

  it('merges updates that share a mergeKey into one undo step', () => {
    const { editor, doc } = setup();
    const before = rect(0, 0, 1, 1);
    editor.history.execute(new SetSelectionCommand(before));
    editor.history.execute(new SetSelectionCommand(rect(1, 1, 2, 2), 'Drag', 'drag-1'));
    editor.history.execute(new SetSelectionCommand(rect(1, 1, 4, 4), 'Drag', 'drag-1'));
    const last = rect(1, 1, 6, 6);
    editor.history.execute(new SetSelectionCommand(last, 'Drag', 'drag-1'));
    expect(doc.selection).toBe(last);
    expect(editor.history.undoLabel).toBe('Drag');

    editor.history.undo();
    expect(doc.selection).toBe(before);
    editor.history.redo();
    expect(doc.selection).toBe(last);
    editor.history.undo();
    editor.history.undo();
    expect(doc.selection).toBeNull();
  });

  it('does not make the document unsaved, but content edits still do', () => {
    const { editor } = setup();
    const layerId = editor.document.layers[0]?.id ?? '';
    editor.history.execute(new SetSelectionCommand(rect(1, 1, 2, 2)));
    expect(editor.isDirty).toBe(false);
    expect(editor.history.canUndo).toBe(true);

    editor.history.execute(new SetLayerOpacityCommand(layerId, 0.5));
    expect(editor.isDirty).toBe(true);
    editor.history.execute(new SetSelectionCommand(null));
    editor.history.undo();
    expect(editor.isDirty).toBe(true);
    editor.history.undo();
    expect(editor.isDirty).toBe(false);
    editor.history.undo();
    expect(editor.isDirty).toBe(false);
  });
});

describe('selection command factories', () => {
  it('selectAllCommand selects the canvas unless it already is', () => {
    const { editor, doc } = setup();
    const command = selectAllCommand(doc);
    expect(command?.label).toBe('Select All');
    if (command) editor.history.execute(command);
    expect(doc.selection?.bounds()).toEqual({ x: 0, y: 0, width: 10, height: 8 });
    expect(selectAllCommand(doc)).toBeNull();
  });

  it('deselectCommand clears the selection, or is null without one', () => {
    const { editor, doc } = setup();
    expect(deselectCommand(doc)).toBeNull();
    editor.history.execute(new SetSelectionCommand(rect(1, 1, 2, 2)));
    const command = deselectCommand(doc);
    expect(command?.label).toBe('Deselect');
    if (command) editor.history.execute(command);
    expect(doc.selection).toBeNull();
  });

  it('invertSelectionCommand inverts the selection, or is null without one', () => {
    const { editor, doc } = setup();
    expect(invertSelectionCommand(doc)).toBeNull();
    editor.history.execute(new SetSelectionCommand(rect(0, 0, 10, 4)));
    const command = invertSelectionCommand(doc);
    expect(command?.label).toBe('Inverse Selection');
    if (command) editor.history.execute(command);
    expect(doc.selection?.bounds()).toEqual({ x: 0, y: 4, width: 10, height: 4 });
  });

  it('inverting a full selection deselects', () => {
    const { editor, doc } = setup();
    editor.history.execute(new SetSelectionCommand(Selection.selectAll(10, 8)));
    const command = invertSelectionCommand(doc);
    if (command) editor.history.execute(command);
    expect(doc.selection).toBeNull();
  });
});
