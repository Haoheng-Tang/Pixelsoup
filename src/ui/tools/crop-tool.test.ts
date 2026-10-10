import { describe, expect, it } from 'vitest';
import type { Layer, Rect, Rgba } from '../../core';
import {
  canvasSizeCommand,
  CpuCompositor,
  createDocument,
  createLayerId,
  createRasterLayer,
  Editor,
  liftSelectionCommand,
  Selection,
  SetSelectionCommand,
} from '../../core';
import { CropOptions } from './crop-options';
import { CropTool } from './crop-tool';
import { FakeViewport } from './fake-viewport';
import { MarqueeTool } from './marquee-tool';
import { SelectionOptions } from './selection-options';
import { ToolManager } from './tool-manager';

const W = 40;
const H = 24;

/** The photo's pixel at (px, py): opaque, and different for every pixel. */
function photoPixel(px: number, py: number): Rgba {
  return [px, py, 100, 255];
}

/** A layer's pixel at document position (x, y), or null outside the layer. */
function pixelAt(layer: Layer, x: number, y: number): number[] | null {
  const { pixels } = layer;
  const lx = x - layer.x;
  const ly = y - layer.y;
  if (lx < 0 || ly < 0 || lx >= pixels.width || ly >= pixels.height) return null;
  const i = (ly * pixels.width + lx) * 4;
  return [...pixels.data.subarray(i, i + 4)];
}

/** Every undo label, newest first. Undoes everything to read them, then redoes it all. */
function undoLabels(editor: Editor): string[] {
  const labels: string[] = [];
  while (editor.history.canUndo) {
    labels.push(editor.history.undoLabel ?? '');
    editor.history.undo();
  }
  for (let i = 0; i < labels.length; i++) editor.history.redo();
  return labels;
}

/**
 * A 40×24 document holding one canvas-sized photo. The view is at 100 % with no pan, so
 * screen and document coordinates match. The Crop tool is active unless `activate` is
 * false (the Rectangular Marquee is, then).
 */
function setup({ activate = true, selection }: { activate?: boolean; selection?: Rect } = {}) {
  const doc = createDocument(W, H);
  const photo = createRasterLayer({ id: createLayerId(doc), name: 'Photo', width: W, height: H });
  for (let py = 0; py < H; py++) {
    for (let px = 0; px < W; px++) photo.pixels.data.set(photoPixel(px, py), (py * W + px) * 4);
  }
  doc.layers.push(photo);
  const editor = new Editor(doc);
  if (selection) {
    editor.history.execute(new SetSelectionCommand(Selection.fromRect(W, H, selection)));
  }
  const options = new CropOptions();
  const crop = new CropTool(options);
  const tools = new ToolManager([new MarqueeTool('rect', new SelectionOptions()), crop], editor);
  if (activate) tools.activate('crop');
  const messages: string[] = [];
  tools.subscribeMessages((text) => messages.push(text));
  return { editor, photo, options, crop, tools, view: new FakeViewport(tools), messages };
}

const box = (x: number, y: number, width: number, height: number): Rect => ({
  x,
  y,
  width,
  height,
});

describe('CropTool', () => {
  it('draws a box on whole pixels, then resizes it by its handles and moves it', () => {
    const { editor, crop, tools, view } = setup();
    expect(tools.activeTool).toMatchObject({ name: 'Crop', shortcut: 'C', cursor: 'crosshair' });
    expect(crop.box).toBeNull();
    // (2.4, 3.6) → (2, 4); (12.2, 9.5) → (12, 10).
    view.drag(2.4, 3.6, 12.2, 9.5);
    expect(crop.box).toEqual(box(2, 4, 10, 6));
    // The south-east corner, dragged 4 right and 3 down.
    view.drag(12, 10, 16, 13);
    expect(crop.box).toEqual(box(2, 4, 14, 9));
    // The west edge, grabbed just outside the box and dragged past the canvas.
    view.drag(1, 8, -3, 8);
    expect(crop.box).toEqual(box(-2, 4, 18, 9));
    // The middle moves it.
    view.drag(7, 8, 12, 5);
    expect(crop.box).toEqual(box(3, 1, 18, 9));
    // Adjusting the box isn't an edit.
    expect(editor.history.canUndo).toBe(false);
    expect(editor.isDirty).toBe(false);
  });

  it('shows a rule-of-thirds grid while dragging, and the box over the canvas', () => {
    const { crop, view } = setup();
    expect(crop.overlay).toBeNull();
    view.down(5, 4);
    view.move(25, 20);
    expect(crop.overlay).toEqual({ shape: 'crop', rect: box(5, 4, 20, 16), grid: true });
    view.up(25, 20);
    expect(crop.overlay).toEqual({ shape: 'crop', rect: box(5, 4, 20, 16), grid: false });
  });

  it('shows what a press would grab in the cursor', () => {
    const { crop, view } = setup();
    view.drag(5, 4, 25, 20);
    view.move(15, 12);
    expect(crop.cursor).toBe('move');
    view.move(25, 20);
    expect(crop.cursor).toBe('nwse-resize');
    view.move(15, 4);
    expect(crop.cursor).toBe('ns-resize');
    view.move(5, 20);
    expect(crop.cursor).toBe('nesw-resize');
    view.move(38, 12);
    expect(crop.cursor).toBe('crosshair');
  });

  it('reaches the handles from a fixed distance on screen at any zoom', () => {
    const { crop, view } = setup();
    view.zoom = 4;
    view.drag(20, 16, 100, 80);
    expect(crop.box).toEqual(box(5, 4, 20, 16));
    // 5 CSS pixels right of the east edge grabs it; 8 is too far (6 is the reach).
    view.move(105, 48);
    expect(crop.cursor).toBe('ew-resize');
    view.move(108, 48);
    expect(crop.cursor).toBe('crosshair');
  });

  it('leaves the box as it was after a click', () => {
    const { crop, view } = setup();
    view.down(5, 5);
    view.up(6, 6);
    expect(crop.box).toBeNull();
    view.drag(5, 4, 25, 20);
    for (const [x, y] of [
      [15, 12],
      [25, 20],
      [38, 2],
    ] as const) {
      view.down(x, y);
      view.up(x + 2, y);
      expect(crop.box).toEqual(box(5, 4, 20, 16));
    }
  });

  it('keeps a box drawn with Shift square, and a box resized with Shift to its shape', () => {
    const { crop, view } = setup();
    view.drag(5, 5, 15, 9, { shiftKey: true });
    expect(crop.box).toEqual(box(5, 5, 10, 10));
    // The corner dragged by (4, 1): 14 × 11, kept square by the longer side.
    view.drag(15, 15, 19, 16, { shiftKey: true });
    expect(crop.box).toEqual(box(5, 5, 14, 14));
    // The south edge dragged by 4: the width follows, centred where it was.
    view.drag(12, 19, 12, 23, { shiftKey: true });
    expect(crop.box).toEqual(box(3, 5, 18, 18));
  });

  it('draws and resizes from the centre with Alt', () => {
    const { crop, view } = setup();
    view.drag(20, 12, 25, 15, { altKey: true });
    expect(crop.box).toEqual(box(15, 9, 10, 6));
    // The east edge dragged 4 right moves the west edge 4 left.
    view.drag(25, 12, 29, 12, { altKey: true });
    expect(crop.box).toEqual(box(11, 9, 18, 6));
  });

  it('follows Shift and Alt pressed or released mid-drag', () => {
    const { crop, view } = setup();
    view.down(10, 6);
    view.move(20, 10);
    expect(crop.box).toEqual(box(10, 6, 10, 4));
    view.keyDown('Shift');
    expect(crop.box).toEqual(box(10, 6, 10, 10));
    view.keyUp('Shift');
    expect(crop.box).toEqual(box(10, 6, 10, 4));
    view.keyDown('Alt');
    expect(crop.box).toEqual(box(0, 2, 20, 8));
    view.up(20, 10);
    view.keyUp('Alt');
    expect(crop.box).toEqual(box(0, 2, 20, 8));
  });

  it('keeps the box to a preset ratio, landscape or portrait', () => {
    const { crop, options, view } = setup();
    const draw = (x: number, y: number): Rect | null => {
      view.keyDown('Escape');
      view.drag(0, 0, x, y);
      return crop.box;
    };
    options.set({ aspect: '4:3' });
    expect(draw(20, 5)).toEqual(box(0, 0, 20, 15));
    expect(draw(5, 20)).toEqual(box(0, 0, 15, 20));
    // Original: the canvas's 40 : 24, or 24 : 40 turned.
    options.set({ aspect: 'original' });
    expect(draw(20, 5)).toEqual(box(0, 0, 20, 12));
    expect(draw(5, 20)).toEqual(box(0, 0, 12, 20));
    options.set({ aspect: '1:1' });
    expect(draw(20, 5)).toEqual(box(0, 0, 20, 20));
    options.set({ aspect: '3:2' });
    expect(draw(30, 5)).toEqual(box(0, 0, 30, 20));
    options.set({ aspect: '16:9' });
    expect(draw(5, 32)).toEqual(box(0, 0, 18, 32));
    // A custom ratio is exact: 5 : 4 even for a portrait drag.
    options.set({ aspect: 'custom' });
    expect(draw(5, 20)).toEqual(box(0, 0, 25, 20));
  });

  it('keeps the ratio while resizing', () => {
    const { crop, options, view } = setup();
    options.set({ aspect: '4:3' });
    view.drag(0, 0, 20, 5);
    expect(crop.box).toEqual(box(0, 0, 20, 15));
    // The corner dragged by (8, 1): 28 × 16, fitted to 4 : 3 by the longer side.
    view.drag(20, 15, 28, 16);
    expect(crop.box).toEqual(box(0, 0, 28, 21));
  });

  it('reshapes the box around its centre when the ratio changes', () => {
    const { crop, options, view } = setup();
    view.drag(10, 6, 30, 16);
    expect(crop.box).toEqual(box(10, 6, 20, 10));
    // 200 px²: 14 × 14 (√200 ≈ 14.1), centred on (20, 11).
    options.set({ aspect: '1:1' });
    expect(crop.box).toEqual(box(13, 4, 14, 14));
    // 196 px² at 16 : 9: √(196 × 16 / 9) ≈ 18.7 → 19 wide, 19 × 9 / 16 ≈ 10.7 → 11 tall.
    options.set({ aspect: '16:9' });
    expect(crop.box).toEqual(box(10, 5, 19, 11));
    options.set({ deleteCropped: true });
    options.set({ aspect: 'free' });
    expect(crop.box).toEqual(box(10, 5, 19, 11));
  });

  it('crops to the box with Enter as one undo step, keeping the pixels outside it', () => {
    const { editor, photo, crop, view } = setup();
    view.drag(5, 4, 25, 20);
    expect(view.keyDown('Enter')).toBe(true);
    const doc = editor.document;
    expect([doc.width, doc.height]).toEqual([20, 16]);
    expect([photo.x, photo.y, photo.pixels.width, photo.pixels.height]).toEqual([-5, -4, W, H]);
    expect(pixelAt(photo, 0, 0)).toEqual(photoPixel(5, 4));
    expect(crop.box).toBeNull();
    expect(crop.overlay).toBeNull();
    expect(undoLabels(editor)).toEqual(['Crop']);
    expect(editor.isDirty).toBe(true);
    editor.history.undo();
    expect([editor.document.width, editor.document.height]).toEqual([W, H]);
    expect([photo.x, photo.y]).toEqual([0, 0]);
  });

  it('trims the layers to the box with Delete cropped pixels; undo puts them back', () => {
    const { editor, photo, options, view } = setup();
    const original = photo.pixels.data.slice();
    options.set({ deleteCropped: true });
    view.drag(5, 4, 25, 20);
    view.keyDown('Enter');
    const trimmed = editor.document.layers[0];
    expect([trimmed.x, trimmed.y, trimmed.pixels.width, trimmed.pixels.height]).toEqual([
      0, 0, 20, 16,
    ]);
    expect(pixelAt(trimmed, 0, 0)).toEqual(photoPixel(5, 4));
    expect(pixelAt(trimmed, 19, 15)).toEqual(photoPixel(24, 19));
    editor.history.undo();
    const restored = editor.document.layers[0];
    expect([restored.x, restored.y]).toEqual([0, 0]);
    expect(restored.pixels.data).toEqual(original);
  });

  it('crops on a double-click inside the box, but not on a handle or outside', () => {
    const { editor, crop, view } = setup();
    view.drag(5, 4, 25, 20);
    view.doubleClick(36, 22);
    view.doubleClick(25, 20);
    expect(editor.history.canUndo).toBe(false);
    expect(crop.box).toEqual(box(5, 4, 20, 16));
    view.doubleClick(15, 12);
    expect([editor.document.width, editor.document.height]).toEqual([20, 16]);
    expect(crop.box).toBeNull();
  });

  it('enlarges the canvas with transparent space for a box past its edges', () => {
    const { editor, photo, crop, view } = setup();
    view.drag(-5, -3, 45, 27);
    expect(crop.box).toEqual(box(-5, -3, 50, 30));
    view.keyDown('Enter');
    const doc = editor.document;
    expect([doc.width, doc.height]).toEqual([50, 30]);
    expect([photo.x, photo.y]).toEqual([5, 3]);
    const compositor = new CpuCompositor(doc.width, doc.height);
    compositor.composite(doc);
    const at = (x: number, y: number) => {
      const i = (y * doc.width + x) * 4;
      return [...compositor.output.data.subarray(i, i + 4)];
    };
    expect(at(0, 0)).toEqual([0, 0, 0, 0]);
    expect(at(49, 29)).toEqual([0, 0, 0, 0]);
    expect(at(5, 3)).toEqual(photoPixel(0, 0));
    expect(at(44, 26)).toEqual(photoPixel(39, 23));
  });

  it('cancels a drag with Escape, then removes the box with another', () => {
    const { crop, view } = setup();
    view.drag(5, 4, 25, 20);
    view.down(25, 20);
    view.move(30, 22);
    expect(crop.box).toEqual(box(5, 4, 25, 18));
    expect(view.keyDown('Escape')).toBe(true);
    expect(crop.box).toEqual(box(5, 4, 20, 16));
    view.up(30, 22);
    expect(crop.box).toEqual(box(5, 4, 20, 16));
    expect(view.keyDown('Escape')).toBe(true);
    expect(crop.box).toBeNull();
    // With no box, Escape and Enter are left alone.
    expect(view.keyDown('Escape')).toBe(false);
    expect(view.keyDown('Enter')).toBe(false);
  });

  it('crops only between drags', () => {
    const { editor, crop, view } = setup();
    view.drag(5, 4, 25, 20);
    view.down(15, 12);
    view.move(20, 12);
    view.keyDown('Enter');
    crop.commit();
    expect(editor.history.canUndo).toBe(false);
    view.up(20, 12);
    crop.commit();
    expect([editor.document.width, editor.document.height]).toEqual([20, 16]);
  });

  it('starts as the selection’s bounds, whatever the ratio', () => {
    const { crop, options, tools } = setup({ activate: false, selection: box(3, 2, 10, 8) });
    options.set({ aspect: '16:9' });
    tools.activate('crop');
    expect(crop.box).toEqual(box(3, 2, 10, 8));
    expect(crop.overlay).toEqual({ shape: 'crop', rect: box(3, 2, 10, 8), grid: false });
  });

  it('commits a floating selection before cropping', () => {
    const { editor, photo, crop, tools, view } = setup({
      activate: false,
      selection: box(3, 2, 10, 8),
    });
    const lift = liftSelectionCommand(editor.document, photo.id);
    if (!lift) throw new Error('nothing to lift');
    editor.history.execute(lift);
    expect(editor.floating).not.toBeNull();
    tools.activate('crop');
    expect(crop.box).toEqual(box(3, 2, 10, 8));
    view.keyDown('Enter');
    expect(editor.floating).toBeNull();
    expect(editor.document.layers).toHaveLength(1);
    expect([editor.document.width, editor.document.height]).toEqual([10, 8]);
    expect(pixelAt(editor.document.layers[0], 0, 0)).toEqual(photoPixel(3, 2));
    expect(undoLabels(editor).slice(0, 3)).toEqual([
      'Crop',
      'Commit Floating Selection',
      'Lift Selection',
    ]);
  });

  it('refuses a box larger than the largest canvas, keeping it', () => {
    const { editor, crop, view, messages } = setup();
    view.drag(0, 0, 8193, 10);
    view.keyDown('Enter');
    expect(messages).toEqual(['A crop can be at most 8192 × 8192 pixels']);
    expect(crop.box).toEqual(box(0, 0, 8193, 10));
    expect(editor.history.canUndo).toBe(false);
  });

  it('removes a box that does nothing without an undo step', () => {
    const { editor, crop, view } = setup();
    view.drag(0, 0, W, H);
    view.keyDown('Enter');
    expect(crop.box).toBeNull();
    expect(editor.history.canUndo).toBe(false);
  });

  it('drops the box when the canvas changes size or the document is replaced', () => {
    const { editor, crop, view } = setup();
    view.drag(5, 4, 25, 20);
    const command = canvasSizeCommand(editor.document, 30, 20, 'start', 'start');
    if (!command) throw new Error('no canvas size change');
    editor.history.execute(command);
    expect(crop.box).toBeNull();
    view.drag(5, 4, 25, 18);
    editor.history.undo();
    expect(crop.box).toBeNull();
    view.drag(5, 4, 25, 20);
    editor.replaceDocument(createDocument(W, H));
    expect(crop.box).toBeNull();
    expect(crop.overlay).toBeNull();
  });

  it('keeps the box through a selection change', () => {
    const { editor, crop, view } = setup();
    view.drag(5, 4, 25, 20);
    editor.history.execute(new SetSelectionCommand(Selection.fromRect(W, H, box(1, 1, 3, 3))));
    expect(crop.box).toEqual(box(5, 4, 20, 16));
  });

  it('discards the box when another tool is chosen', () => {
    const { editor, crop, tools, view } = setup();
    view.drag(5, 4, 25, 20);
    tools.activate('rect-marquee');
    expect(crop.box).toBeNull();
    tools.activate('crop');
    expect(crop.box).toBeNull();
    expect(editor.history.canUndo).toBe(false);
  });

  it('tells subscribers when the box appears and goes away', () => {
    const { crop, view } = setup();
    const seen: boolean[] = [];
    crop.subscribe(() => seen.push(crop.hasBox));
    view.drag(5, 4, 25, 20);
    view.drag(25, 20, 30, 22);
    crop.clearBox();
    expect(seen).toEqual([true, false]);
  });
});
