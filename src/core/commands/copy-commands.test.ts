import { describe, expect, it } from 'vitest';
import { createDocument, createLayerId } from '../document';
import { Editor } from '../editor';
import type { RasterLayer } from '../layer';
import { createRasterLayer } from '../layer';
import type { PixelBuffer, Rgba } from '../pixel-buffer';
import { createPixelBuffer } from '../pixel-buffer';
import { Selection } from '../selection';
import {
  LayerViaCopyCommand,
  LayerViaCutCommand,
  PasteCommand,
  layerViaCopyCommand,
  layerViaCutCommand,
  pasteCommand,
} from './copy-commands';

function bufferOf(width: number, height: number, pixels: readonly Rgba[]): PixelBuffer {
  const buffer = createPixelBuffer(width, height);
  pixels.forEach((pixel, i) => buffer.data.set(pixel, i * 4));
  return buffer;
}

function pixelsOf(buffer: PixelBuffer): number[][] {
  const pixels: number[][] = [];
  for (let i = 0; i < buffer.data.length; i += 4) pixels.push([...buffer.data.subarray(i, i + 4)]);
  return pixels;
}

const NONE = [0, 0, 0, 0];
const RED: Rgba = [255, 0, 0, 255];

// Full, zero and partial coverage; a transparent pixel; one too faint to take any of.
const SOURCE: Rgba[] = [
  [200, 100, 50, 255],
  [10, 20, 30, 255],
  [90, 80, 70, 255],
  [40, 50, 60, 200],
  [7, 7, 7, 0],
  [1, 2, 3, 1],
];
const COVERAGE = [255, 0, 128, 128, 255, 100];
const COPIED = [
  [200, 100, 50, 255], // all of it
  NONE, // not selected
  [90, 80, 70, 128], // 255 × 128/255 = 128
  [40, 50, 60, 100], // 200 × 128/255 = 100.4
  NONE, // nothing to copy
  NONE, // 1 × 100/255 = 0.39 rounds to 0
];
const LEFT = [
  NONE, // all cut
  [10, 20, 30, 255],
  [90, 80, 70, 127], // 255 − 128
  [40, 50, 60, 100], // 200 − 100 (= 200 × 127/255 = 99.6, rounded)
  [7, 7, 7, 0],
  [1, 2, 3, 1],
];
const ROW = { x: 0, y: 0, width: 6, height: 1 };

/**
 * An editor on a 6×1 document: "Background" (layer-1), the source "Photo" (layer-2,
 * active, at half opacity) and "Layer 3" (layer-3) on top, with the selection given.
 */
function setup(coverage: readonly number[] = COVERAGE) {
  const doc = createDocument(6, 1);
  doc.layers.push(createRasterLayer({ id: createLayerId(doc), name: 'Background', ...ROW }));
  const source = createRasterLayer({
    id: createLayerId(doc),
    name: 'Photo',
    opacity: 0.5,
    pixels: bufferOf(6, 1, SOURCE),
  });
  doc.layers.push(source);
  doc.layers.push(createRasterLayer({ id: createLayerId(doc), name: 'Layer 3', ...ROW }));
  doc.selection = Selection.fromMask(6, 1, coverage);
  const editor = new Editor(doc);
  editor.setActiveLayer(source.id);
  return { doc, source, editor, selection: doc.selection };
}

function names(layers: readonly RasterLayer[]): string[] {
  return layers.map((layer) => layer.name);
}

describe('LayerViaCopyCommand', () => {
  it('copies the selected pixels into "Layer N" directly above, weighted, and deselects', () => {
    const { doc, source } = setup();
    const command = layerViaCopyCommand(doc, source.id);
    expect(command).toBeInstanceOf(LayerViaCopyCommand);
    const change = command!.apply(doc);

    expect(command!.label).toBe('Layer via Copy');
    expect(names(doc.layers)).toEqual(['Background', 'Photo', 'Layer 4', 'Layer 3']);
    const copy = doc.layers[2];
    expect(copy).toMatchObject({ id: 'layer-4', x: 0, y: 0, opacity: 0.5, visible: true });
    expect(pixelsOf(copy.pixels)).toEqual(COPIED);
    expect(pixelsOf(source.pixels)).toEqual(SOURCE);
    expect(doc.selection).toBeNull();
    expect(change).toEqual({ dirty: ROW, selectionDirty: ROW });
  });

  it('is the size of the selection bounds, transparent where the source does not reach', () => {
    const doc = createDocument(4, 4);
    const source = createRasterLayer({
      id: createLayerId(doc),
      name: 'Dot',
      x: 1,
      y: 1,
      pixels: bufferOf(1, 1, [RED]),
    });
    doc.layers.push(source);
    doc.selection = Selection.fromRect(4, 4, { x: 0, y: 1, width: 3, height: 2 });

    layerViaCopyCommand(doc, source.id)!.apply(doc);
    const copy = doc.layers[1];
    expect(copy).toMatchObject({ name: 'Layer 1', x: 0, y: 1 });
    expect(copy.pixels).toMatchObject({ width: 3, height: 2 });
    expect(pixelsOf(copy.pixels)).toEqual([NONE, RED, NONE, NONE, NONE, NONE]);
  });

  it('removes the layer and brings the selection back on undo; redo restores both', () => {
    const { doc, source, editor, selection } = setup();
    editor.history.execute(layerViaCopyCommand(doc, source.id)!);
    const copy = doc.layers[2];

    editor.history.undo();
    expect(names(doc.layers)).toEqual(['Background', 'Photo', 'Layer 3']);
    expect(doc.selection).toBe(selection);
    expect(pixelsOf(source.pixels)).toEqual(SOURCE);
    expect(editor.history.undoLabel).toBeNull();

    editor.history.redo();
    expect(doc.layers[2]).toBe(copy);
    expect(pixelsOf(copy.pixels)).toEqual(COPIED);
    expect(doc.selection).toBeNull();
  });

  it('is null without a selection, for a missing or hidden layer, or a selection missing it', () => {
    const { doc, source } = setup();
    expect(layerViaCopyCommand(doc, 'layer-9')).toBeNull();
    source.visible = false;
    expect(layerViaCopyCommand(doc, source.id)).toBeNull();
    expect(layerViaCutCommand(doc, source.id)).toBeNull();
    source.visible = true;
    source.x = 6;
    expect(layerViaCopyCommand(doc, source.id)).toBeNull();
    source.x = 0;
    doc.selection = null;
    expect(layerViaCopyCommand(doc, source.id)).toBeNull();
    expect(layerViaCutCommand(doc, source.id)).toBeNull();
  });
});

describe('LayerViaCutCommand', () => {
  it('also cuts the selected pixels out of the source', () => {
    const { doc, source } = setup();
    const command = layerViaCutCommand(doc, source.id);
    expect(command).toBeInstanceOf(LayerViaCutCommand);
    const change = command!.apply(doc);

    expect(command!.label).toBe('Layer via Cut');
    expect(names(doc.layers)).toEqual(['Background', 'Photo', 'Layer 4', 'Layer 3']);
    expect(pixelsOf(doc.layers[2].pixels)).toEqual(COPIED);
    expect(pixelsOf(source.pixels)).toEqual(LEFT);
    expect(doc.selection).toBeNull();
    expect(change).toEqual({
      dirty: ROW,
      selectionDirty: ROW,
      layerPixels: [{ layerId: source.id, rect: ROW }],
    });
  });

  it('restores the source exactly on undo, and cuts it again on redo', () => {
    const { doc, source, editor, selection } = setup();
    editor.history.execute(layerViaCutCommand(doc, source.id)!);
    const cut = doc.layers[2];

    editor.history.undo();
    expect(pixelsOf(source.pixels)).toEqual(SOURCE);
    expect(doc.selection).toBe(selection);
    expect(names(doc.layers)).toEqual(['Background', 'Photo', 'Layer 3']);

    editor.history.redo();
    expect(pixelsOf(source.pixels)).toEqual(LEFT);
    expect(doc.layers[2]).toBe(cut);
    expect(pixelsOf(cut.pixels)).toEqual(COPIED);
  });

  it('only snapshots the part of the source inside the selection bounds', () => {
    const { doc, source } = setup([0, 0, 255, 255, 0, 0]);
    const change = new LayerViaCutCommand(source.id, 'cut', 'Cut').apply(doc);
    const area = { x: 2, y: 0, width: 2, height: 1 };
    expect(change.layerPixels).toEqual([{ layerId: source.id, rect: area }]);
    expect(doc.layers[2]).toMatchObject({ id: 'cut', name: 'Cut', x: 2, y: 0 });
  });
});

describe('PasteCommand', () => {
  it('adds a copy of the pixels as "Layer N" above the given layer, and deselects', () => {
    const { doc, source, editor, selection } = setup();
    const pixels = bufferOf(2, 1, [RED, RED]);
    const command = pasteCommand(doc, source.id, pixels, 3, 0);
    expect(command).toBeInstanceOf(PasteCommand);
    editor.history.execute(command);

    expect(editor.history.undoLabel).toBe('Paste');
    expect(names(doc.layers)).toEqual(['Background', 'Photo', 'Layer 4', 'Layer 3']);
    const pasted = doc.layers[2];
    expect(pasted).toMatchObject({ x: 3, y: 0, opacity: 1 });
    expect(pixelsOf(pasted.pixels)).toEqual([RED, RED]);
    expect(pasted.pixels).not.toBe(pixels);
    expect(doc.selection).toBeNull();

    editor.history.undo();
    expect(names(doc.layers)).toEqual(['Background', 'Photo', 'Layer 3']);
    expect(doc.selection).toBe(selection);
    editor.history.redo();
    expect(doc.layers[2]).toBe(pasted);
    expect(doc.selection).toBeNull();
  });

  it('reports the pasted area on the canvas and the selection it cleared', () => {
    const { doc } = setup();
    const change = pasteCommand(doc, null, bufferOf(3, 1, [RED, RED, RED]), 4, 0).apply(doc);
    expect(doc.layers.at(-1)?.name).toBe('Layer 4');
    expect(change).toEqual({ dirty: { x: 4, y: 0, width: 2, height: 1 }, selectionDirty: ROW });
  });
});
