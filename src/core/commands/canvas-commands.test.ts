import { describe, expect, it } from 'vitest';
import type { ImageDocument } from '../document';
import { createDocument, createLayerId } from '../document';
import { Editor } from '../editor';
import type { RasterLayer } from '../layer';
import { createRasterLayer } from '../layer';
import type { PixelBuffer } from '../pixel-buffer';
import { createPixelBuffer, getPixel } from '../pixel-buffer';
import { Selection } from '../selection';
import {
  anchorOffset,
  canvasSizeCommand,
  cropCommand,
  ResizeCanvasCommand,
  resizeCanvasCommand,
} from './canvas-commands';

/** A buffer whose pixel (x, y) is [x, y, n, 255], n counting from 1 in reading order. */
function numbered(width: number, height: number): PixelBuffer {
  const buffer = createPixelBuffer(width, height);
  for (let i = 0; i < width * height; i++) {
    buffer.data.set([i % width, Math.floor(i / width), i + 1, 255], i * 4);
  }
  return buffer;
}

function addLayer(doc: ImageDocument, x: number, y: number, pixels: PixelBuffer): RasterLayer {
  const layer = createRasterLayer({ id: createLayerId(doc), name: 'Layer', x, y, pixels });
  doc.layers.push(layer);
  return layer;
}

/** Everything about a document that a canvas command may change, for exact comparisons. */
function stateOf(doc: ImageDocument) {
  return {
    width: doc.width,
    height: doc.height,
    selection: doc.selection,
    layers: doc.layers.map((layer) => ({
      id: layer.id,
      x: layer.x,
      y: layer.y,
      width: layer.pixels.width,
      height: layer.pixels.height,
      data: [...layer.pixels.data],
    })),
  };
}

describe('ResizeCanvasCommand', () => {
  it('changes the size and moves every layer by the offset, keeping all their pixels', () => {
    const doc = createDocument(4, 3);
    const a = addLayer(doc, 0, 0, numbered(4, 3));
    const b = addLayer(doc, -2, 1, numbered(3, 3));
    const pixelsA = a.pixels;
    const change = new ResizeCanvasCommand(6, 2, 1, -1).apply(doc);

    expect([doc.width, doc.height]).toEqual([6, 2]);
    expect([a.x, a.y, b.x, b.y]).toEqual([1, -1, -1, 0]);
    expect(a.pixels).toBe(pixelsA); // no pixel copies
    expect(change).toEqual({ dirty: { x: 0, y: 0, width: 6, height: 2 }, resized: true });
  });

  it('reports no resize when only the offset changes', () => {
    const doc = createDocument(4, 3);
    addLayer(doc, 0, 0, numbered(4, 3));
    const change = new ResizeCanvasCommand(4, 3, 2, 0).apply(doc);
    expect(change).toEqual({ dirty: { x: 0, y: 0, width: 4, height: 3 } });
  });

  it('moves the selection with the layers and cuts it to the new canvas', () => {
    const doc = createDocument(4, 4);
    addLayer(doc, 0, 0, numbered(4, 4));
    // Coverage n at (x, y) for n = 1 + x + 4y, so every pixel is told apart.
    const mask = Array.from({ length: 16 }, (_, i) => i + 1);
    doc.selection = Selection.fromMask(4, 4, mask);
    const change = new ResizeCanvasCommand(3, 2, -1, -2).apply(doc);

    const selection = doc.selection;
    if (!selection) throw new Error('The selection was cleared');
    expect([selection.width, selection.height]).toEqual([3, 2]);
    // New (x, y) shows old (x + 1, y + 2).
    expect(Array.from(selection.mask)).toEqual([10, 11, 12, 14, 15, 16]);
    expect(selection.bounds()).toEqual({ x: 0, y: 0, width: 3, height: 2 });
    expect(change.selectionDirty).toEqual({ x: 0, y: 0, width: 3, height: 2 });
  });

  it('keeps the selection where it was when the canvas grows', () => {
    const doc = createDocument(2, 2);
    doc.selection = Selection.fromRect(2, 2, { x: 1, y: 0, width: 1, height: 1 });
    new ResizeCanvasCommand(5, 4, 2, 1).apply(doc);
    expect(doc.selection?.bounds()).toEqual({ x: 3, y: 1, width: 1, height: 1 });
    expect(doc.selection?.coverageAt(3, 1)).toBe(255);
  });

  it('clears the selection when none of it is left on the canvas', () => {
    const doc = createDocument(4, 4);
    doc.selection = Selection.fromRect(4, 4, { x: 3, y: 3, width: 1, height: 1 });
    const change = new ResizeCanvasCommand(2, 2, 0, 0).apply(doc);
    expect(doc.selection).toBeNull();
    expect(change.selectionDirty).toEqual({ x: 0, y: 0, width: 2, height: 2 });
  });

  it('undoes exactly, restoring the size, offsets and the selection itself', () => {
    const doc = createDocument(5, 4);
    addLayer(doc, 0, 0, numbered(5, 4));
    addLayer(doc, 3, -1, numbered(4, 2));
    doc.selection = Selection.fromEllipse(5, 4, { x: 0, y: 0, width: 4, height: 3 });
    const editor = new Editor(doc);
    const before = stateOf(doc);

    editor.history.execute(new ResizeCanvasCommand(3, 3, -1, -1));
    const after = stateOf(doc);
    editor.history.undo();
    expect(stateOf(doc)).toEqual(before);
    expect(doc.selection).toBe(before.selection);
    editor.history.redo();
    expect(stateOf(doc)).toEqual(after);
  });

  it('rejects invalid sizes and fractional offsets', () => {
    expect(() => new ResizeCanvasCommand(0, 3, 0, 0)).toThrow(/size/);
    expect(() => new ResizeCanvasCommand(8193, 3, 0, 0)).toThrow(/size/);
    expect(() => new ResizeCanvasCommand(3, 3, 0.5, 0)).toThrow(/whole pixels/);
  });

  describe('trimming ("Delete cropped pixels")', () => {
    it('cuts each layer to the canvas, keeping the pixels that were on it', () => {
      const doc = createDocument(4, 4);
      const layer = addLayer(doc, -1, 0, numbered(4, 3));
      const change = new ResizeCanvasCommand(2, 2, -1, -1, { trim: true }).apply(doc);

      // The layer moved to (−2, −1): its pixels (2, 1)–(3, 2) are on the 2 × 2 canvas.
      expect([layer.x, layer.y, layer.pixels.width, layer.pixels.height]).toEqual([0, 0, 2, 2]);
      expect(getPixel(layer.pixels, 0, 0)).toEqual([2, 1, 7, 255]);
      expect(getPixel(layer.pixels, 1, 1)).toEqual([3, 2, 12, 255]);
      expect(change.layerPixels).toEqual([{ layerId: layer.id, rect: null }]);
    });

    it('leaves layers wholly on the canvas alone', () => {
      const doc = createDocument(4, 4);
      const inside = addLayer(doc, 1, 1, numbered(2, 2));
      const pixels = inside.pixels;
      const change = new ResizeCanvasCommand(4, 4, 1, 1, { trim: true }).apply(doc);
      expect(inside.pixels).toBe(pixels);
      expect([inside.x, inside.y]).toEqual([2, 2]);
      expect(change.layerPixels).toBeUndefined();
    });

    it('turns a layer left with nothing into a transparent canvas-sized one', () => {
      const doc = createDocument(4, 4);
      const gone = addLayer(doc, 3, 3, numbered(1, 1));
      new ResizeCanvasCommand(2, 2, 0, 0, { trim: true }).apply(doc);
      expect([gone.x, gone.y, gone.pixels.width, gone.pixels.height]).toEqual([0, 0, 2, 2]);
      expect([...gone.pixels.data].every((v) => v === 0)).toBe(true);
    });

    it('puts back every pixel it cut on undo, and trims the same way on redo', () => {
      const doc = createDocument(6, 5);
      addLayer(doc, 0, 0, numbered(6, 5));
      addLayer(doc, -3, -2, numbered(5, 9)); // past the top, left and bottom edges
      addLayer(doc, 4, 4, numbered(1, 1)); // cut away entirely
      const editor = new Editor(doc);
      const before = stateOf(doc);

      editor.history.execute(new ResizeCanvasCommand(3, 3, -1, -1, { trim: true }));
      const after = stateOf(doc);
      expect(after.layers.map((l) => [l.x, l.y, l.width, l.height])).toEqual([
        [0, 0, 3, 3],
        [0, 0, 1, 3],
        [0, 0, 3, 3],
      ]);
      editor.history.undo();
      expect(stateOf(doc)).toEqual(before);
      editor.history.redo();
      expect(stateOf(doc)).toEqual(after);
    });
  });
});

describe('resizeCanvasCommand', () => {
  it('returns null when nothing would change', () => {
    const doc = createDocument(4, 4);
    addLayer(doc, -1, 0, numbered(2, 2));
    expect(resizeCanvasCommand(doc, 4, 4, 0, 0)).toBeNull();
    expect(resizeCanvasCommand(doc, 4, 4, 0, 1)).not.toBeNull();
    // Trimming still cuts the layer past the left edge.
    expect(resizeCanvasCommand(doc, 4, 4, 0, 0, { trim: true })).not.toBeNull();
    doc.layers[0].x = 0;
    expect(resizeCanvasCommand(doc, 4, 4, 0, 0, { trim: true })).toBeNull();
  });
});

describe('cropCommand', () => {
  it('crops to an area of the canvas', () => {
    const doc = createDocument(5, 5);
    const layer = addLayer(doc, 0, 0, numbered(5, 5));
    const command = cropCommand(doc, { x: 1, y: 2, width: 3, height: 2 });
    expect(command?.label).toBe('Crop');
    command?.apply(doc);
    expect([doc.width, doc.height, layer.x, layer.y]).toEqual([3, 2, -1, -2]);
  });

  it('enlarges the canvas with transparent space for an area past its edges', () => {
    const doc = createDocument(2, 2);
    const layer = addLayer(doc, 0, 0, numbered(2, 2));
    cropCommand(doc, { x: -1, y: -2, width: 4, height: 4 }, { trim: true })?.apply(doc);
    expect([doc.width, doc.height, layer.x, layer.y]).toEqual([4, 4, 1, 2]);
    expect([layer.pixels.width, layer.pixels.height]).toEqual([2, 2]);
  });

  it('is null for the whole canvas', () => {
    const doc = createDocument(3, 3);
    expect(cropCommand(doc, { x: 0, y: 0, width: 3, height: 3 })).toBeNull();
  });
});

describe('canvas size', () => {
  it('anchors the image at the start, centre or end of each axis', () => {
    expect(anchorOffset(4, 10, 'start')).toBe(0);
    expect(anchorOffset(4, 10, 'center')).toBe(3);
    expect(anchorOffset(4, 10, 'end')).toBe(6);
    expect(anchorOffset(10, 4, 'end')).toBe(-6);
    // Odd differences truncate toward zero, so growing and shrinking back round-trips.
    expect(anchorOffset(3, 6, 'center')).toBe(1);
    expect(anchorOffset(6, 3, 'center')).toBe(-1);
    expect(anchorOffset(3, 2, 'center')).toBe(0);
  });

  it('builds the command for an anchor, or null for the same size', () => {
    const doc = createDocument(4, 4);
    const layer = addLayer(doc, 0, 0, numbered(4, 4));
    expect(canvasSizeCommand(doc, 4, 4, 'end', 'end')).toBeNull();
    canvasSizeCommand(doc, 8, 6, 'end', 'center')?.apply(doc);
    expect([doc.width, doc.height, layer.x, layer.y]).toEqual([8, 6, 4, 1]);
    expect(getPixel(layer.pixels, 0, 0)).toEqual([0, 0, 1, 255]);
  });
});
