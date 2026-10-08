import { describe, expect, it } from 'vitest';
import type { ImageDocument } from '../document';
import { createDocument, createLayerId } from '../document';
import { Editor } from '../editor';
import type { RasterLayer } from '../layer';
import { createRasterLayer } from '../layer';
import { Selection } from '../selection';
import { MoveLayerCommand, moveLayerCommand } from './move-commands';

/** A 10×10 document with one 4×4 layer at (1, 2). */
function setup(): { doc: ImageDocument; layer: RasterLayer; editor: Editor } {
  const doc = createDocument(10, 10);
  const layer = createRasterLayer({ id: createLayerId(doc), name: 'L', width: 4, height: 4 });
  layer.x = 1;
  layer.y = 2;
  doc.layers.push(layer);
  return { doc, layer, editor: new Editor(doc) };
}

describe('MoveLayerCommand', () => {
  it('moves the layer and moves it back on undo', () => {
    const { layer, editor } = setup();
    const pixels = layer.pixels;
    editor.history.execute(new MoveLayerCommand(layer.id, 5, -1));
    expect([layer.x, layer.y]).toEqual([5, -1]);
    expect(layer.pixels).toBe(pixels);
    expect(editor.history.undoLabel).toBe('Move Layer');
    expect(editor.isDirty).toBe(true);

    editor.history.undo();
    expect([layer.x, layer.y]).toEqual([1, 2]);
    expect(editor.isDirty).toBe(false);
    editor.history.redo();
    expect([layer.x, layer.y]).toEqual([5, -1]);
  });

  it('dirties the old and new bounds on the canvas, and no layer pixels', () => {
    const { doc, layer } = setup();
    const command = new MoveLayerCommand(layer.id, 4, 3);
    // Old (1, 2, 4×4) ∪ new (4, 3, 4×4) = (1, 2) to (8, 7).
    const change = command.apply(doc);
    expect(change).toEqual({ dirty: { x: 1, y: 2, width: 7, height: 5 } });
    expect(command.revert(doc)).toEqual({ dirty: { x: 1, y: 2, width: 7, height: 5 } });
  });

  it('allows positions off the canvas', () => {
    const { doc, layer } = setup();
    const change = new MoveLayerCommand(layer.id, -20, 30).apply(doc);
    expect([layer.x, layer.y]).toEqual([-20, 30]);
    // The rect around (1, 2, 4×4) and (-20, 30, 4×4), clipped to the canvas.
    expect(change.dirty).toEqual({ x: 0, y: 2, width: 5, height: 8 });
    expect(new MoveLayerCommand(layer.id, 50, 50).apply(doc).dirty).toBeNull();
  });

  it('merges a gesture into one undo step', () => {
    const { layer, editor } = setup();
    for (const x of [2, 3, 4, 6]) {
      editor.history.execute(new MoveLayerCommand(layer.id, x, 2, { mergeKey: 'drag-1' }));
    }
    expect(layer.x).toBe(6);
    editor.history.undo();
    expect(layer.x).toBe(1);
    expect(editor.history.canUndo).toBe(false);
    editor.history.redo();
    expect(layer.x).toBe(6);
  });

  it("doesn't merge moves of different layers or gestures", () => {
    const { doc, layer, editor } = setup();
    const other = createRasterLayer({ id: createLayerId(doc), name: 'M', width: 2, height: 2 });
    editor.history.execute(new MoveLayerCommand(layer.id, 2, 2, { mergeKey: 'a' }));
    expect(
      new MoveLayerCommand(layer.id, 3, 2).mergeWith(new MoveLayerCommand(other.id, 1, 1)),
    ).toBe(false);
    editor.history.execute(new MoveLayerCommand(layer.id, 3, 2, { mergeKey: 'b' }));
    editor.history.undo();
    expect(layer.x).toBe(2);
  });

  it('uses the given label', () => {
    const { layer, editor } = setup();
    editor.history.execute(new MoveLayerCommand(layer.id, 2, 2, { label: 'Nudge' }));
    expect(editor.history.undoLabel).toBe('Nudge');
  });

  it('moves the selection in the same step when given one', () => {
    const { doc, layer, editor } = setup();
    const before = Selection.fromRect(10, 10, { x: 1, y: 2, width: 4, height: 4 });
    doc.selection = before;
    const after = before.translate(3, 0);
    const command = new MoveLayerCommand(layer.id, 4, 2, { selection: after });
    const change = command.apply(doc);
    expect(doc.selection).toBe(after);
    expect(change.selectionDirty).toEqual({ x: 1, y: 2, width: 7, height: 4 });
    command.revert(doc);
    expect(doc.selection).toBe(before);

    editor.history.execute(new MoveLayerCommand(layer.id, 4, 2, { selection: null }));
    expect(doc.selection).toBeNull();
    editor.history.undo();
    expect(doc.selection).toBe(before);
  });

  it('keeps the last selection of a merged gesture', () => {
    const { doc, layer, editor } = setup();
    const start = Selection.fromRect(10, 10, { x: 1, y: 2, width: 4, height: 4 });
    doc.selection = start;
    for (const dx of [1, 2]) {
      const selection = start.translate(dx, 0);
      editor.history.execute(
        new MoveLayerCommand(layer.id, 1 + dx, 2, { mergeKey: 'm', selection }),
      );
    }
    const end = doc.selection;
    expect(end?.bounds()).toEqual({ x: 3, y: 2, width: 4, height: 4 });
    editor.history.undo();
    expect(doc.selection).toBe(start);
    editor.history.redo();
    expect(doc.selection).toBe(end);
  });

  it('leaves the selection alone when not given one', () => {
    const { doc, layer } = setup();
    const selection = Selection.selectAll(10, 10);
    doc.selection = selection;
    const change = new MoveLayerCommand(layer.id, 0, 0).apply(doc);
    expect(doc.selection).toBe(selection);
    expect(change.selectionDirty).toBeUndefined();
  });

  it('stores an empty selection as none', () => {
    const { doc, layer } = setup();
    doc.selection = Selection.selectAll(10, 10);
    new MoveLayerCommand(layer.id, 0, 0, { selection: Selection.empty(10, 10) }).apply(doc);
    expect(doc.selection).toBeNull();
  });

  it('rejects fractional positions and selections of the wrong size', () => {
    const { doc, layer } = setup();
    expect(() => new MoveLayerCommand(layer.id, 0.5, 0)).toThrow(RangeError);
    const wrong = new MoveLayerCommand(layer.id, 0, 0, { selection: Selection.selectAll(5, 5) });
    expect(() => wrong.apply(doc)).toThrow(/5x5/);
    expect([layer.x, layer.y]).toEqual([1, 2]);
  });
});

describe('moveLayerCommand', () => {
  it('is null for a missing layer or no change', () => {
    const { doc, layer } = setup();
    expect(moveLayerCommand(doc, 'nope', 0, 0)).toBeNull();
    expect(moveLayerCommand(doc, layer.id, 1, 2)).toBeNull();
    expect(moveLayerCommand(doc, layer.id, 1, 2, { selection: null })).toBeNull();
    expect(moveLayerCommand(doc, layer.id, 1, 3)).toBeInstanceOf(MoveLayerCommand);
  });

  it('compares selections by coverage', () => {
    const { doc, layer } = setup();
    doc.selection = Selection.fromRect(10, 10, { x: 0, y: 0, width: 2, height: 2 });
    const same = Selection.fromRect(10, 10, { x: 0, y: 0, width: 2, height: 2 });
    expect(moveLayerCommand(doc, layer.id, 1, 2, { selection: same })).toBeNull();
    expect(
      moveLayerCommand(doc, layer.id, 1, 2, { selection: same.translate(1, 0) }),
    ).not.toBeNull();
    expect(moveLayerCommand(doc, layer.id, 1, 2, { selection: null })).not.toBeNull();
  });
});
