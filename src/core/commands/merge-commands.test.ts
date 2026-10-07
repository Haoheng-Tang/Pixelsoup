import { describe, expect, it } from 'vitest';
import { CpuCompositor } from '../compositor/cpu-compositor';
import type { ImageDocument } from '../document';
import { createDocument, createLayerId } from '../document';
import { Editor } from '../editor';
import type { RasterLayer } from '../layer';
import { createRasterLayer, layerBounds } from '../layer';
import type { PixelBuffer, Rgba } from '../pixel-buffer';
import { getPixel, setPixel } from '../pixel-buffer';
import {
  FlattenCommand,
  MergeDownCommand,
  flattenCommand,
  mergeDownCommand,
} from './merge-commands';

const T: Rgba = [0, 0, 0, 0];
const RED: Rgba = [255, 0, 0, 255];
const GREEN: Rgba = [0, 255, 0, 255];
const BLUE: Rgba = [0, 0, 255, 255];

interface LayerOptions {
  width?: number;
  height?: number;
  x?: number;
  y?: number;
  opacity?: number;
  visible?: boolean;
}

/** Puts a layer of one colour on top of `doc`: 2×2 at (0, 0) unless told otherwise. */
function addSolid(
  doc: ImageDocument,
  name: string,
  color: Rgba,
  options: LayerOptions = {},
): RasterLayer {
  return addPattern(doc, name, () => color, options);
}

function addPattern(
  doc: ImageDocument,
  name: string,
  color: (x: number, y: number) => Rgba,
  { width = 2, height = 2, ...properties }: LayerOptions = {},
): RasterLayer {
  const layer = createRasterLayer({ id: createLayerId(doc), name, width, height, ...properties });
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) setPixel(layer.pixels, x, y, color(x, y));
  }
  doc.layers.push(layer);
  return layer;
}

function rows(buffer: PixelBuffer): Rgba[][] {
  const out: Rgba[][] = [];
  for (let y = 0; y < buffer.height; y++) {
    const row: Rgba[] = [];
    for (let x = 0; x < buffer.width; x++) row.push(getPixel(buffer, x, y));
    out.push(row);
  }
  return out;
}

function render(doc: ImageDocument): PixelBuffer {
  const compositor = new CpuCompositor(doc.width, doc.height);
  compositor.composite(doc);
  return compositor.output;
}

function expectCommand<C>(command: C | null): C {
  if (command === null) throw new Error('expected a command');
  return command;
}

describe('MergeDownCommand', () => {
  it('merges a layer into the one below, which keeps its ID and name', () => {
    const doc = createDocument(4, 4);
    const lower = addSolid(doc, 'Photo', BLUE, { height: 1 });
    const upper = addSolid(doc, 'Red', RED, { width: 1, height: 1, x: 1 });
    const editor = new Editor(doc);

    editor.history.execute(expectCommand(mergeDownCommand(doc, upper.id)));
    expect(doc.layers).toHaveLength(1);
    const merged = doc.layers[0];
    expect(merged).toMatchObject({ id: lower.id, name: 'Photo', x: 0, y: 0, opacity: 1 });
    expect(merged.visible).toBe(true);
    expect(rows(merged.pixels)).toEqual([[BLUE, RED]]);
    expect(editor.history.undoLabel).toBe('Merge Down');
  });

  it("bakes the upper layer's opacity into the pixels", () => {
    // RED at 60 % over BLUE: r = 255 × 0.6 = 153, b = 255 × 0.4 = 102.
    const doc = createDocument(1, 1);
    addSolid(doc, 'Blue', BLUE, { width: 1, height: 1 });
    const upper = addSolid(doc, 'Red', RED, { width: 1, height: 1, opacity: 0.6 });
    expectCommand(mergeDownCommand(doc, upper.id)).apply(doc);
    expect(rows(doc.layers[0].pixels)).toEqual([[[153, 0, 102, 255]]]);
  });

  it("bakes the lower layer's opacity in too", () => {
    // GREEN at 40 % with nothing above it: alpha = 255 × 0.4 = 102.
    const doc = createDocument(2, 1);
    addSolid(doc, 'Green', GREEN, { width: 1, height: 1, opacity: 0.4 });
    const upper = addSolid(doc, 'Red', RED, { width: 1, height: 1, x: 1 });
    expectCommand(mergeDownCommand(doc, upper.id)).apply(doc);
    expect(rows(doc.layers[0].pixels)).toEqual([[[0, 255, 0, 102], RED]]);
  });

  it('blends translucent pixels with straight alpha', () => {
    // Both alphas are 128 / 255 ≈ 0.502. Result alpha = 0.502 + 0.502 × 0.498 ≈ 0.752 → 192;
    // r = 255 × 0.502 / 0.752 ≈ 170.2 → 170; b = 255 × 0.502 × 0.498 / 0.752 ≈ 84.8 → 85.
    const doc = createDocument(1, 1);
    addSolid(doc, 'Blue', [0, 0, 255, 128], { width: 1, height: 1 });
    const upper = addSolid(doc, 'Red', [255, 0, 0, 128], { width: 1, height: 1 });
    expectCommand(mergeDownCommand(doc, upper.id)).apply(doc);
    expect(rows(doc.layers[0].pixels)).toEqual([[[170, 0, 85, 192]]]);
  });

  it('covers both layers, offsets included', () => {
    const doc = createDocument(4, 4);
    addSolid(doc, 'Green', GREEN);
    const upper = addSolid(doc, 'Red', RED, { x: 1, y: 1 });
    expectCommand(mergeDownCommand(doc, upper.id)).apply(doc);
    const merged = doc.layers[0];
    expect(layerBounds(merged)).toEqual({ x: 0, y: 0, width: 3, height: 3 });
    expect(rows(merged.pixels)).toEqual([
      [GREEN, GREEN, T],
      [GREEN, RED, RED],
      [T, RED, RED],
    ]);
  });

  it('keeps the parts of either layer that are off the canvas', () => {
    const doc = createDocument(4, 4);
    addSolid(doc, 'Green', GREEN);
    const upper = addSolid(doc, 'Red', RED, { x: -1, y: -1 });
    expectCommand(mergeDownCommand(doc, upper.id)).apply(doc);
    const merged = doc.layers[0];
    expect(layerBounds(merged)).toEqual({ x: -1, y: -1, width: 3, height: 3 });
    expect(rows(merged.pixels)).toEqual([
      [RED, RED, T],
      [RED, RED, GREEN],
      [T, GREEN, GREEN],
    ]);
  });

  it("equals the compositor's output for the two layers alone", () => {
    // A "photo" under a translucent layer that is offset and partly off the canvas.
    const doc = createDocument(6, 5);
    addPattern(doc, 'Photo', (x, y) => [x * 40, y * 50, 200 - x * 20, 255], {
      width: 6,
      height: 5,
    });
    const upper = addPattern(doc, 'Overlay', (x, y) => [250, 120 + x * 30, y * 60, 60 + x * 50], {
      width: 4,
      height: 3,
      x: 3,
      y: -1,
      opacity: 0.7,
    });
    const alone = render(doc);

    expectCommand(mergeDownCommand(doc, upper.id)).apply(doc);
    const merged = doc.layers[0];
    expect(layerBounds(merged)).toEqual({ x: 0, y: -1, width: 7, height: 6 });
    for (let y = 0; y < doc.height; y++) {
      for (let x = 0; x < doc.width; x++) {
        expect(getPixel(merged.pixels, x - merged.x, y - merged.y)).toEqual(getPixel(alone, x, y));
      }
    }
  });

  it('leaves the document composite as it was, to within rounding', () => {
    const doc = createDocument(6, 5);
    addPattern(doc, 'Backdrop', (x, y) => [30 + x * 35, 220 - y * 40, 90 + x * y * 5, 255], {
      width: 6,
      height: 5,
    });
    addPattern(doc, 'Lower', (x, y) => [200, x * 50, y * 50, 90 + y * 40], {
      width: 4,
      height: 4,
      x: 1,
      y: 1,
      opacity: 0.8,
    });
    const upper = addPattern(doc, 'Upper', (x, y) => [x * 60, 180, 255 - y * 70, 40 + x * 60], {
      width: 4,
      height: 3,
      x: 3,
      y: -1,
      opacity: 0.55,
    });
    const before = render(doc).data;

    expectCommand(mergeDownCommand(doc, upper.id)).apply(doc);
    const after = render(doc).data;
    let worst = 0;
    for (let i = 0; i < before.length; i++) worst = Math.max(worst, Math.abs(before[i] - after[i]));
    expect(worst).toBeLessThanOrEqual(1);
  });

  it('restores both layers on undo and puts the same merged layer back on redo', () => {
    const doc = createDocument(4, 4);
    addSolid(doc, 'Bottom', BLUE);
    const lower = addSolid(doc, 'Lower', GREEN, { x: 1 });
    const upper = addSolid(doc, 'Upper', RED, { x: 2, y: 3, opacity: 0.5 });
    addSolid(doc, 'Top', BLUE);
    const editor = new Editor(doc);

    editor.history.execute(expectCommand(mergeDownCommand(doc, upper.id)));
    const merged = doc.layers[1];
    expect(doc.layers.map((layer) => layer.name)).toEqual(['Bottom', 'Lower', 'Top']);

    editor.history.undo();
    expect(doc.layers[1]).toBe(lower);
    expect(doc.layers[2]).toBe(upper);
    expect(lower).toMatchObject({ x: 1, y: 0, opacity: 1 });
    expect(upper).toMatchObject({ x: 2, y: 3, opacity: 0.5 });
    editor.history.redo();
    expect(doc.layers[1]).toBe(merged);
  });

  it('reports the merged area and the replaced layer pixels', () => {
    const doc = createDocument(4, 4);
    const lower = addSolid(doc, 'Lower', GREEN, { x: -1 });
    const upper = addSolid(doc, 'Upper', RED, { x: 1, y: 1 });
    const command = expectCommand(mergeDownCommand(doc, upper.id));
    const expected = {
      dirty: { x: 0, y: 0, width: 3, height: 3 },
      layerPixels: [{ layerId: lower.id, rect: null }],
    };
    expect(command.apply(doc)).toEqual(expected);
    expect(command.revert(doc)).toEqual(expected);
  });

  it('uses the canvas when both layers together would exceed the maximum image size', () => {
    const doc = createDocument(4, 4);
    addSolid(doc, 'Near', GREEN);
    const far = addSolid(doc, 'Far', RED, { x: 9000 });
    expectCommand(mergeDownCommand(doc, far.id)).apply(doc);
    const merged = doc.layers[0];
    expect(layerBounds(merged)).toEqual({ x: 0, y: 0, width: 4, height: 4 });
    expect(getPixel(merged.pixels, 1, 1)).toEqual(GREEN);
  });

  it('lets a hidden layer contribute nothing', () => {
    const doc = createDocument(1, 1);
    addSolid(doc, 'Blue', BLUE, { width: 1, height: 1 });
    const upper = addSolid(doc, 'Red', RED, { width: 1, height: 1, visible: false });
    new MergeDownCommand(upper.id).apply(doc);
    expect(rows(doc.layers[0].pixels)).toEqual([[BLUE]]);
  });

  it('is null for the bottom layer, a missing layer, or a pair with a hidden layer', () => {
    const doc = createDocument(4, 4);
    const bottom = addSolid(doc, 'Bottom', BLUE);
    const middle = addSolid(doc, 'Middle', GREEN, { visible: false });
    const top = addSolid(doc, 'Top', RED);
    expect(mergeDownCommand(doc, bottom.id)).toBeNull();
    expect(mergeDownCommand(doc, 'layer-99')).toBeNull();
    expect(mergeDownCommand(doc, middle.id)).toBeNull();
    expect(mergeDownCommand(doc, top.id)).toBeNull();
    middle.visible = true;
    expect(mergeDownCommand(doc, top.id)).toBeInstanceOf(MergeDownCommand);
    expect(() => new MergeDownCommand(bottom.id).apply(doc)).toThrow(/no layer below/);
  });
});

describe('FlattenCommand', () => {
  it('composites the visible layers into one canvas-sized layer', () => {
    const doc = createDocument(4, 3);
    addSolid(doc, 'Hidden', BLUE, { width: 4, height: 3, visible: false });
    const base = addSolid(doc, 'Base', GREEN, { width: 3, height: 3, x: -1, y: 1, opacity: 0.4 });
    addSolid(doc, 'Top', RED, { x: 2, opacity: 0.6 });
    const expected = render(doc);
    const editor = new Editor(doc);

    editor.history.execute(expectCommand(flattenCommand(doc)));
    expect(doc.layers).toHaveLength(1);
    const flat = doc.layers[0];
    expect(flat).toMatchObject({ id: base.id, name: 'Base', x: 0, y: 0, opacity: 1 });
    expect(flat.visible).toBe(true);
    expect(flat.pixels).toEqual(expected);
    // Transparent areas stay transparent rather than being filled.
    expect(getPixel(flat.pixels, 0, 0)).toEqual(T);
    expect(editor.history.undoLabel).toBe('Flatten Image');
  });

  it('restores every layer on undo, hidden ones included', () => {
    const doc = createDocument(4, 4);
    addSolid(doc, 'A', BLUE, { visible: false });
    addSolid(doc, 'B', GREEN);
    addSolid(doc, 'C', RED, { x: 3 });
    const before = [...doc.layers];
    const editor = new Editor(doc);

    editor.history.execute(expectCommand(flattenCommand(doc)));
    const flat = doc.layers[0];
    editor.history.undo();
    expect(doc.layers).toHaveLength(3);
    doc.layers.forEach((layer, i) => expect(layer).toBe(before[i]));
    editor.history.redo();
    expect(doc.layers).toEqual([flat]);
  });

  it('reports the whole canvas and the replaced layer pixels', () => {
    const doc = createDocument(4, 3);
    const a = addSolid(doc, 'A', BLUE);
    addSolid(doc, 'B', GREEN);
    const command = new FlattenCommand();
    const expected = {
      dirty: { x: 0, y: 0, width: 4, height: 3 },
      layerPixels: [{ layerId: a.id, rect: null }],
    };
    expect(command.apply(doc)).toEqual(expected);
    expect(command.revert(doc)).toEqual(expected);
  });

  it('is null with no visible layer, or when the document is already flat', () => {
    const doc = createDocument(4, 4);
    const only = addSolid(doc, 'Only', BLUE, { width: 4, height: 4 });
    expect(flattenCommand(doc)).toBeNull();
    only.visible = false;
    expect(flattenCommand(doc)).toBeNull();
    expect(() => new FlattenCommand().apply(doc)).toThrow(/no visible layers/);

    only.visible = true;
    only.opacity = 0.5;
    expect(flattenCommand(doc)).not.toBeNull();
    only.opacity = 1;
    only.x = 1;
    expect(flattenCommand(doc)).not.toBeNull();
    only.x = 0;
    addSolid(doc, 'Hidden', RED, { visible: false });
    expect(flattenCommand(doc)).not.toBeNull();
  });
});
