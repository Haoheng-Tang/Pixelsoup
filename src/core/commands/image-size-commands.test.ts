import { describe, expect, it } from 'vitest';
import type { ImageDocument } from '../document';
import { createDocument, createLayerId } from '../document';
import { Editor } from '../editor';
import type { RasterLayer } from '../layer';
import { createRasterLayer } from '../layer';
import type { PixelBuffer } from '../pixel-buffer';
import { clonePixelBuffer, createPixelBuffer, getPixel } from '../pixel-buffer';
import { Selection } from '../selection';
import { ResampleDocumentCommand, imageSizeCommand } from './image-size-commands';

/** A buffer whose pixel (x, y) is [40x, 40y, n, 255], n counting from 1 in reading order. */
function numbered(width: number, height: number): PixelBuffer {
  const buffer = createPixelBuffer(width, height);
  for (let i = 0; i < width * height; i++) {
    buffer.data.set([(i % width) * 40, Math.floor(i / width) * 40, i + 1, 255], i * 4);
  }
  return buffer;
}

function addLayer(doc: ImageDocument, x: number, y: number, pixels: PixelBuffer): RasterLayer {
  const layer = createRasterLayer({ id: createLayerId(doc), name: 'Layer', x, y, pixels });
  doc.layers.push(layer);
  return layer;
}

function placement(layer: RasterLayer) {
  return { x: layer.x, y: layer.y, width: layer.pixels.width, height: layer.pixels.height };
}

describe('ResampleDocumentCommand', () => {
  it('doubles every pixel and offset with nearest neighbour', () => {
    const doc = createDocument(6, 4);
    const layer = addLayer(doc, 1, -1, numbered(2, 2));
    new Editor(doc).history.execute(new ResampleDocumentCommand(12, 8, 'nearest'));
    expect([doc.width, doc.height]).toEqual([12, 8]);
    expect(placement(layer)).toEqual({ x: 2, y: -2, width: 4, height: 4 });
    for (let y = 0; y < 4; y++) {
      for (let x = 0; x < 4; x++) {
        expect(getPixel(layer.pixels, x, y)).toEqual(
          getPixel(numbered(2, 2), Math.floor(x / 2), Math.floor(y / 2)),
        );
      }
    }
  });

  it('rounds layer edges to whole pixels, so layers that met still meet', () => {
    const doc = createDocument(7, 2);
    const left = addLayer(doc, 0, 0, numbered(3, 2));
    const right = addLayer(doc, 3, 0, numbered(4, 2));
    new Editor(doc).history.execute(new ResampleDocumentCommand(5, 4, 'bilinear'));
    // Edges at 0, 3 and 7 land on 0, round(15 / 7) = 2 and 5.
    expect(placement(left)).toEqual({ x: 0, y: 0, width: 2, height: 4 });
    expect(placement(right)).toEqual({ x: 2, y: 0, width: 3, height: 4 });
  });

  it('keeps a layer at least a pixel across', () => {
    const doc = createDocument(100, 100);
    const layer = addLayer(doc, 10, 10, numbered(1, 1));
    new Editor(doc).history.execute(new ResampleDocumentCommand(10, 10, 'bilinear'));
    expect(placement(layer)).toEqual({ x: 1, y: 1, width: 1, height: 1 });
    expect(layer.pixels.data).toEqual(numbered(1, 1).data);
  });

  it('clears the selection and undoes to the very same layers, size and selection', () => {
    const doc = createDocument(6, 4);
    const original = numbered(3, 2);
    const copy = clonePixelBuffer(original);
    const layer = addLayer(doc, 1, 1, original);
    const selection = Selection.fromRect(6, 4, { x: 1, y: 1, width: 2, height: 2 });
    doc.selection = selection;
    const editor = new Editor(doc);
    const command = imageSizeCommand(doc, 9, 5, 'bilinear');
    if (!command) throw new Error('Nothing to resize');
    expect(command.apply(doc)).toEqual({
      dirty: { x: 0, y: 0, width: 9, height: 5 },
      resized: true,
      selectionDirty: { x: 0, y: 0, width: 9, height: 5 },
      layerPixels: [{ layerId: layer.id, rect: null }],
    });
    command.revert(doc);
    editor.history.execute(command);
    expect(editor.history.undoLabel).toBe('Image Size');
    expect(doc.selection).toBeNull();
    const resampled = layer.pixels;
    editor.history.undo();
    expect([doc.width, doc.height, doc.selection]).toEqual([6, 4, selection]);
    expect(doc.selection).toBe(selection);
    expect(layer.pixels).toBe(original);
    expect(layer.pixels.data).toEqual(copy.data);
    expect([layer.x, layer.y]).toEqual([1, 1]);
    editor.history.redo();
    expect([doc.width, doc.height, doc.selection]).toEqual([9, 5, null]);
    expect(layer.pixels).toBe(resampled);
  });

  it('cuts a layer that would grow too big to the canvas first', () => {
    const doc = createDocument(100, 10);
    const pixels = createPixelBuffer(5000, 1);
    for (let x = 0; x < 5000; x++) pixels.data.set([x % 256, 0, 0, 255], x * 4);
    const wide = addLayer(doc, -2000, 0, pixels);
    const away = addLayer(doc, 200, 0, createPixelBuffer(5000, 1));
    new Editor(doc).history.execute(new ResampleDocumentCommand(200, 10, 'nearest'));
    // 10000 pixels is too wide, so just canvas x 0 to 99 (layer x 2000 to 2099) is doubled.
    expect(placement(wide)).toEqual({ x: 0, y: 0, width: 200, height: 1 });
    expect(getPixel(wide.pixels, 0, 0)).toEqual([2000 % 256, 0, 0, 255]);
    expect(getPixel(wide.pixels, 11, 0)).toEqual([2005 % 256, 0, 0, 255]);
    expect(getPixel(wide.pixels, 199, 0)).toEqual([2099 % 256, 0, 0, 255]);
    // None of this one is on the canvas, so nothing of it is left.
    expect(placement(away)).toEqual({ x: 0, y: 0, width: 200, height: 10 });
    expect(away.pixels.data.every((value) => value === 0)).toBe(true);
  });

  it('refuses sizes outside the canvas limits', () => {
    for (const [width, height] of [
      [0, 10],
      [10, 8193],
      [2.5, 10],
    ]) {
      expect(() => new ResampleDocumentCommand(width, height, 'nearest')).toThrow(RangeError);
    }
  });
});

describe('imageSizeCommand', () => {
  it('is null when the size wouldn’t change', () => {
    const doc = createDocument(6, 4);
    expect(imageSizeCommand(doc, 6, 4, 'bilinear')).toBeNull();
    expect(imageSizeCommand(doc, 6, 5, 'bilinear')).not.toBeNull();
  });
});
