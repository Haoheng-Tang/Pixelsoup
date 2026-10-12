import { describe, expect, it } from 'vitest';
import { createDocument, createLayerId } from '../document';
import type { EditorChange } from '../editor';
import { Editor } from '../editor';
import type { RasterLayer } from '../layer';
import { createRasterLayer } from '../layer';
import type { PixelBuffer, Rgb, Rgba } from '../pixel-buffer';
import { createPixelBuffer } from '../pixel-buffer';
import { Selection } from '../selection';
import type { FillMode, FillOptions } from './fill-commands';
import { ClearCommand, FillCommand, clearCommand, fillCommand } from './fill-commands';
import { liftSelectionCommand } from './float-commands';

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

/** An editor on a one-row document holding one layer with `pixels`, at `x` on the canvas. */
function setup(pixels: readonly Rgba[], canvasWidth = pixels.length, x = 0) {
  const doc = createDocument(canvasWidth, 1);
  const layer = createRasterLayer({
    id: createLayerId(doc),
    name: 'Photo',
    x,
    pixels: bufferOf(pixels.length, 1, pixels),
  });
  doc.layers.push(layer);
  const editor = new Editor(doc);
  const changes: EditorChange[] = [];
  editor.subscribe((change) => changes.push(change));
  return { doc, layer, editor, changes };
}

const RED: Rgb = [255, 0, 0];
const RED_PIXEL: Rgba = [255, 0, 0, 255];
const OPAQUE: Rgba = [100, 50, 200, 255];
const TRANSLUCENT: Rgba = [100, 50, 200, 128];
const CLEAR: Rgba = [0, 0, 0, 0];

/** Fills the editor's active layer through history; false if there was nothing to fill. */
function fill(
  editor: Editor,
  opacity = 1,
  mode: FillMode = 'normal',
  options: FillOptions = {},
): boolean {
  const command = fillCommand(editor.document, editor.activeLayerId ?? '', RED, opacity, mode, {
    floating: editor.floating,
    ...options,
  });
  if (command) editor.history.execute(command);
  return command !== null;
}

describe('FillCommand', () => {
  it('fills the whole layer without a selection', () => {
    const { layer, editor } = setup([OPAQUE, TRANSLUCENT, CLEAR]);
    expect(fill(editor)).toBe(true);
    expect(pixelsOf(layer.pixels)).toEqual([RED_PIXEL, RED_PIXEL, RED_PIXEL]);
    expect(editor.history.undoLabel).toBe('Fill');
  });

  it('puts the colour over each pixel at partial opacity', () => {
    const { layer, editor } = setup([OPAQUE, TRANSLUCENT, CLEAR]);
    fill(editor, 0.5);
    // With p = 0.5, alpha = 255p + a(1 − p) and each channel (255p·C + a(1 − p)·c) / alpha:
    // opaque: (255 + 100) / 2 = 177.5 → 178, 50 / 2 = 25, 200 / 2 = 100;
    // a = 128: alpha 191.5 → 192, red (32512.5 + 6400) / 191.5 → 203, green 3200 / 191.5
    // → 17, blue 12800 / 191.5 → 67; transparent: alpha 127.5 → 128, the colour alone.
    expect(pixelsOf(layer.pixels)).toEqual([
      [178, 25, 100, 255],
      [203, 17, 67, 192],
      [255, 0, 0, 128],
    ]);
  });

  it('weights each pixel by its selection coverage, times the opacity', () => {
    const { doc, layer, editor } = setup([OPAQUE, OPAQUE, OPAQUE, OPAQUE]);
    doc.selection = Selection.fromMask(4, 1, [255, 128, 64, 0]);
    fill(editor);
    // p = 128/255: red (255·128 + 100·127) / 255 = 177.8, green 50·127/255 = 24.9, blue
    // 200·127/255 = 99.6; p = 64/255: (255·64 + 100·191) / 255 = 138.9, 37.5, 149.8.
    expect(pixelsOf(layer.pixels)).toEqual([
      RED_PIXEL,
      [178, 25, 100, 255],
      [139, 37, 150, 255],
      OPAQUE,
    ]);

    editor.history.undo();
    fill(editor, 0.5);
    // p = 128/255 × 0.5 = 0.25098: red 100 + 155p = 138.90, green 50(1 − p) = 37.45,
    // blue 200(1 − p) = 149.80.
    expect(pixelsOf(layer.pixels)[1]).toEqual([139, 37, 150, 255]);
    // p = 0.5 where fully selected.
    expect(pixelsOf(layer.pixels)[0]).toEqual([178, 25, 100, 255]);
  });

  it('multiplies a region by the selection', () => {
    const { doc, layer, editor } = setup([OPAQUE, OPAQUE, OPAQUE, OPAQUE]);
    doc.selection = Selection.fromMask(4, 1, [128, 255, 255, 128]);
    const region = Selection.fromMask(4, 1, [255, 64, 0, 128]);
    fill(editor, 1, 'normal', { region, label: 'Paint Bucket' });
    // p = 128/255 and 64/255 as above; nothing where the region is 0; and where both are
    // 128, p = 128 × 128 / 255² = 0.25197: 100 + 155p = 139.05, 50(1 − p) = 37.40,
    // 200(1 − p) = 149.61.
    expect(pixelsOf(layer.pixels)).toEqual([
      [178, 25, 100, 255],
      [139, 37, 150, 255],
      OPAQUE,
      [139, 37, 150, 255],
    ]);
    expect(editor.history.undoLabel).toBe('Paint Bucket');
  });

  it('keeps the alpha when preserving transparency', () => {
    const { layer, editor } = setup([OPAQUE, TRANSLUCENT, [9, 8, 7, 0]]);
    fill(editor, 0.5, 'preserve-transparency');
    // Each channel moves halfway: (255 + 100) / 2 = 177.5 → 178, 25, 100.
    expect(pixelsOf(layer.pixels)).toEqual([
      [178, 25, 100, 255],
      [178, 25, 100, 128],
      [9, 8, 7, 0],
    ]);
    fill(editor, 1, 'preserve-transparency');
    expect(pixelsOf(layer.pixels)).toEqual([RED_PIXEL, [255, 0, 0, 128], [9, 8, 7, 0]]);
  });

  it('restores the exact pixels on undo, and fills them again on redo', () => {
    const size = 50;
    const doc = createDocument(size, size);
    const pixels = createPixelBuffer(size, size);
    for (let i = 0; i < pixels.data.length; i++) pixels.data[i] = (i * 37 + 11) % 256;
    const layer = createRasterLayer({ id: createLayerId(doc), name: 'Noise', pixels });
    doc.layers.push(layer);
    doc.selection = Selection.fromEllipse(size, size, { x: 5, y: 5, width: 40, height: 30 });
    const editor = new Editor(doc);
    const original = pixels.data.slice();

    for (const mode of ['normal', 'preserve-transparency'] as const) {
      fill(editor, 0.7, mode);
      const filled = layer.pixels.data.slice();
      expect(filled).not.toEqual(original);
      editor.history.undo();
      expect(layer.pixels.data).toEqual(original);
      editor.history.redo();
      expect(layer.pixels.data).toEqual(filled);
      editor.history.undo();
    }
    // Nothing outside the selection's bounds changed.
    fill(editor);
    expect(layer.pixels.data.subarray(0, size * 4 * 5)).toEqual(original.subarray(0, size * 4 * 5));
  });

  it('reports the area it fills, in the layer and on the canvas', () => {
    const { doc, layer, editor, changes } = setup([OPAQUE, OPAQUE, OPAQUE, OPAQUE], 6, 1);
    doc.selection = Selection.fromMask(6, 1, [0, 0, 255, 255, 0, 0]);
    fill(editor);
    const change = { dirty: { x: 2, y: 0, width: 2, height: 1 } };
    const rect = { x: 1, y: 0, width: 2, height: 1 };
    expect(changes.at(-1)).toMatchObject({ ...change, layerPixels: [{ layerId: layer.id, rect }] });
    expect(changes.at(-1)?.floating).toBeUndefined();
    editor.history.undo();
    expect(changes.at(-1)).toMatchObject({ ...change, layerPixels: [{ layerId: layer.id, rect }] });
  });

  it('grows the layer to take in the fill, and undo puts it back', () => {
    const blue: Rgba = [0, 0, 255, 255];
    const { doc, layer, editor, changes } = setup([blue, blue], 6, 2);
    const before = layer.pixels;
    doc.selection = Selection.fromMask(6, 1, [0, 0, 0, 255, 255, 0]);
    fill(editor);
    expect([layer.x, layer.pixels.width]).toEqual([2, 3]);
    expect(pixelsOf(layer.pixels)).toEqual([blue, RED_PIXEL, RED_PIXEL]);
    expect(changes.at(-1)).toMatchObject({
      dirty: { x: 3, y: 0, width: 2, height: 1 },
      layerPixels: [{ layerId: layer.id, rect: null }],
    });

    editor.history.undo();
    expect(layer.pixels).toBe(before);
    expect([layer.x, layer.y]).toEqual([2, 0]);
    expect(pixelsOf(layer.pixels)).toEqual([blue, blue]);
    expect(changes.at(-1)?.layerPixels).toEqual([{ layerId: layer.id, rect: null }]);
    editor.history.redo();
    expect([layer.x, layer.pixels.width]).toEqual([2, 3]);
    expect(pixelsOf(layer.pixels)).toEqual([blue, RED_PIXEL, RED_PIXEL]);
  });

  it('grows the layer to the canvas without a selection, or when it would get too big', () => {
    const blue: Rgba = [0, 0, 255, 255];
    const small = setup([blue], 3, 1);
    fill(small.editor, 0.5);
    expect([small.layer.x, small.layer.pixels.width]).toEqual([0, 3]);
    expect(pixelsOf(small.layer.pixels)).toEqual([
      [255, 0, 0, 128],
      [128, 0, 128, 255],
      [255, 0, 0, 128],
    ]);

    // Far off the canvas's left edge, taking in the fill would make the layer 8300 px
    // wide, so it becomes the canvas instead.
    const far = setup(new Array<Rgba>(200).fill(blue), 100, -8200);
    const before = far.layer.pixels;
    fill(far.editor);
    expect([far.layer.x, far.layer.pixels.width]).toEqual([0, 100]);
    expect(pixelsOf(far.layer.pixels).every((p) => p.join() === RED_PIXEL.join())).toBe(true);
    far.editor.history.undo();
    expect(far.layer.pixels).toBe(before);
    expect(far.layer.x).toBe(-8200);
  });

  it("doesn't grow the layer when preserving transparency", () => {
    const { layer, editor, changes } = setup([OPAQUE, OPAQUE], 6, 2);
    fill(editor, 1, 'preserve-transparency');
    expect([layer.x, layer.pixels.width]).toEqual([2, 2]);
    expect(pixelsOf(layer.pixels)).toEqual([RED_PIXEL, RED_PIXEL]);
    expect(changes.at(-1)?.dirty).toEqual({ x: 2, y: 0, width: 2, height: 1 });
  });

  it('is null when it would change nothing', () => {
    const { doc, layer } = setup([OPAQUE, OPAQUE, OPAQUE, OPAQUE], 6, 2);
    expect(fillCommand(doc, layer.id, RED, 1, 'normal')).toBeInstanceOf(FillCommand);
    expect(fillCommand(doc, 'missing', RED, 1, 'normal')).toBeNull();
    expect(fillCommand(doc, layer.id, RED, 0, 'normal')).toBeNull();
    expect(fillCommand(doc, layer.id, RED, 0.00001, 'normal')).toBeNull();
    layer.visible = false;
    expect(fillCommand(doc, layer.id, RED, 1, 'normal')).toBeNull();
    layer.visible = true;

    // A selection beside the layer: a normal fill grows it, a preserving one has nothing.
    doc.selection = Selection.fromMask(6, 1, [255, 255, 0, 0, 0, 0]);
    expect(fillCommand(doc, layer.id, RED, 1, 'normal')).not.toBeNull();
    expect(fillCommand(doc, layer.id, RED, 1, 'preserve-transparency')).toBeNull();
    // A region that misses the selection.
    const region = Selection.fromMask(6, 1, [0, 0, 0, 0, 255, 0]);
    expect(fillCommand(doc, layer.id, RED, 1, 'normal', { region })).toBeNull();
    expect(() =>
      fillCommand(doc, layer.id, RED, 1, 'normal', { region: Selection.selectAll(5, 1) }),
    ).toThrow(RangeError);
  });
});

describe('ClearCommand', () => {
  it('clears the selected pixels, weighted by coverage', () => {
    const { doc, layer, editor } = setup([OPAQUE, OPAQUE, OPAQUE, OPAQUE, TRANSLUCENT]);
    doc.selection = Selection.fromMask(5, 1, [255, 128, 64, 0, 128]);
    const command = clearCommand(doc, layer.id);
    expect(command).toBeInstanceOf(ClearCommand);
    editor.history.execute(command!);
    // 255 × (1 − 128/255) = 127, 255 × (1 − 64/255) = 191, 128 × 127/255 = 63.75 → 64.
    expect(pixelsOf(layer.pixels)).toEqual([
      CLEAR,
      [100, 50, 200, 127],
      [100, 50, 200, 191],
      OPAQUE,
      [100, 50, 200, 64],
    ]);
    expect(editor.history.undoLabel).toBe('Clear');
  });

  it('restores the exact pixels on undo and clears them again on redo', () => {
    const { doc, layer, editor, changes } = setup([OPAQUE, TRANSLUCENT, OPAQUE, OPAQUE], 6, 1);
    doc.selection = Selection.fromMask(6, 1, [255, 255, 200, 0, 0, 0]);
    editor.history.execute(clearCommand(doc, layer.id)!);
    const cleared = pixelsOf(layer.pixels);
    expect(cleared).toEqual([CLEAR, [100, 50, 200, 28], OPAQUE, OPAQUE]);
    const change = {
      dirty: { x: 1, y: 0, width: 2, height: 1 },
      layerPixels: [{ layerId: layer.id, rect: { x: 0, y: 0, width: 2, height: 1 } }],
    };
    expect(changes.at(-1)).toMatchObject(change);

    editor.history.undo();
    expect(pixelsOf(layer.pixels)).toEqual([OPAQUE, TRANSLUCENT, OPAQUE, OPAQUE]);
    expect(changes.at(-1)).toMatchObject(change);
    editor.history.redo();
    expect(pixelsOf(layer.pixels)).toEqual(cleared);
  });

  it('is null without a selection, or where it would clear nothing', () => {
    const { doc, layer } = setup([OPAQUE, OPAQUE], 6, 2);
    expect(clearCommand(doc, layer.id)).toBeNull();
    doc.selection = Selection.fromMask(6, 1, [255, 255, 0, 0, 0, 0]);
    expect(clearCommand(doc, layer.id)).toBeNull();
    doc.selection = Selection.fromMask(6, 1, [0, 255, 255, 0, 0, 0]);
    expect(clearCommand(doc, layer.id)).not.toBeNull();
    expect(clearCommand(doc, 'missing')).toBeNull();
    layer.visible = false;
    expect(clearCommand(doc, layer.id)).toBeNull();
  });
});

describe('filling and clearing a floating selection', () => {
  const grey: Rgba = [128, 128, 128, 255];

  function floatingSetup() {
    const { doc, editor, layer } = setup([grey, grey, grey]);
    doc.selection = Selection.fromMask(3, 1, [255, 255, 0]);
    editor.history.execute(liftSelectionCommand(doc, layer.id)!);
    const floating = editor.floating;
    if (!floating) throw new Error('Nothing floating');
    return { doc, editor, source: layer, floating };
  }

  it('fills it within its bounds and marks it edited, so committing keeps the fill', () => {
    const { doc, editor, source, floating } = floatingSetup();
    // Without the selection the fill would cover the canvas; the float doesn't grow.
    doc.selection = null;
    expect(fill(editor)).toBe(true);
    const float = editor.activeLayer as RasterLayer;
    expect(float.id).toBe(floating.layerId);
    expect([float.x, float.pixels.width]).toEqual([0, 2]);
    expect(editor.floating).toMatchObject({ layerId: floating.layerId, edited: true });
    expect(editor.commitFloating()).toBe(true);
    expect(pixelsOf(source.pixels)).toEqual([RED_PIXEL, RED_PIXEL, grey]);

    editor.history.undo();
    editor.history.undo();
    expect(editor.floating).toBe(floating);
  });

  it('clears it and marks it edited, so committing leaves the hole', () => {
    const { doc, editor, source, floating } = floatingSetup();
    editor.history.execute(clearCommand(doc, floating.layerId, editor.floating)!);
    expect(editor.floating).toMatchObject({ edited: true });
    expect(editor.commitFloating()).toBe(true);
    expect(pixelsOf(source.pixels)).toEqual([CLEAR, CLEAR, grey]);

    editor.history.undo();
    editor.history.undo();
    // Unedited again, so committing restores the source exactly.
    expect(editor.floating).toBe(floating);
    expect(editor.commitFloating()).toBe(true);
    expect(pixelsOf(source.pixels)).toEqual([grey, grey, grey]);
  });
});
