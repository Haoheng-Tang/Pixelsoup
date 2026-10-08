import { describe, expect, it } from 'vitest';
import { createDocument, createLayerId } from '../document';
import { Editor } from '../editor';
import type { FloatingSelection } from '../floating-selection';
import { FLOATING_LAYER_NAME } from '../floating-selection';
import type { RasterLayer } from '../layer';
import { createRasterLayer } from '../layer';
import type { PixelBuffer, Rgba } from '../pixel-buffer';
import { createPixelBuffer } from '../pixel-buffer';
import { Selection } from '../selection';
import {
  CommitFloatingCommand,
  commitFloatingCommand,
  LiftSelectionCommand,
  liftSelectionCommand,
} from './float-commands';
import { MoveLayerCommand } from './move-commands';

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

/** The first index at which two byte arrays differ, or -1; much quicker than toEqual. */
function firstDifference(a: Uint8ClampedArray, b: Uint8ClampedArray): number {
  if (a.length !== b.length) return Math.min(a.length, b.length);
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return i;
  return -1;
}

/**
 * An editor on a document the size of `pixels` (one row of them unless `width` is
 * given) holding one layer, the source, and a selection with the given coverage.
 */
function setup(pixels: readonly Rgba[], coverage: readonly number[], width = pixels.length) {
  const height = pixels.length / width;
  const doc = createDocument(width, height);
  const source = createRasterLayer({
    id: createLayerId(doc),
    name: 'Photo',
    pixels: bufferOf(width, height, pixels),
  });
  doc.layers.push(source);
  doc.selection = Selection.fromMask(width, height, coverage);
  return { doc, source, editor: new Editor(doc) };
}

/** Lifts (or copies) the active layer's selected pixels; returns the floating layer. */
function lift(editor: Editor, copy = false): RasterLayer {
  const command = liftSelectionCommand(editor.document, editor.activeLayerId ?? '', copy);
  if (!command) throw new Error('Nothing to lift');
  editor.history.execute(command);
  const float = editor.activeLayer;
  if (!float || float.id !== editor.floating?.layerId) throw new Error('Lift did not float');
  return float;
}

/** Moves the floating layer to (x, y), its selection along with it, as the Move tool does. */
function moveFloat(editor: Editor, x: number, y: number): void {
  const floating = editor.floating;
  if (!floating) throw new Error('Nothing floating');
  const selection = floating.selection.translate(x - floating.x, y - floating.y);
  editor.history.execute(new MoveLayerCommand(floating.layerId, x, y, { selection }));
}

// Pixels at full, zero and partial (128) coverage, plus a transparent pixel and one too
// faint to lift any of.
const SOURCE: Rgba[] = [
  [200, 100, 50, 255],
  [10, 20, 30, 255],
  [90, 80, 70, 255],
  [40, 50, 60, 200],
  [7, 7, 7, 0],
  [1, 2, 3, 1],
];
const COVERAGE = [255, 0, 128, 128, 255, 100];
const LIFTED = [
  [200, 100, 50, 255], // all of it
  [0, 0, 0, 0], // not selected
  [90, 80, 70, 128], // 255 × 128/255 = 128
  [40, 50, 60, 100], // 200 × 128/255 = 100.4
  [0, 0, 0, 0], // nothing to lift
  [0, 0, 0, 0], // 1 × 100/255 = 0.39 rounds to 0
];
const REMAINING = [
  [0, 0, 0, 0], // all lifted
  [10, 20, 30, 255],
  [90, 80, 70, 127], // 255 − 128 (= 255 × 127/255)
  [40, 50, 60, 100], // 200 − 100 (= 200 × 127/255 = 99.6, rounded)
  [7, 7, 7, 0],
  [1, 2, 3, 1],
];

describe('LiftSelectionCommand', () => {
  it('cuts the selected pixels into a floating layer above the source, weighted by coverage', () => {
    const { doc, source } = setup(SOURCE, COVERAGE);
    const command = new LiftSelectionCommand(source.id, 'float');
    const change = command.apply(doc);

    expect(doc.layers.map((l) => l.id)).toEqual([source.id, 'float']);
    const float = doc.layers[1];
    expect(float).toMatchObject({ name: FLOATING_LAYER_NAME, x: 0, y: 0, opacity: 1 });
    expect(float.visible).toBe(true);
    expect(pixelsOf(float.pixels)).toEqual(LIFTED);
    expect(pixelsOf(source.pixels)).toEqual(REMAINING);
    expect(command.label).toBe('Lift Selection');

    const area = { x: 0, y: 0, width: 6, height: 1 };
    expect(change).toEqual({
      dirty: area,
      layerPixels: [{ layerId: source.id, rect: area }],
      floating: expect.objectContaining({
        layerId: 'float',
        sourceId: source.id,
        selection: doc.selection,
        x: 0,
        y: 0,
      }) as FloatingSelection,
    });
  });

  it('copies instead, leaving the source untouched', () => {
    const { doc, source } = setup(SOURCE, COVERAGE);
    const command = new LiftSelectionCommand(source.id, 'float', true);
    const change = command.apply(doc);
    expect(pixelsOf(doc.layers[1].pixels)).toEqual(LIFTED);
    expect(pixelsOf(source.pixels)).toEqual(SOURCE);
    expect(command.label).toBe('Copy Selection');
    expect(change.layerPixels).toBeUndefined();
    expect(change.floating?.before).toBeNull();
  });

  it('puts back the exact bytes on undo, and cuts the same again on redo', () => {
    const { doc, source, editor } = setup(SOURCE, COVERAGE);
    const original = source.pixels.data.slice();
    const float = lift(editor);

    editor.history.undo();
    expect(source.pixels.data).toEqual(original);
    expect(doc.layers).toEqual([source]);
    expect(editor.floating).toBeNull();

    editor.history.redo();
    expect(doc.layers).toEqual([source, float]);
    expect(pixelsOf(float.pixels)).toEqual(LIFTED);
    expect(pixelsOf(source.pixels)).toEqual(REMAINING);
  });

  it('lifts from an offset layer the selection only partly covers', () => {
    const doc = createDocument(6, 4);
    const source = createRasterLayer({
      id: createLayerId(doc),
      name: 'L',
      x: 2,
      y: 1,
      width: 3,
      height: 2,
    });
    source.pixels.data.fill(255);
    doc.layers.push(source);
    doc.selection = Selection.fromRect(6, 4, { x: 1, y: 0, width: 3, height: 3 });

    const change = new LiftSelectionCommand(source.id, 'float').apply(doc);
    const float = doc.layers[1];
    // The float covers the selection; only its part over the layer has pixels.
    expect([float.x, float.y, float.pixels.width, float.pixels.height]).toEqual([1, 0, 3, 3]);
    const clear = [0, 0, 0, 0];
    const white = [255, 255, 255, 255];
    expect(pixelsOf(float.pixels)).toEqual([
      clear,
      clear,
      clear,
      clear,
      white,
      white,
      clear,
      white,
      white,
    ]);
    expect(pixelsOf(source.pixels)).toEqual([clear, clear, white, clear, clear, white]);
    expect(change.layerPixels).toEqual([
      { layerId: source.id, rect: { x: 0, y: 0, width: 2, height: 2 } },
    ]);
    expect(change.dirty).toEqual({ x: 1, y: 0, width: 3, height: 3 });
  });
});

describe('liftSelectionCommand', () => {
  it('is null without a selection, a layer, or overlap between them', () => {
    const doc = createDocument(10, 10);
    const layer = createRasterLayer({ id: createLayerId(doc), name: 'L', width: 4, height: 4 });
    doc.layers.push(layer);
    expect(liftSelectionCommand(doc, layer.id)).toBeNull();
    doc.selection = Selection.fromRect(10, 10, { x: 6, y: 6, width: 2, height: 2 });
    expect(liftSelectionCommand(doc, layer.id)).toBeNull();
    doc.selection = Selection.fromRect(10, 10, { x: 3, y: 3, width: 2, height: 2 });
    expect(liftSelectionCommand(doc, 'missing')).toBeNull();

    const command = liftSelectionCommand(doc, layer.id, true);
    expect(command).toMatchObject({ sourceId: layer.id, floatId: 'layer-2', copy: true });
  });
});

describe('CommitFloatingCommand', () => {
  it('restores the source exactly when committed where it was lifted, for every alpha and coverage', () => {
    // Row = alpha, column = coverage.
    const pixels: Rgba[] = [];
    const coverage: number[] = [];
    for (let a = 0; a < 256; a++) {
      for (let c = 0; c < 256; c++) {
        pixels.push([(c * 7) % 256, (a * 13) % 256, (a + c) % 256, a]);
        coverage.push(c);
      }
    }
    const { source, editor } = setup(pixels, coverage, 256);
    const original = source.pixels.data.slice();

    lift(editor);
    expect(firstDifference(source.pixels.data, original)).not.toBe(-1);
    expect(editor.commitFloating()).toBe(true);
    expect(firstDifference(source.pixels.data, original)).toBe(-1);
    expect(editor.document.layers).toHaveLength(1);

    // Moved away and back again counts as not moved.
    lift(editor);
    moveFloat(editor, 5, -3);
    moveFloat(editor, 1, 0);
    editor.commitFloating();
    expect(firstDifference(source.pixels.data, original)).toBe(-1);
  });

  it('composites moved pixels onto the source with the merge-down blend math', () => {
    const red: Rgba = [255, 0, 0, 255];
    const blue: Rgba = [0, 0, 255, 255];
    const green: Rgba = [0, 255, 0, 255];
    const { source, editor } = setup([red, blue, green, [0, 0, 0, 0]], [255, 128, 0, 0]);

    lift(editor);
    // Lifted: red, and blue at 128. Left behind: nothing, and blue at 127.
    moveFloat(editor, 1, 0);
    editor.commitFloating();
    expect(pixelsOf(source.pixels)).toEqual([
      [0, 0, 0, 0],
      // Opaque red over what was left of the blue.
      [255, 0, 0, 255],
      // Blue at 128/255 over green: 255 × 127/255 = 127 green, 255 × 128/255 = 128 blue.
      [0, 127, 128, 255],
      [0, 0, 0, 0],
    ]);
  });

  it('undoes into the floating state and redoes the commit', () => {
    const { doc, source, editor } = setup(
      [
        [255, 0, 0, 255],
        [0, 0, 255, 255],
        [0, 0, 0, 0],
      ],
      [255, 0, 0],
    );
    const original = pixelsOf(source.pixels);
    const float = lift(editor);
    const floating = editor.floating;
    moveFloat(editor, 2, 0);
    const lifted = pixelsOf(source.pixels);

    editor.commitFloating();
    const committed = pixelsOf(source.pixels);
    expect(committed).toEqual([
      [0, 0, 0, 0],
      [0, 0, 255, 255],
      [255, 0, 0, 255],
    ]);
    expect(editor.history.undoLabel).toBe('Commit Floating Selection');

    editor.history.undo();
    expect(doc.layers).toEqual([source, float]);
    expect(editor.floating).toBe(floating);
    expect([float.x, float.y]).toEqual([2, 0]);
    expect(pixelsOf(source.pixels)).toEqual(lifted);

    editor.history.redo();
    expect(doc.layers).toEqual([source]);
    expect(pixelsOf(source.pixels)).toEqual(committed);

    for (let i = 0; i < 3; i++) editor.history.undo();
    expect(pixelsOf(source.pixels)).toEqual(original);
    expect(editor.history.canUndo).toBe(false);
  });

  it('reports the float and the changed source pixels', () => {
    const { doc, source, editor } = setup(
      [
        [255, 0, 0, 255],
        [0, 0, 0, 0],
        [0, 0, 0, 0],
      ],
      [255, 0, 0],
    );
    lift(editor);
    moveFloat(editor, 2, 0);
    const floating = editor.floating;
    if (!floating) throw new Error('Nothing floating');
    const command = new CommitFloatingCommand(floating);
    const area = { x: 2, y: 0, width: 1, height: 1 };
    expect(command.apply(doc)).toEqual({
      dirty: area,
      layerPixels: [{ layerId: source.id, rect: area }],
      floating: null,
    });
    expect(command.revert(doc)).toEqual({
      dirty: area,
      layerPixels: [{ layerId: source.id, rect: area }],
      floating,
    });
  });

  it('grows the source to take in pixels moved past its edges', () => {
    const doc = createDocument(4, 2);
    const source = createRasterLayer({ id: createLayerId(doc), name: 'L', width: 2, height: 2 });
    source.pixels.data.fill(255);
    doc.layers.push(source);
    doc.selection = Selection.fromRect(4, 2, { x: 0, y: 0, width: 2, height: 1 });
    const editor = new Editor(doc);
    const before = source.pixels;

    lift(editor);
    moveFloat(editor, 3, 1);
    editor.commitFloating();
    // The union of the source (0, 0, 2×2) and the float (3, 1, 2×1), past the canvas.
    expect([source.x, source.y, source.pixels.width, source.pixels.height]).toEqual([0, 0, 5, 2]);
    const clear = [0, 0, 0, 0];
    const white = [255, 255, 255, 255];
    expect(pixelsOf(source.pixels)).toEqual([
      ...[clear, clear, clear, clear, clear],
      ...[white, white, clear, white, white],
    ]);
    expect(editor.history.undoLabel).toBe('Commit Floating Selection');

    editor.history.undo();
    expect(source.pixels).toBe(before);
    expect([source.x, source.y]).toEqual([0, 0]);
  });

  it("keeps the source's properties and merges into its own pixels", () => {
    const { source, editor } = setup(
      [
        [0, 0, 255, 255],
        [0, 0, 0, 0],
      ],
      [255, 0],
    );
    source.opacity = 0.5;
    source.visible = false;
    lift(editor);
    moveFloat(editor, 1, 0);
    editor.commitFloating();
    expect(source).toMatchObject({
      name: 'Photo',
      opacity: 0.5,
      visible: false,
      blendMode: 'normal',
    });
    expect(pixelsOf(source.pixels)).toEqual([
      [0, 0, 0, 0],
      [0, 0, 255, 255],
    ]);
  });

  it('leaves the source untouched for a copy committed where it was lifted', () => {
    const { doc, source, editor } = setup(SOURCE, COVERAGE);
    lift(editor, true);
    const floating = editor.floating;
    if (!floating) throw new Error('Nothing floating');
    const change = new CommitFloatingCommand(floating).apply(doc);
    expect(pixelsOf(source.pixels)).toEqual(SOURCE);
    expect(change).toEqual({ dirty: { x: 0, y: 0, width: 6, height: 1 }, floating: null });
  });

  it('adds a moved copy to the source', () => {
    const { source, editor } = setup(
      [
        [255, 0, 0, 255],
        [0, 0, 0, 0],
      ],
      [255, 0],
    );
    lift(editor, true);
    moveFloat(editor, 1, 0);
    editor.commitFloating();
    expect(pixelsOf(source.pixels)).toEqual([
      [255, 0, 0, 255],
      [255, 0, 0, 255],
    ]);
  });
});

describe('commitFloatingCommand', () => {
  it('is null unless the floating layer is directly above its source', () => {
    const { doc, source, editor } = setup(SOURCE, COVERAGE);
    lift(editor);
    const floating = editor.floating;
    if (!floating) throw new Error('Nothing floating');
    expect(commitFloatingCommand(doc, floating)).toBeInstanceOf(CommitFloatingCommand);
    expect(commitFloatingCommand(doc, { ...floating, sourceId: 'other' })).toBeNull();
    doc.layers.reverse();
    expect(commitFloatingCommand(doc, floating)).toBeNull();
    expect(() => new CommitFloatingCommand(floating).apply(doc)).toThrow(/directly above/);
    expect(doc.layers[1]).toBe(source);
  });
});
