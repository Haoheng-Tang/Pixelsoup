import { describe, expect, it } from 'vitest';
import { createDocument, createLayerId } from '../document';
import { Editor } from '../editor';
import type { EditorChange } from '../editor';
import type { RasterLayer } from '../layer';
import { createRasterLayer } from '../layer';
import type { Dab } from '../paint/dab';
import { DabPlacer } from '../paint/dab-placer';
import type { PixelBuffer, Rgba } from '../pixel-buffer';
import { createPixelBuffer } from '../pixel-buffer';
import { Selection } from '../selection';
import { liftSelectionCommand } from './float-commands';
import type { PaintStroke, StrokeStyle } from './stroke-commands';
import { beginStroke, StrokeCommand, strokeCommand } from './stroke-commands';

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

const RED_HALF: StrokeStyle = { mode: 'paint', color: [255, 0, 0], opacity: 0.5, hardness: 1 };

/** A hard dab centred on pixel `x` of the row, `size` pixels across: wholly covers those. */
function dab(x: number, size = 40): Dab {
  return { x: x + 0.5, y: 0.5, size, strength: 1 };
}

function start(editor: Editor, style: Partial<StrokeStyle> = {}): PaintStroke {
  const stroke = beginStroke(
    editor.document,
    editor.activeLayerId ?? '',
    { ...RED_HALF, ...style },
    editor.floating,
  );
  if (!stroke) throw new Error('Nothing to paint');
  return stroke;
}

/** Runs one step of `stroke` through history; false if the dabs changed nothing. */
function step(editor: Editor, stroke: PaintStroke, dabs: readonly Dab[]): boolean {
  const command = strokeCommand(stroke, dabs);
  if (command) editor.history.execute(command);
  return command !== null;
}

/** Paints a one-step stroke covering the whole row. */
function paintAll(editor: Editor, style: Partial<StrokeStyle> = {}): PaintStroke {
  const stroke = start(editor, style);
  step(editor, stroke, [dab(2)]);
  return stroke;
}

const OPAQUE: Rgba = [100, 50, 200, 255];
const TRANSLUCENT: Rgba = [100, 50, 200, 128];
const CLEAR: Rgba = [0, 0, 0, 0];

describe('brush strokes', () => {
  it('paint over opaque, translucent and transparent pixels', () => {
    const { layer, editor } = setup([OPAQUE, TRANSLUCENT, CLEAR]);
    paintAll(editor);
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

  it('weight each pixel by its selection coverage', () => {
    const { doc, layer, editor } = setup([OPAQUE, OPAQUE, OPAQUE, OPAQUE]);
    doc.selection = Selection.fromMask(4, 1, [255, 128, 64, 0]);
    paintAll(editor, { opacity: 1 });
    // p = 128/255: red (255·128 + 100·127) / 255 = 177.8, green 50·127/255 = 24.9, blue
    // 200·127/255 = 99.6; p = 64/255: (255·64 + 100·191) / 255 = 138.9, 37.5, 149.8.
    expect(pixelsOf(layer.pixels)).toEqual([
      [255, 0, 0, 255],
      [178, 25, 100, 255],
      [139, 37, 150, 255],
      OPAQUE,
    ]);
  });

  it("don't build up where a stroke's dabs overlap, but strokes do", () => {
    const white: Rgba = [255, 255, 255, 255];
    const { layer, editor } = setup([white, white, white]);
    const stroke = start(editor);
    // Dabs 2 px across on the edges between pixels 0 and 1, then 1 and 2: pixel 1 is
    // covered twice, fully each time.
    expect(step(editor, stroke, [dab(0.5, 2), dab(1.5, 2)])).toBe(true);
    expect(pixelsOf(layer.pixels)).toEqual([
      [255, 128, 128, 255],
      [255, 128, 128, 255],
      [255, 128, 128, 255],
    ]);
    // The mask is already full there, so going over it again changes nothing.
    expect(step(editor, stroke, [dab(1)])).toBe(false);
    // A new stroke paints over the last one: 128 / 2 = 64.
    paintAll(editor);
    expect(pixelsOf(layer.pixels)[1]).toEqual([255, 64, 64, 255]);
  });

  it('are one undo step, which restores the exact pixels, and redo paints them again', () => {
    const size = 70;
    const doc = createDocument(size, size);
    const pixels = createPixelBuffer(size, size);
    for (let i = 0; i < pixels.data.length; i++) pixels.data[i] = (i * 37 + 11) % 256;
    const layer = createRasterLayer({ id: createLayerId(doc), name: 'Noise', pixels });
    doc.layers.push(layer);
    doc.selection = Selection.fromEllipse(size, size, { x: 5, y: 5, width: 60, height: 60 });
    const editor = new Editor(doc);
    const original = pixels.data.slice();

    const stroke = start(editor, { hardness: 0, opacity: 0.7 });
    const placer = new DabPlacer(30, null);
    const samples = [
      { x: 10, y: 20, pressure: 1 },
      { x: 60, y: 30, pressure: 1 },
      { x: 20, y: 66, pressure: 1 },
    ];
    for (const sample of samples) step(editor, stroke, placer.add(sample));
    const painted = layer.pixels.data.slice();
    expect(painted).not.toEqual(original);
    expect(editor.history.undoLabel).toBe('Brush Stroke');

    expect(editor.history.undo()).toBe(true);
    expect(editor.history.canUndo).toBe(false);
    expect(layer.pixels.data).toEqual(original);
    expect(editor.history.redo()).toBe(true);
    expect(layer.pixels.data).toEqual(painted);
    // Nothing outside the selection changed.
    expect(layer.pixels.data.subarray(0, size * 4 * 5)).toEqual(original.subarray(0, size * 4 * 5));
  });

  it('report the area they paint, in the layer and on the canvas', () => {
    const { layer, editor, changes } = setup([OPAQUE, OPAQUE, OPAQUE, OPAQUE], 6, 1);
    paintAll(editor);
    expect(changes.at(-1)).toMatchObject({
      dirty: { x: 0, y: 0, width: 6, height: 1 },
      layerPixels: [{ layerId: layer.id, rect: null }],
    });
    editor.history.undo();
    expect(changes.at(-1)).toMatchObject({
      dirty: { x: 0, y: 0, width: 6, height: 1 },
      layerPixels: [{ layerId: layer.id, rect: null }],
    });
  });

  it('report the layer-space rect they change inside the layer', () => {
    const { layer, editor, changes } = setup([OPAQUE, OPAQUE, OPAQUE, OPAQUE], 6, 1);
    const stroke = start(editor);
    step(editor, stroke, [dab(2.5, 2)]);
    expect(changes.at(-1)).toMatchObject({
      dirty: { x: 2, y: 0, width: 2, height: 1 },
      layerPixels: [{ layerId: layer.id, rect: { x: 1, y: 0, width: 2, height: 1 } }],
    });
    expect(changes.at(-1)?.floating).toBeUndefined();
  });

  it('grow the layer to take in paint past its edges, and undo puts it back', () => {
    const blue: Rgba = [0, 0, 255, 255];
    const red: Rgba = [255, 0, 0, 255];
    const { layer, editor } = setup([blue, blue], 6, 2);
    const before = layer.pixels;
    const stroke = start(editor, { opacity: 1 });
    // Inside the layer first, then past its right edge.
    step(editor, stroke, [dab(2.5, 2)]);
    expect(layer.pixels).toBe(before);
    step(editor, stroke, [dab(4.5, 2)]);
    expect([layer.x, layer.pixels.width]).toEqual([2, 4]);
    expect(pixelsOf(layer.pixels)).toEqual([red, red, red, red]);

    editor.history.undo();
    expect(layer.pixels).toBe(before);
    expect([layer.x, layer.y]).toEqual([2, 0]);
    expect(pixelsOf(layer.pixels)).toEqual([blue, blue]);
    editor.history.redo();
    expect([layer.x, layer.pixels.width]).toEqual([2, 4]);
    expect(pixelsOf(layer.pixels)).toEqual([red, red, red, red]);
  });

  it('grow a layer to the canvas when it would get too big, and undo puts it back', () => {
    const blue: Rgba = [0, 0, 255, 255];
    // The layer lies far off the canvas's left edge: taking in the stroke would make it
    // 8204 px wide, so it becomes the canvas instead.
    const { layer, editor } = setup(new Array<Rgba>(200).fill(blue), 100, -8200);
    const before = layer.pixels;
    paintAll(editor, { opacity: 1 });
    expect([layer.x, layer.y, layer.pixels.width, layer.pixels.height]).toEqual([0, 0, 100, 1]);
    expect(pixelsOf(layer.pixels).slice(0, 2)).toEqual([
      [255, 0, 0, 255],
      [255, 0, 0, 255],
    ]);
    editor.history.undo();
    expect(layer.pixels).toBe(before);
    expect(layer.x).toBe(-8200);
    expect(pixelsOf(layer.pixels)[199]).toEqual(blue);
  });

  it('start only on a visible layer, with some opacity', () => {
    const { doc, layer, editor } = setup([OPAQUE]);
    expect(beginStroke(doc, 'nope', RED_HALF, null)).toBeNull();
    expect(beginStroke(doc, layer.id, { ...RED_HALF, opacity: 0 }, null)).toBeNull();
    layer.visible = false;
    expect(beginStroke(doc, layer.id, RED_HALF, null)).toBeNull();
    layer.visible = true;
    expect(beginStroke(doc, layer.id, RED_HALF, editor.floating)).not.toBeNull();
  });
});

describe('eraser strokes', () => {
  it('scale alpha down, leaving fully erased pixels transparent black', () => {
    const { layer, editor } = setup([OPAQUE, TRANSLUCENT, CLEAR]);
    paintAll(editor, { mode: 'erase' });
    // 255 / 2 = 127.5 → 128, 128 / 2 = 64.
    expect(pixelsOf(layer.pixels)).toEqual([[100, 50, 200, 128], [100, 50, 200, 64], CLEAR]);
    paintAll(editor, { mode: 'erase', opacity: 1 });
    expect(pixelsOf(layer.pixels)).toEqual([CLEAR, CLEAR, CLEAR]);
  });

  it('weight by selection coverage', () => {
    const { doc, layer, editor } = setup([OPAQUE, OPAQUE, OPAQUE]);
    doc.selection = Selection.fromMask(3, 1, [64, 128, 0]);
    paintAll(editor, { mode: 'erase', opacity: 1 });
    // 255 × (1 − 64/255) = 191, 255 × (1 − 128/255) = 127.
    expect(pixelsOf(layer.pixels)).toEqual([[100, 50, 200, 191], [100, 50, 200, 127], OPAQUE]);
  });

  it("never grow the layer, and don't start where there's nothing to erase", () => {
    const { doc, layer, editor, changes } = setup([OPAQUE, OPAQUE], 6, 2);
    paintAll(editor, { mode: 'erase', opacity: 1 });
    expect([layer.x, layer.pixels.width]).toEqual([2, 2]);
    expect(pixelsOf(layer.pixels)).toEqual([CLEAR, CLEAR]);
    expect(changes.at(-1)?.dirty).toEqual({ x: 2, y: 0, width: 2, height: 1 });

    doc.selection = Selection.fromMask(6, 1, [255, 255, 0, 0, 0, 0]);
    const erase: StrokeStyle = { ...RED_HALF, mode: 'erase' };
    expect(beginStroke(doc, layer.id, erase, null)).toBeNull();
    // The brush would grow the layer to reach the selection.
    expect(beginStroke(doc, layer.id, RED_HALF, null)).not.toBeNull();
  });
});

describe('strokes on a floating selection', () => {
  const grey: Rgba = [128, 128, 128, 255];
  const red: Rgba = [255, 0, 0, 255];

  function floatingSetup() {
    const { doc, editor, layer } = setup([grey, grey, grey]);
    doc.selection = Selection.fromMask(3, 1, [255, 255, 0]);
    const lift = liftSelectionCommand(doc, layer.id);
    if (!lift) throw new Error('Nothing to lift');
    editor.history.execute(lift);
    const floating = editor.floating;
    if (!floating) throw new Error('Nothing floating');
    return { doc, editor, source: layer, floating };
  }

  it('mark it edited, so committing it in place keeps the paint', () => {
    const { editor, source, floating } = floatingSetup();
    paintAll(editor, { opacity: 1 });
    expect(editor.floating).toMatchObject({ layerId: floating.layerId, edited: true });
    expect(editor.commitFloating()).toBe(true);
    expect(pixelsOf(source.pixels)).toEqual([red, red, grey]);

    editor.history.undo();
    editor.history.undo();
    expect(editor.floating).toBe(floating);
    // Unedited again, so committing restores the source exactly.
    expect(editor.commitFloating()).toBe(true);
    expect(pixelsOf(source.pixels)).toEqual([grey, grey, grey]);
  });

  it("don't grow it", () => {
    const { editor, floating } = floatingSetup();
    paintAll(editor, { opacity: 1 });
    const float = editor.activeLayer as RasterLayer;
    expect(float.id).toBe(floating.layerId);
    expect([float.x, float.pixels.width]).toEqual([0, 2]);
    expect(pixelsOf(float.pixels)).toEqual([red, red]);
  });
});

describe('StrokeCommand', () => {
  it('merges only steps of the same stroke', () => {
    const { editor } = setup([OPAQUE, OPAQUE]);
    const stroke = start(editor);
    const other = start(editor);
    const first = new StrokeCommand(stroke, { x: 0, y: 0, width: 1, height: 1 });
    expect(first.mergeWith(new StrokeCommand(stroke, { x: 1, y: 0, width: 1, height: 1 }))).toBe(
      true,
    );
    expect(first.mergeWith(new StrokeCommand(other, { x: 1, y: 0, width: 1, height: 1 }))).toBe(
      false,
    );
    expect(first.mergeKey).not.toBe(new StrokeCommand(other, first.area).mergeKey);
  });
});
