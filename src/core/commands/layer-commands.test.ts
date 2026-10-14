import { describe, expect, it } from 'vitest';
import type { ImageDocument } from '../document';
import { createDocument, createLayerId } from '../document';
import { Editor } from '../editor';
import type { RasterLayer } from '../layer';
import { createRasterLayer } from '../layer';
import { getPixel, setPixel } from '../pixel-buffer';
import {
  AddLayerCommand,
  DuplicateLayerCommand,
  duplicateLayerCommand,
  duplicateName,
  indexAbove,
  newLayerCommand,
  nextLayerName,
  RemoveLayerCommand,
  removeLayerCommand,
  RenameLayerCommand,
  renameLayerCommand,
  ReorderLayerCommand,
  reorderLayerCommand,
} from './layer-commands';

function layer(doc: ReturnType<typeof createDocument>, x = 0, y = 0): RasterLayer {
  return createRasterLayer({ id: createLayerId(doc), name: 'L', width: 4, height: 4, x, y });
}

/** A 10×10 document holding a 4×4 layer at (0, 0) per name, bottom first, IDs layer-1… */
function docWith(...names: string[]): ImageDocument {
  const doc = createDocument(10, 10);
  for (const name of names) {
    doc.layers.push(createRasterLayer({ id: createLayerId(doc), name, width: 4, height: 4 }));
  }
  return doc;
}

function names(doc: ImageDocument): string[] {
  return doc.layers.map((l) => l.name);
}

describe('AddLayerCommand', () => {
  it('adds the layer on top, and removes it again on undo', () => {
    const doc = createDocument(10, 10);
    const bottom = layer(doc);
    doc.layers.push(bottom);
    const editor = new Editor(doc);
    const added = layer(doc);

    editor.history.execute(new AddLayerCommand(added, 'Import Image'));
    expect(doc.layers).toEqual([bottom, added]);
    expect(editor.history.undoLabel).toBe('Import Image');

    editor.history.undo();
    expect(doc.layers).toEqual([bottom]);
    editor.history.redo();
    expect(doc.layers).toEqual([bottom, added]);
  });

  it('reports the part of the layer on the canvas as dirty', () => {
    const doc = createDocument(10, 10);
    const change = new AddLayerCommand(layer(doc, 8, -2)).apply(doc);
    expect(change.dirty).toEqual({ x: 8, y: 0, width: 2, height: 2 });
    expect(new AddLayerCommand(layer(doc, 20, 0)).apply(doc).dirty).toBeNull();
  });

  it('refuses a layer whose ID is already in the document', () => {
    const doc = createDocument(10, 10);
    const first = layer(doc);
    doc.layers.push(first);
    const clash = createRasterLayer({ id: first.id, name: 'Clash', width: 1, height: 1 });
    expect(() => new AddLayerCommand(clash).apply(doc)).toThrow(/Duplicate layer ID/);
    expect(doc.layers).toEqual([first]);
  });

  it('inserts at a given stack index', () => {
    const doc = docWith('A', 'B');
    const editor = new Editor(doc);
    const added = createRasterLayer({ id: createLayerId(doc), name: 'X', width: 1, height: 1 });

    editor.history.execute(new AddLayerCommand(added, 'Add Layer', 1));
    expect(names(doc)).toEqual(['A', 'X', 'B']);
    editor.history.undo();
    expect(names(doc)).toEqual(['A', 'B']);
  });

  it('refuses an index outside the stack', () => {
    const doc = docWith('A');
    for (const index of [-1, 2, 0.5]) {
      const added = createRasterLayer({ id: createLayerId(doc), name: 'X', width: 1, height: 1 });
      expect(() => new AddLayerCommand(added, 'Add Layer', index).apply(doc)).toThrow(RangeError);
    }
    expect(names(doc)).toEqual(['A']);
  });
});

describe('newLayerCommand', () => {
  it('adds a transparent canvas-sized layer directly above the given layer', () => {
    const doc = docWith('Background', 'Layer 1', 'Layer 3');
    const command = newLayerCommand(doc, 'layer-1');
    const change = command.apply(doc);

    expect(command.label).toBe('New Layer');
    expect(names(doc)).toEqual(['Background', 'Layer 4', 'Layer 1', 'Layer 3']);
    const added = doc.layers[1];
    expect(added).toMatchObject({ id: 'layer-4', x: 0, y: 0, opacity: 1, visible: true });
    expect([added.pixels.width, added.pixels.height]).toEqual([10, 10]);
    expect(added.pixels.data.every((v) => v === 0)).toBe(true);
    expect(change.dirty).toEqual({ x: 0, y: 0, width: 10, height: 10 });
  });

  it('goes on top when there is no layer to go above', () => {
    const doc = docWith('Background');
    newLayerCommand(doc, null).apply(doc);
    newLayerCommand(doc, 'no-such-layer').apply(doc);
    expect(names(doc)).toEqual(['Background', 'Layer 1', 'Layer 2']);
  });

  it('finds the index above a layer', () => {
    const doc = docWith('A', 'B');
    expect(indexAbove(doc, 'layer-1')).toBe(1);
    expect(indexAbove(doc, 'layer-2')).toBe(2);
    expect(indexAbove(doc, null)).toBe(2);
  });
});

describe('RemoveLayerCommand', () => {
  it('removes a layer, and puts the same layer back where it was on undo', () => {
    const doc = docWith('A', 'B', 'C');
    const editor = new Editor(doc);
    const b = doc.layers[1];

    editor.history.execute(removeLayerCommand(doc, 'layer-2')!);
    expect(names(doc)).toEqual(['A', 'C']);
    expect(editor.history.undoLabel).toBe('Delete Layer');

    editor.history.undo();
    expect(names(doc)).toEqual(['A', 'B', 'C']);
    expect(doc.layers[1]).toBe(b);
    editor.history.redo();
    expect(names(doc)).toEqual(['A', 'C']);
  });

  it("reports the removed layer's part of the canvas as dirty", () => {
    const doc = docWith('A');
    doc.layers.push(layer(doc, 8, -2));
    expect(new RemoveLayerCommand('layer-2').apply(doc).dirty).toEqual({
      x: 8,
      y: 0,
      width: 2,
      height: 2,
    });
  });

  it('keeps the last layer', () => {
    const doc = docWith('Only');
    expect(removeLayerCommand(doc, 'layer-1')).toBeNull();
    expect(() => new RemoveLayerCommand('layer-1').apply(doc)).toThrow(/at least one layer/);
    expect(names(doc)).toEqual(['Only']);
  });

  it('is null for a layer that is not in the document', () => {
    expect(removeLayerCommand(docWith('A', 'B'), 'layer-9')).toBeNull();
  });
});

describe('DuplicateLayerCommand', () => {
  it('copies the layer, pixels and properties, directly above itself', () => {
    const doc = docWith('A', 'B');
    const a = doc.layers[0];
    Object.assign(a, { x: 7, y: -1, opacity: 0.5, visible: false });
    setPixel(a.pixels, 1, 2, [10, 20, 30, 40]);

    const command = duplicateLayerCommand(doc, 'layer-1')!;
    const change = command.apply(doc);

    expect(command.label).toBe('Duplicate Layer');
    expect(names(doc)).toEqual(['A', 'A copy', 'B']);
    const copy = doc.layers[1];
    expect(copy).toMatchObject({ id: 'layer-3', x: 7, y: -1, opacity: 0.5, visible: false });
    expect(copy.blendMode).toBe(a.blendMode);
    expect(copy.pixels.data).toEqual(a.pixels.data);
    expect(change.dirty).toEqual({ x: 7, y: 0, width: 3, height: 3 });

    // The copy owns its pixels.
    setPixel(copy.pixels, 1, 2, [0, 0, 0, 0]);
    expect(getPixel(a.pixels, 1, 2)).toEqual([10, 20, 30, 40]);
  });

  it('removes the copy on undo and puts the same copy back on redo', () => {
    const doc = docWith('A');
    const editor = new Editor(doc);
    editor.history.execute(duplicateLayerCommand(doc, 'layer-1')!);
    const copy = doc.layers[1];

    editor.history.undo();
    expect(names(doc)).toEqual(['A']);
    editor.history.redo();
    expect(doc.layers[1]).toBe(copy);
  });

  it('gives every copy its own ID', () => {
    const doc = docWith('A');
    duplicateLayerCommand(doc, 'layer-1')!.apply(doc);
    duplicateLayerCommand(doc, 'layer-2')!.apply(doc);
    expect(names(doc)).toEqual(['A', 'A copy', 'A copy copy']);
    expect(new Set(doc.layers.map((l) => l.id)).size).toBe(3);
  });

  it('is null for a layer that is not in the document', () => {
    expect(duplicateLayerCommand(docWith('A'), 'layer-9')).toBeNull();
  });

  it('names the copy as asked, trimmed, and refuses a blank name', () => {
    const doc = docWith('A', 'B');
    duplicateLayerCommand(doc, 'layer-1', '  Shadow  ')!.apply(doc);
    expect(names(doc)).toEqual(['A', 'Shadow', 'B']);
    expect(duplicateLayerCommand(doc, 'layer-1', '')).toBeNull();
    expect(duplicateLayerCommand(doc, 'layer-1', ' \t ')).toBeNull();
    expect(() => new DuplicateLayerCommand('layer-1', 'layer-9', ' ')).toThrow(RangeError);
    expect(duplicateName('Sky')).toBe('Sky copy');
  });
});

describe('nextLayerName', () => {
  it('is one past the highest "Layer N" in use', () => {
    expect(nextLayerName(docWith('Background'))).toBe('Layer 1');
    expect(nextLayerName(docWith('Layer 2', 'Layer 7 copy', 'Layer 5'))).toBe('Layer 6');
  });
});

describe('ReorderLayerCommand', () => {
  it('moves a layer up or down the stack, and back on undo', () => {
    const doc = docWith('A', 'B', 'C', 'D');
    const editor = new Editor(doc);

    editor.history.execute(reorderLayerCommand(doc, 'layer-1', 2)!);
    expect(names(doc)).toEqual(['B', 'C', 'A', 'D']);
    expect(editor.history.undoLabel).toBe('Reorder Layer');
    editor.history.undo();
    expect(names(doc)).toEqual(['A', 'B', 'C', 'D']);

    editor.history.execute(reorderLayerCommand(doc, 'layer-4', 0)!);
    expect(names(doc)).toEqual(['D', 'A', 'B', 'C']);
    editor.history.undo();
    expect(names(doc)).toEqual(['A', 'B', 'C', 'D']);
    editor.history.redo();
    expect(names(doc)).toEqual(['D', 'A', 'B', 'C']);
  });

  it("reports the moved layer's part of the canvas as dirty", () => {
    const doc = docWith('A');
    doc.layers.push(layer(doc, 8, -2));
    expect(new ReorderLayerCommand('layer-2', 0).apply(doc).dirty).toEqual({
      x: 8,
      y: 0,
      width: 2,
      height: 2,
    });
  });

  it('is null when the layer would not move', () => {
    const doc = docWith('A', 'B', 'C');
    expect(reorderLayerCommand(doc, 'layer-2', 1)).toBeNull();
    for (const index of [-1, 3, 1.5]) expect(reorderLayerCommand(doc, 'layer-2', index)).toBeNull();
    expect(reorderLayerCommand(doc, 'layer-9', 0)).toBeNull();
    expect(() => new ReorderLayerCommand('layer-2', 3).apply(doc)).toThrow(RangeError);
  });
});

describe('RenameLayerCommand', () => {
  it('renames a layer, and restores the old name on undo', () => {
    const doc = docWith('A');
    const editor = new Editor(doc);
    const changes: unknown[] = [];
    editor.subscribe((change) => changes.push(change.dirty));

    editor.history.execute(renameLayerCommand(doc, 'layer-1', 'Sky')!);
    expect(names(doc)).toEqual(['Sky']);
    expect(editor.history.undoLabel).toBe('Rename Layer');
    expect(editor.isDirty).toBe(true);
    editor.history.undo();
    expect(names(doc)).toEqual(['A']);
    expect(changes).toEqual([null, null]);
  });

  it('is null for a blank or unchanged name, or a missing layer', () => {
    const doc = docWith('A');
    expect(renameLayerCommand(doc, 'layer-1', 'A')).toBeNull();
    expect(renameLayerCommand(doc, 'layer-1', '')).toBeNull();
    expect(renameLayerCommand(doc, 'layer-1', '  ')).toBeNull();
    expect(renameLayerCommand(doc, 'layer-9', 'B')).toBeNull();
    expect(() => new RenameLayerCommand('layer-1', ' ')).toThrow(/empty/);
  });
});
