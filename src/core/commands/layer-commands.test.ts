import { describe, expect, it } from 'vitest';
import { createDocument, createLayerId } from '../document';
import { Editor } from '../editor';
import type { RasterLayer } from '../layer';
import { createRasterLayer } from '../layer';
import { AddLayerCommand } from './layer-commands';

function layer(doc: ReturnType<typeof createDocument>, x = 0, y = 0): RasterLayer {
  return createRasterLayer({ id: createLayerId(doc), name: 'L', width: 4, height: 4, x, y });
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
});
