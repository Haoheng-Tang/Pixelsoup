import { describe, expect, it } from 'vitest';
import type { ImageDocument } from '../document';
import { createDocument, createLayerId } from '../document';
import { Editor } from '../editor';
import type { RasterLayer } from '../layer';
import { createRasterLayer } from '../layer';
import type { Orientation } from '../orientation';
import { orientPixels } from '../orientation';
import type { PixelBuffer } from '../pixel-buffer';
import { clonePixelBuffer, createPixelBuffer, fillRect, getPixel } from '../pixel-buffer';
import { IDENTITY, scaling, translation } from '../resample/affine';
import { Selection } from '../selection';
import { liftSelectionCommand } from './float-commands';
import { MoveLayerCommand } from './move-commands';
import { rotateLayerCommand, transformLayerCommand } from './transform-commands';

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

describe('rotateLayerCommand', () => {
  it('turns quarter turns exactly about the layer centre', () => {
    const turns: [number, Orientation, { x: number; y: number }][] = [
      // A 3 × 2 layer at (5, 4) has its centre at (6.5, 5). Turned a quarter, its corners
      // reach (5.5, 3.5), so it's nudged half a pixel to (6, 4).
      [90, 'rotate-cw', { x: 6, y: 4 }],
      [-90, 'rotate-ccw', { x: 6, y: 4 }],
      [180, 'rotate-180', { x: 5, y: 4 }],
    ];
    for (const [degrees, orientation, at] of turns) {
      const doc = createDocument(12, 12);
      const layer = addLayer(doc, 5, 4, numbered(3, 2));
      const command = rotateLayerCommand(doc, layer.id, degrees, null);
      expect(command?.label).toBe('Rotate Layer');
      if (command) new Editor(doc).history.execute(command);
      const turned = orientPixels(orientation, numbered(3, 2).data, 3, 2, 4);
      expect({ ...placement(layer), data: layer.pixels.data }).toEqual({
        ...at,
        width: degrees === 180 ? 3 : 2,
        height: degrees === 180 ? 2 : 3,
        data: turned,
      });
    }
  });

  it('anti-aliases the edges of other angles and keeps the centre', () => {
    const doc = createDocument(40, 40);
    const pixels = createPixelBuffer(20, 10);
    fillRect(pixels, { x: 0, y: 0, width: 20, height: 10 }, [255, 0, 0, 255]);
    const layer = addLayer(doc, 10, 15, pixels);
    const command = rotateLayerCommand(doc, layer.id, 15, null);
    if (command) new Editor(doc).history.execute(command);
    // The 20 × 10 rect turned 15° about its centre (20, 20) reaches 10 cos 15° + 5 sin 15°
    // ≈ 10.95 across and 10 sin 15° + 5 cos 15° ≈ 7.42 down from it: (9.05, 12.58) to
    // (30.95, 27.42). Shifted to start on (9, 13), it ends at (30.91, 27.84): 22 × 15 pixels.
    expect(placement(layer)).toEqual({ x: 9, y: 13, width: 22, height: 15 });
    expect(getPixel(layer.pixels, 11, 7)).toEqual([255, 0, 0, 255]);
    const { data } = layer.pixels;
    let partial = 0;
    const darkened: number[] = [];
    for (let i = 0; i < data.length; i += 4) {
      if (data[i + 3] > 0 && data[i + 3] < 255) partial++;
      // Edges fade to transparent without darkening: visible pixels stay pure red.
      const [r, g, b] = data[i + 3] === 0 ? [0, 0, 0] : [255, 0, 0];
      if (data[i] !== r || data[i + 1] !== g || data[i + 2] !== b) darkened.push(i / 4);
    }
    expect(partial).toBeGreaterThan(0);
    expect(darkened).toEqual([]);
  });

  it('refuses whole turns, hidden layers and missing ones', () => {
    const doc = createDocument(8, 8);
    const layer = addLayer(doc, 0, 0, numbered(2, 2));
    for (const degrees of [0, 360, -720, Number.NaN]) {
      expect(rotateLayerCommand(doc, layer.id, degrees, null)).toBeNull();
    }
    expect(rotateLayerCommand(doc, 'nope', 10, null)).toBeNull();
    layer.visible = false;
    expect(rotateLayerCommand(doc, layer.id, 10, null)).toBeNull();
  });
});

describe('TransformLayerCommand', () => {
  it('undoes to the very same pixels and position, and redoes without resampling again', () => {
    const doc = createDocument(10, 10);
    const original = numbered(3, 2);
    const copy = clonePixelBuffer(original);
    const layer = addLayer(doc, 2, 3, original);
    const editor = new Editor(doc);
    const command = rotateLayerCommand(doc, layer.id, 30, null);
    if (!command) throw new Error('Nothing to rotate');
    editor.history.execute(command);
    const rotated = layer.pixels;
    expect(rotated).not.toBe(original);
    expect(editor.isDirty).toBe(true);
    editor.history.undo();
    expect(layer.pixels).toBe(original);
    expect(layer.pixels.data).toEqual(copy.data);
    expect([layer.x, layer.y]).toEqual([2, 3]);
    editor.history.redo();
    expect(layer.pixels).toBe(rotated);
  });

  it('reports the old and new bounds and the layer’s pixels', () => {
    const doc = createDocument(10, 10);
    const layer = addLayer(doc, 2, 3, numbered(3, 2));
    const command = transformLayerCommand(doc, layer.id, translation(4, -2), 'nearest');
    expect(command?.label).toBe('Transform Layer');
    expect(command?.apply(doc)).toEqual({
      dirty: { x: 2, y: 1, width: 7, height: 4 },
      layerPixels: [{ layerId: layer.id, rect: null }],
    });
    expect(placement(layer)).toEqual({ x: 6, y: 1, width: 3, height: 2 });
    expect(layer.pixels.data).toEqual(numbered(3, 2).data);
  });

  it('refuses transforms that change nothing or flatten the layer', () => {
    const doc = createDocument(8, 8);
    const layer = addLayer(doc, 0, 0, numbered(2, 2));
    expect(transformLayerCommand(doc, layer.id, IDENTITY, 'bilinear')).toBeNull();
    expect(transformLayerCommand(doc, layer.id, scaling(0, 1), 'bilinear')).toBeNull();
    expect(transformLayerCommand(doc, 'nope', scaling(2), 'bilinear')).toBeNull();
  });

  it('keeps only the canvas when a layer would grow past the maximum size', () => {
    const doc = createDocument(10, 10);
    const pixels = createPixelBuffer(3000, 1);
    for (let x = 0; x < 3000; x++) pixels.data.set([x % 256, 0, 0, 255], x * 4);
    const layer = addLayer(doc, 0, 0, pixels);
    const command = transformLayerCommand(doc, layer.id, scaling(3), 'nearest');
    if (command) new Editor(doc).history.execute(command);
    // 9000 × 3 is too big, so just the canvas's part: source pixel x covers 3x to 3x + 2.
    expect(placement(layer)).toEqual({ x: 0, y: 0, width: 10, height: 3 });
    expect(getPixel(layer.pixels, 4, 2)).toEqual([1, 0, 0, 255]);
    expect(getPixel(layer.pixels, 9, 0)).toEqual([3, 0, 0, 255]);
  });
});

describe('Transforming a floating selection', () => {
  /**
   * An opaque 24 × 20 layer with a soft-edged elliptical selection lifted out of it and
   * moved one pixel right and down, as the Move tool leaves it.
   */
  function floatingSetUp() {
    const doc = createDocument(24, 20);
    const pixels = createPixelBuffer(24, 20);
    fillRect(pixels, { x: 0, y: 0, width: 24, height: 20 }, [30, 160, 90, 255]);
    const source = addLayer(doc, 0, 0, pixels);
    doc.selection = Selection.fromEllipse(24, 20, { x: 4, y: 3, width: 13, height: 9 });
    const editor = new Editor(doc);
    const lift = liftSelectionCommand(doc, source.id, false);
    if (!lift) throw new Error('Nothing to lift');
    editor.history.execute(lift);
    const lifted = editor.floating;
    const float = editor.activeLayer;
    if (!lifted || !float) throw new Error('Nothing floating');
    const moved = lifted.selection.translate(1, 1);
    editor.history.execute(
      new MoveLayerCommand(float.id, float.x + 1, float.y + 1, { selection: moved }),
    );
    return { doc, editor, float, moved };
  }

  /** Canvas pixels where the selection's coverage isn't the floating layer's alpha. */
  function misaligned(doc: ImageDocument, float: RasterLayer): string[] {
    const wrong: string[] = [];
    for (let y = 0; y < doc.height; y++) {
      for (let x = 0; x < doc.width; x++) {
        const alpha = getPixel(float.pixels, x - float.x, y - float.y)[3];
        if ((doc.selection?.coverageAt(x, y) ?? 0) !== alpha) wrong.push(`${x},${y}`);
      }
    }
    return wrong;
  }

  it('turns the outline with the pixels, so coverage matches their alpha', () => {
    const { doc, editor, float } = floatingSetUp();
    // Lifted from opaque pixels, the floating layer's alpha is the selection's coverage.
    expect(misaligned(doc, float)).toEqual([]);
    const command = rotateLayerCommand(doc, float.id, 30, editor.floating);
    expect(command?.label).toBe('Rotate Selection');
    if (command) editor.history.execute(command);
    const floating = editor.floating;
    expect(floating?.edited).toBe(true);
    expect(floating?.selection).toBe(doc.selection);
    expect([floating?.x, floating?.y]).toEqual([float.x, float.y]);
    expect(misaligned(doc, float)).toEqual([]);
  });

  it('undoes the outline and the floating selection with the pixels', () => {
    const { doc, editor, float, moved } = floatingSetUp();
    const before = editor.floating;
    const pixels = float.pixels;
    const command = rotateLayerCommand(doc, float.id, -40, before);
    if (command) editor.history.execute(command);
    const after = editor.floating;
    const outline = doc.selection;
    editor.history.undo();
    expect(editor.floating).toBe(before);
    expect(doc.selection?.equals(moved)).toBe(true);
    expect(float.pixels).toBe(pixels);
    editor.history.redo();
    expect(editor.floating).toBe(after);
    expect(doc.selection).toBe(outline);
  });

  it('moves the turned outline from where it was turned', () => {
    const { doc, editor, float } = floatingSetUp();
    const command = rotateLayerCommand(doc, float.id, 30, editor.floating);
    if (command) editor.history.execute(command);
    const turned = doc.selection;
    const floating = editor.floating;
    if (!turned || !floating) throw new Error('Nothing floating');
    // As the Move tool moves it: from the floating selection's outline and position.
    const x = float.x + 2;
    const selection = floating.selection.translate(x - floating.x, float.y - floating.y);
    editor.history.execute(new MoveLayerCommand(float.id, x, float.y, { selection }));
    expect(doc.selection?.equals(turned.translate(2, 0))).toBe(true);
    expect(misaligned(doc, float)).toEqual([]);
  });
});
