import { describe, expect, it } from 'vitest';
import type { Layer, Rect, Rgba } from '../../core';
import {
  createDocument,
  createLayerId,
  createRasterLayer,
  Editor,
  FLOATING_LAYER_NAME,
  Selection,
  SetLayerVisibilityCommand,
  SetSelectionCommand,
} from '../../core';
import { FakeClock } from './fake-clock';
import { FakeViewport } from './fake-viewport';
import { MarqueeTool } from './marquee-tool';
import { MoveTool } from './move-tool';
import { SelectionOptions } from './selection-options';
import { ToolManager } from './tool-manager';

const W = 8;
const H = 6;
const CLEAR = [0, 0, 0, 0];

/** The photo's pixel at (px, py) in layer space: opaque, and different for every pixel. */
function photoPixel(px: number, py: number): Rgba {
  return [10 + px, 20 + py, 30, 255];
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
 * An 8×6 document: a transparent background and, above it and active, a 6×4 photo at
 * (1, 1). The Move tool is active; the view is at 100 % with no pan, so screen and
 * document coordinates match.
 */
function setup() {
  const doc = createDocument(W, H);
  const background = createRasterLayer({
    id: createLayerId(doc),
    name: 'Background',
    width: W,
    height: H,
  });
  const photo = createRasterLayer({
    id: createLayerId(doc),
    name: 'Photo',
    x: 1,
    y: 1,
    width: 6,
    height: 4,
  });
  for (let py = 0; py < 4; py++) {
    for (let px = 0; px < 6; px++) photo.pixels.data.set(photoPixel(px, py), (py * 6 + px) * 4);
  }
  doc.layers.push(background, photo);
  const editor = new Editor(doc);
  const clock = new FakeClock();
  const options = new SelectionOptions();
  const tools = new ToolManager(
    [
      new MarqueeTool('rect', options),
      new MarqueeTool('ellipse', options),
      new MoveTool(undefined, clock),
    ],
    editor,
  );
  tools.activate('move');
  return {
    editor,
    doc,
    photo,
    clock,
    tools,
    view: new FakeViewport(tools),
    select: (area: Rect) =>
      editor.history.execute(new SetSelectionCommand(Selection.fromRect(W, H, area))),
  };
}

describe('MoveTool', () => {
  it('drags the active layer by whole pixels as one undo step', () => {
    const { editor, photo, tools, view } = setup();
    expect(tools.activeTool).toMatchObject({ name: 'Move', shortcut: 'V', cursor: 'move' });
    view.drag(2, 2, 5.4, 3.6);
    expect([photo.x, photo.y]).toEqual([4, 3]);
    expect(undoLabels(editor)).toEqual(['Move Layer']);
    expect(editor.isDirty).toBe(true);
    editor.history.undo();
    expect([photo.x, photo.y]).toEqual([1, 1]);
  });

  it('moves at most once per animation frame while dragging, and lands on release', () => {
    const { editor, photo, view, clock } = setup();
    view.down(2, 2);
    view.move(4, 2); // Less than the click tolerance.
    expect(clock.pendingFrames).toBe(0);
    view.move(6, 2);
    view.move(7, 3);
    expect(clock.pendingFrames).toBe(1);
    expect([photo.x, photo.y]).toEqual([1, 1]);
    clock.runFrame();
    expect([photo.x, photo.y]).toEqual([6, 2]);

    view.move(3, 5);
    view.up(4, 5);
    expect(clock.pendingFrames).toBe(0);
    expect([photo.x, photo.y]).toEqual([3, 4]);
    expect(undoLabels(editor)).toEqual(['Move Layer']);
  });

  it('keeps to the axis moved furthest along while Shift is held', () => {
    const { photo, view, clock } = setup();
    view.down(2, 2);
    view.move(7, 4);
    clock.runFrame();
    expect([photo.x, photo.y]).toEqual([6, 3]);
    expect(view.keyDown('Shift')).toBe(true);
    clock.runFrame();
    expect([photo.x, photo.y]).toEqual([6, 1]);
    view.move(3, 8);
    clock.runFrame();
    expect([photo.x, photo.y]).toEqual([1, 7]);
    view.keyUp('Shift');
    clock.runFrame();
    expect([photo.x, photo.y]).toEqual([2, 7]);
    view.up(3, 8);

    view.drag(2, 2, 3, 6, { shiftKey: true });
    expect([photo.x, photo.y]).toEqual([2, 11]);
  });

  it('does nothing for a click, a hidden layer or a selection that misses the layer', () => {
    const { editor, photo, view, select } = setup();
    view.drag(2, 2, 4, 3);
    view.zoom = 4;
    view.drag(8, 8, 10, 8); // Half a document pixel is 2 screen pixels at 400 %.
    view.zoom = 1;
    expect(editor.history.canUndo).toBe(false);

    select({ x: 7, y: 5, width: 1, height: 1 });
    view.drag(7, 5, 2, 2);
    expect(editor.history.undoLabel).toBe('Change Selection');

    editor.history.execute(new SetLayerVisibilityCommand(photo.id, false));
    editor.history.execute(new SetSelectionCommand(null));
    view.drag(2, 2, 6, 6);
    view.keyDown('ArrowRight');
    expect([photo.x, photo.y]).toEqual([1, 1]);
    expect(editor.history.undoLabel).toBe('Change Selection');
  });

  it('puts back everything a drag did when it is cancelled', () => {
    const { editor, doc, photo, view, clock, select } = setup();
    view.down(2, 2);
    view.move(6, 5);
    clock.runFrame();
    expect(view.keyDown('Escape')).toBe(true);
    expect([photo.x, photo.y]).toEqual([1, 1]);
    expect(editor.history.canUndo).toBe(false);
    view.up(6, 5);
    expect([photo.x, photo.y]).toEqual([1, 1]);

    // With a selection, the lift is undone too.
    select({ x: 2, y: 2, width: 2, height: 1 });
    const before = photo.pixels.data.slice();
    view.down(2, 2);
    view.move(6, 5);
    clock.runFrame();
    expect(editor.floating).not.toBeNull();
    view.keyDown('Escape');
    expect(editor.floating).toBeNull();
    expect(doc.layers).toHaveLength(2);
    expect(photo.pixels.data).toEqual(before);
    expect(doc.selection?.bounds()).toEqual({ x: 2, y: 2, width: 2, height: 1 });
    expect(undoLabels(editor)).toEqual(['Change Selection']);
  });

  it('nudges with the arrow keys, merging presses less than a second apart', () => {
    const { editor, photo, view, clock } = setup();
    expect(view.keyDown('ArrowRight')).toBe(true);
    clock.time = 900;
    view.keyDown('ArrowDown', { shiftKey: true });
    expect([photo.x, photo.y]).toEqual([2, 11]);
    clock.time = 1900;
    view.keyDown('ArrowLeft');
    expect([photo.x, photo.y]).toEqual([1, 11]);
    expect(undoLabels(editor)).toEqual(['Nudge Layer', 'Nudge Layer']);
    editor.history.undo();
    expect([photo.x, photo.y]).toEqual([2, 11]);

    expect(view.keyDown('ArrowLeft', { ctrlKey: true })).toBe(false);
    expect(view.keyDown('ArrowUp', { metaKey: true })).toBe(false);
    expect(view.keyDown('a')).toBe(false);
    // Arrows are ignored while dragging.
    view.down(2, 2);
    expect(view.keyDown('ArrowRight')).toBe(true);
    view.up(2, 2);
    expect([photo.x, photo.y]).toEqual([2, 11]);
  });

  it('lifts the selected pixels on the first drag and moves them with their outline', () => {
    const { editor, doc, photo, view, select } = setup();
    select({ x: 2, y: 2, width: 2, height: 1 });
    view.drag(2, 2, 5, 3);

    const float = doc.layers[2];
    expect(editor.floating?.layerId).toBe(float.id);
    expect(editor.activeLayerId).toBe(float.id);
    expect(float.name).toBe(FLOATING_LAYER_NAME);
    expect([float.x, float.y]).toEqual([5, 3]);
    // The photo's pixels (1, 1) and (2, 1) were on the canvas at (2, 2) and (3, 2).
    expect(pixelAt(float, 5, 3)).toEqual(photoPixel(1, 1));
    expect(pixelAt(float, 6, 3)).toEqual(photoPixel(2, 1));
    expect(pixelAt(photo, 2, 2)).toEqual(CLEAR);
    expect(pixelAt(photo, 3, 2)).toEqual(CLEAR);
    expect(pixelAt(photo, 4, 2)).toEqual(photoPixel(3, 1));
    expect(doc.selection?.bounds()).toEqual({ x: 5, y: 3, width: 2, height: 1 });

    expect(undoLabels(editor)).toEqual(['Move Selection', 'Lift Selection', 'Change Selection']);
    editor.history.undo();
    expect([float.x, float.y]).toEqual([2, 2]);
    expect(doc.selection?.bounds()).toEqual({ x: 2, y: 2, width: 2, height: 1 });
    editor.history.undo();
    expect(editor.floating).toBeNull();
    expect(doc.layers).toHaveLength(2);
    expect(pixelAt(photo, 2, 2)).toEqual(photoPixel(1, 1));
  });

  it('moves a floating selection on later drags and nudges without lifting again', () => {
    const { editor, doc, view, select } = setup();
    select({ x: 2, y: 2, width: 2, height: 1 });
    view.keyDown('ArrowRight');
    const float = doc.layers[2];
    expect(editor.floating?.layerId).toBe(float.id);
    expect([float.x, float.y]).toEqual([3, 2]);
    view.drag(4, 2, 4, 5);
    expect([float.x, float.y]).toEqual([3, 5]);
    expect(doc.layers).toHaveLength(3);
    expect(doc.selection?.bounds()).toEqual({ x: 3, y: 5, width: 2, height: 1 });
    expect(undoLabels(editor)).toEqual([
      'Move Selection',
      'Nudge Selection',
      'Lift Selection',
      'Change Selection',
    ]);
  });

  it('brings the outline back whole after taking a floating selection off the canvas', () => {
    const { editor, doc, view, clock, select } = setup();
    select({ x: 2, y: 2, width: 2, height: 1 });
    view.down(2, 2);
    view.move(12, 2);
    clock.runFrame();
    expect(doc.layers[2].x).toBe(12);
    expect(doc.selection).toBeNull();
    expect(editor.floating).not.toBeNull();
    view.up(4, 2);
    expect(doc.layers[2].x).toBe(4);
    expect(doc.selection?.bounds()).toEqual({ x: 4, y: 2, width: 2, height: 1 });
  });

  it('copies the selected pixels instead with Alt held at the press', () => {
    const { editor, doc, photo, view, select } = setup();
    const before = photo.pixels.data.slice();
    select({ x: 2, y: 2, width: 2, height: 1 });
    view.drag(2, 2, 2, 5, { altKey: true });
    const float = doc.layers[2];
    expect([float.x, float.y]).toEqual([2, 5]);
    expect(pixelAt(float, 2, 5)).toEqual(photoPixel(1, 1));
    expect(photo.pixels.data).toEqual(before);
    expect(undoLabels(editor)).toEqual(['Move Selection', 'Copy Selection', 'Change Selection']);
  });

  it('drops a floating selection and drags a copy of it when Alt-dragged', () => {
    const { editor, doc, photo, view, select } = setup();
    select({ x: 2, y: 2, width: 1, height: 1 });
    view.drag(2, 2, 5, 2);
    view.drag(5, 2, 5, 5, { altKey: true });

    expect(doc.layers).toHaveLength(3);
    const copy = doc.layers[2];
    expect(editor.floating).toMatchObject({ layerId: copy.id, sourceId: photo.id });
    expect(pixelAt(copy, 5, 5)).toEqual(photoPixel(1, 1));
    expect(pixelAt(photo, 2, 2)).toEqual(CLEAR);
    expect(pixelAt(photo, 5, 2)).toEqual(photoPixel(1, 1));
    expect(pixelAt(photo, 5, 5)).toBeNull();
    expect(undoLabels(editor)).toEqual([
      'Move Selection',
      'Copy Selection',
      'Commit Floating Selection',
      'Move Selection',
      'Lift Selection',
      'Change Selection',
    ]);
  });

  it('commits a floating selection when another tool is chosen; undo floats it again', () => {
    const { editor, doc, photo, tools, view, select } = setup();
    select({ x: 2, y: 2, width: 2, height: 1 });
    view.drag(2, 2, 5, 2);
    tools.activate('rect-marquee');
    expect(editor.floating).toBeNull();
    expect(doc.layers).toHaveLength(2);
    expect(pixelAt(photo, 5, 2)).toEqual(photoPixel(1, 1));
    expect(pixelAt(photo, 6, 2)).toEqual(photoPixel(2, 1));
    expect(editor.history.undoLabel).toBe('Commit Floating Selection');

    editor.history.undo();
    expect(editor.floating?.layerId).toBe(doc.layers[2].id);
    expect(editor.activeLayerId).toBe(doc.layers[2].id);

    // A new marquee selection commits it first.
    view.drag(0, 0, 3, 3);
    expect(editor.floating).toBeNull();
    expect(undoLabels(editor).slice(0, 3)).toEqual([
      'Rectangular Marquee',
      'Commit Floating Selection',
      'Move Selection',
    ]);
  });

  it('commits before a marquee click deselects, but not when the selection stays the same', () => {
    const { editor, doc, tools, view, select } = setup();
    select({ x: 2, y: 2, width: 2, height: 1 });
    view.drag(2, 2, 5, 2);
    tools.activate('rect-marquee');
    editor.history.undo();

    // Intersecting with the whole canvas leaves the selection as it is.
    view.drag(0, 0, W, H, { shiftKey: true, altKey: true });
    expect(editor.floating).not.toBeNull();
    view.drag(1, 1, 1, 1);
    expect(editor.floating).toBeNull();
    expect(doc.selection).toBeNull();
    expect(undoLabels(editor).slice(0, 2)).toEqual(['Deselect', 'Commit Floating Selection']);
  });

  it('lets go of a floating selection committed mid-drag', () => {
    const { editor, view, clock, select } = setup();
    select({ x: 2, y: 2, width: 2, height: 1 });
    view.drag(2, 2, 5, 2);
    view.down(5, 2);
    view.move(5, 5);
    clock.runFrame();
    editor.commitFloating();
    view.move(6, 5);
    clock.runFrame();
    view.keyDown('Escape');
    view.up(6, 5);
    expect(editor.history.undoLabel).toBe('Commit Floating Selection');
  });

  it('lets go of a drag when the document is replaced', () => {
    const { editor, view, clock } = setup();
    view.down(2, 2);
    view.move(6, 2);
    editor.replaceDocument(createDocument(4, 4));
    expect(clock.pendingFrames).toBe(0);
    view.move(7, 2);
    view.up(7, 2);
    expect(editor.history.canUndo).toBe(false);
  });
});
