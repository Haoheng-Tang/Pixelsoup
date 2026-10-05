import { describe, expect, it } from 'vitest';
import { SetLayerOpacityCommand, SetLayerVisibilityCommand } from './commands/layer-commands';
import { createDocument, createLayerId } from './document';
import { Editor } from './editor';
import type { DocumentChange } from './history/command';
import { createRasterLayer } from './layer';

function setup() {
  const doc = createDocument(100, 80);
  const layer = createRasterLayer({
    id: createLayerId(doc),
    name: 'A',
    width: 50,
    height: 50,
    x: 70,
    y: -10,
  });
  doc.layers.push(layer);
  const editor = new Editor(doc);
  const changes: DocumentChange[] = [];
  editor.subscribe((change) => changes.push(change));
  return { doc, layer, editor, changes };
}

describe('History', () => {
  it('executes, undoes and redoes commands', () => {
    const { layer, editor } = setup();
    editor.history.execute(new SetLayerVisibilityCommand(layer.id, false));
    expect(layer.visible).toBe(false);
    expect(editor.history.undoLabel).toBe('Hide Layer');

    expect(editor.history.undo()).toBe(true);
    expect(layer.visible).toBe(true);
    expect(editor.history.canUndo).toBe(false);
    expect(editor.history.canRedo).toBe(true);

    expect(editor.history.redo()).toBe(true);
    expect(layer.visible).toBe(false);
    expect(editor.history.undo()).toBe(true);
    expect(editor.history.undo()).toBe(false);
  });

  it('clears the redo stack when a new command runs', () => {
    const { layer, editor } = setup();
    editor.history.execute(new SetLayerOpacityCommand(layer.id, 0.5));
    editor.history.undo();
    editor.history.execute(new SetLayerOpacityCommand(layer.id, 0.25));
    expect(editor.history.canRedo).toBe(false);
    expect(layer.opacity).toBe(0.25);
  });

  it('merges commands that share a merge key into one undo step', () => {
    const { layer, editor } = setup();
    editor.history.execute(new SetLayerOpacityCommand(layer.id, 0.9, 'drag-1'));
    editor.history.execute(new SetLayerOpacityCommand(layer.id, 0.6, 'drag-1'));
    editor.history.execute(new SetLayerOpacityCommand(layer.id, 0.3, 'drag-1'));
    editor.history.execute(new SetLayerOpacityCommand(layer.id, 0.1, 'drag-2'));
    expect(layer.opacity).toBe(0.1);

    editor.history.undo();
    expect(layer.opacity).toBe(0.3);
    editor.history.undo();
    expect(layer.opacity).toBe(1);
    expect(editor.history.canUndo).toBe(false);

    editor.history.redo();
    expect(layer.opacity).toBe(0.3);
  });

  it('clamps opacity to 0–1', () => {
    const { layer, editor } = setup();
    editor.history.execute(new SetLayerOpacityCommand(layer.id, 3));
    expect(layer.opacity).toBe(1);
    editor.history.execute(new SetLayerOpacityCommand(layer.id, -1));
    expect(layer.opacity).toBe(0);
  });

  it('notifies subscribers with the layer bounds clipped to the canvas', () => {
    const { layer, editor, changes } = setup();
    const revision = editor.revision;
    editor.history.execute(new SetLayerVisibilityCommand(layer.id, false));
    editor.history.undo();
    expect(editor.revision).toBe(revision + 2);
    expect(changes).toEqual([
      { dirty: { x: 70, y: 0, width: 30, height: 40 } },
      { dirty: { x: 70, y: 0, width: 30, height: 40 } },
    ]);
  });
});
