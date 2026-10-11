import { describe, expect, it } from 'vitest';
import type { ImageDocument } from '../document';
import { createDocument, createLayerId } from '../document';
import { Editor } from '../editor';
import type { RasterLayer } from '../layer';
import { createRasterLayer } from '../layer';
import type { Orientation } from '../orientation';
import type { PixelBuffer } from '../pixel-buffer';
import { createPixelBuffer, getPixel } from '../pixel-buffer';
import { Selection } from '../selection';
import { OrientCanvasCommand } from './orientation-commands';

const ALL: readonly Orientation[] = [
  'rotate-cw',
  'rotate-ccw',
  'rotate-180',
  'flip-horizontal',
  'flip-vertical',
];

/** Where canvas pixel (x, y) goes on a `width` × `height` canvas: worked out by hand. */
function mapPixel(o: Orientation, x: number, y: number, width: number, height: number) {
  switch (o) {
    case 'rotate-cw':
      return [height - 1 - y, x];
    case 'rotate-ccw':
      return [y, width - 1 - x];
    case 'rotate-180':
      return [width - 1 - x, height - 1 - y];
    case 'flip-horizontal':
      return [width - 1 - x, y];
    case 'flip-vertical':
      return [x, height - 1 - y];
  }
}

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

/**
 * A 4 × 3 canvas holding a canvas-sized layer and a 2 × 3 one partly off its left edge,
 * and a selection whose coverage at each canvas pixel is the bottom layer's n there.
 */
function setUp() {
  const doc = createDocument(4, 3);
  const bottom = addLayer(doc, 0, 0, numbered(4, 3));
  const top = addLayer(doc, -1, 1, numbered(2, 3));
  doc.selection = Selection.fromMask(4, 3, [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
  return { doc, bottom, top };
}

/** Layer positions, sizes and bytes, for exact comparisons. */
function layersOf(doc: ImageDocument) {
  return doc.layers.map((layer) => ({
    id: layer.id,
    x: layer.x,
    y: layer.y,
    width: layer.pixels.width,
    height: layer.pixels.height,
    data: [...layer.pixels.data],
  }));
}

describe('OrientCanvasCommand', () => {
  it.each(ALL)('%s moves every layer pixel and the selection with the canvas', (orientation) => {
    const { doc } = setUp();
    const before = layersOf(doc).map((layer, i) => ({ ...layer, pixels: doc.layers[i].pixels }));
    const selection = doc.selection;
    new OrientCanvasCommand(orientation).apply(doc);

    const turns = orientation === 'rotate-cw' || orientation === 'rotate-ccw';
    expect([doc.width, doc.height]).toEqual(turns ? [3, 4] : [4, 3]);
    before.forEach((old, i) => {
      const layer = doc.layers[i];
      expect(layer.pixels.width * layer.pixels.height).toBe(old.width * old.height);
      for (let j = 0; j < old.height; j++) {
        for (let k = 0; k < old.width; k++) {
          const [x, y] = mapPixel(orientation, old.x + k, old.y + j, 4, 3);
          expect(getPixel(layer.pixels, x - layer.x, y - layer.y)).toEqual(
            getPixel(old.pixels, k, j),
          );
        }
      }
    });
    for (let y = 0; y < 3; y++) {
      for (let x = 0; x < 4; x++) {
        const [nx, ny] = mapPixel(orientation, x, y, 4, 3);
        expect(doc.selection?.coverageAt(nx, ny)).toBe(selection?.coverageAt(x, y));
      }
    }
  });

  it('turns the selection mask exactly as it turns the pixels', () => {
    const { doc, bottom } = setUp();
    for (const orientation of ALL) {
      new OrientCanvasCommand(orientation).apply(doc);
      const { selection } = doc;
      expect(selection?.bounds()).toEqual({ x: 0, y: 0, width: doc.width, height: doc.height });
      for (let y = 0; y < doc.height; y++) {
        for (let x = 0; x < doc.width; x++) {
          expect(selection?.coverageAt(x, y)).toBe(getPixel(bottom.pixels, x, y)[2]);
        }
      }
    }
  });

  it('puts a small layer where hand-worked coordinates say', () => {
    const { doc, top } = setUp();
    // The 2 × 3 layer at (−1, 1) on the 4 × 3 canvas covers canvas x −1…0 and y 1…3. Turned
    // clockwise onto a 3 × 4 canvas, canvas (x, y) goes to (2 − y, x): x −1…1, y −1…0.
    new OrientCanvasCommand('rotate-cw').apply(doc);
    expect([top.x, top.y, top.pixels.width, top.pixels.height]).toEqual([-1, -1, 3, 2]);
    // Its bottom-left pixel (0, 2) was at canvas (−1, 3), now (−1, −1): the new top-left.
    expect(getPixel(top.pixels, 0, 0)).toEqual([0, 2, 5, 255]);
    expect(getPixel(top.pixels, 2, 0)).toEqual([0, 0, 1, 255]);
    expect(getPixel(top.pixels, 2, 1)).toEqual([1, 0, 2, 255]);
  });

  it('gives back identical bytes after four quarter turns, two half turns or two flips', () => {
    const sequences: Orientation[][] = [
      ['rotate-cw', 'rotate-cw', 'rotate-cw', 'rotate-cw'],
      ['rotate-ccw', 'rotate-ccw', 'rotate-ccw', 'rotate-ccw'],
      ['rotate-180', 'rotate-180'],
      ['flip-horizontal', 'flip-horizontal'],
      ['flip-vertical', 'flip-vertical'],
      ['rotate-cw', 'rotate-ccw'],
      ['flip-horizontal', 'flip-vertical', 'rotate-180'],
    ];
    for (const sequence of sequences) {
      const { doc } = setUp();
      const layers = layersOf(doc);
      const selection = doc.selection;
      for (const orientation of sequence) new OrientCanvasCommand(orientation).apply(doc);
      expect([doc.width, doc.height]).toEqual([4, 3]);
      expect(layersOf(doc)).toEqual(layers);
      expect(selection && doc.selection?.equals(selection)).toBe(true);
    }
  });

  it('undoes and redoes exactly, keeping the layers and the selection it started with', () => {
    for (const orientation of ALL) {
      const { doc } = setUp();
      const editor = new Editor(doc);
      const layers = layersOf(doc);
      const objects = [...doc.layers];
      const selection = doc.selection;
      editor.history.execute(new OrientCanvasCommand(orientation));
      const after = layersOf(doc);
      const turned = doc.selection;

      expect(editor.history.undo()).toBe(true);
      expect([doc.width, doc.height]).toEqual([4, 3]);
      expect(layersOf(doc)).toEqual(layers);
      expect(doc.layers.every((layer, i) => layer === objects[i])).toBe(true);
      expect(doc.selection).toBe(selection);

      expect(editor.history.redo()).toBe(true);
      expect(layersOf(doc)).toEqual(after);
      expect(turned && doc.selection?.equals(turned)).toBe(true);
    }
  });

  it('reports the canvas, the resize, the selection and every layer as changed', () => {
    const { doc, bottom, top } = setUp();
    const layerPixels = [
      { layerId: bottom.id, rect: null },
      { layerId: top.id, rect: null },
    ];
    const command = new OrientCanvasCommand('rotate-ccw');
    const canvas = { x: 0, y: 0, width: 3, height: 4 };
    expect(command.label).toBe('Rotate 90° Anticlockwise');
    expect(command.apply(doc)).toEqual({
      dirty: canvas,
      resized: true,
      selectionDirty: canvas,
      layerPixels,
    });
    const back = { x: 0, y: 0, width: 4, height: 3 };
    expect(command.revert(doc)).toEqual({
      dirty: back,
      resized: true,
      selectionDirty: back,
      layerPixels,
    });

    doc.selection = null;
    expect(new OrientCanvasCommand('flip-vertical').apply(doc)).toEqual({
      dirty: back,
      layerPixels,
    });
  });

  it("doesn't report a resize when turning a square canvas", () => {
    const doc = createDocument(3, 3);
    addLayer(doc, 0, 0, numbered(3, 3));
    expect(new OrientCanvasCommand('rotate-cw').apply(doc).resized).toBeUndefined();
  });
});
