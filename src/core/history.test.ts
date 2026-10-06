import { describe, expect, it } from 'vitest';
import { SetLayerOpacityCommand, SetLayerVisibilityCommand } from './commands/layer-commands';
import { createDocument, createLayerId } from './document';
import { Editor } from './editor';
import type { DocumentChange } from './history/command';
import { LinearHistory } from './history/history';
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

describe('History state IDs', () => {
  function history(limit = 200) {
    const doc = createDocument(10, 10);
    const layer = createRasterLayer({ id: createLayerId(doc), name: 'A', width: 1, height: 1 });
    doc.layers.push(layer);
    return { layer, history: new LinearHistory(doc, () => {}, limit) };
  }

  it('moves to a new ID on execute and returns to recorded IDs on undo and redo', () => {
    const { layer, history: h } = history();
    const initial = h.stateId;
    h.execute(new SetLayerOpacityCommand(layer.id, 0.5));
    const afterFirst = h.stateId;
    h.execute(new SetLayerOpacityCommand(layer.id, 0.25));
    const afterSecond = h.stateId;
    expect(new Set([initial, afterFirst, afterSecond]).size).toBe(3);

    h.undo();
    expect(h.stateId).toBe(afterFirst);
    h.undo();
    expect(h.stateId).toBe(initial);
    h.redo();
    h.redo();
    expect(h.stateId).toBe(afterSecond);
  });

  it('gives a merged step a new ID, so a save point taken mid-gesture goes stale', () => {
    const { layer, history: h } = history();
    const initial = h.stateId;
    h.execute(new SetLayerOpacityCommand(layer.id, 0.9, 'drag'));
    const midGesture = h.stateId;
    h.execute(new SetLayerOpacityCommand(layer.id, 0.5, 'drag'));
    expect(h.stateId).not.toBe(midGesture);
    const merged = h.stateId;

    h.undo();
    expect(h.stateId).toBe(initial);
    h.redo();
    expect(h.stateId).toBe(merged);
  });

  it('never reuses the ID of a discarded redo branch', () => {
    const { layer, history: h } = history();
    h.execute(new SetLayerOpacityCommand(layer.id, 0.5));
    const discarded = h.stateId;
    h.undo();
    h.execute(new SetLayerOpacityCommand(layer.id, 0.5));
    expect(h.stateId).not.toBe(discarded);
  });

  it('can still reach an old state after its step falls off the bottom of the stack', () => {
    const { layer, history: h } = history(2);
    h.execute(new SetLayerOpacityCommand(layer.id, 0.1));
    const saved = h.stateId;
    h.execute(new SetLayerOpacityCommand(layer.id, 0.2));
    h.execute(new SetLayerOpacityCommand(layer.id, 0.3)); // drops the 0.1 step
    h.undo();
    h.undo();
    expect(h.canUndo).toBe(false);
    expect(layer.opacity).toBe(0.1);
    expect(h.stateId).toBe(saved);
  });

  it('keeps the current ID when cleared', () => {
    const { layer, history: h } = history();
    h.execute(new SetLayerOpacityCommand(layer.id, 0.5));
    const id = h.stateId;
    h.clear();
    expect(h.stateId).toBe(id);
  });
});
