import { describe, expect, it } from 'vitest';
import type { Rect } from '../core';
import {
  Editor,
  ORIENTATION_LABELS,
  Selection,
  SetLayerVisibilityCommand,
  SetSelectionCommand,
  createDocument,
  createLayerId,
  createRasterLayer,
  liftSelectionCommand,
} from '../core';
import type { ImageAction } from './image-actions';
import { canRunImageAction, rotateLayerTarget, runImageAction } from './image-actions';

const ORIENTATIONS = Object.keys(ORIENTATION_LABELS) as (keyof typeof ORIENTATION_LABELS)[];

/** An editor on a 6×4 document with one 4×2 layer at 1, 1, its pixels all different. */
function setup(): Editor {
  const doc = createDocument(6, 4);
  const layer = createRasterLayer({
    id: createLayerId(doc),
    name: 'A',
    x: 1,
    y: 1,
    width: 4,
    height: 2,
  });
  layer.pixels.data.forEach((_, i, data) => (data[i] = (i * 37 + 11) % 256));
  doc.layers.push(layer);
  return new Editor(doc);
}

function select(editor: Editor, area: Rect): void {
  const { width, height } = editor.document;
  editor.history.execute(new SetSelectionCommand(Selection.fromRect(width, height, area)));
}

/** Lifts `area` of the active layer into a floating selection. */
function float(editor: Editor, area: Rect): void {
  select(editor, area);
  const lift = liftSelectionCommand(editor.document, editor.activeLayerId ?? '');
  if (!lift) throw new Error('Nothing to lift');
  editor.history.execute(lift);
}

function size(editor: Editor): [number, number] {
  return [editor.document.width, editor.document.height];
}

describe('canRunImageAction', () => {
  it('enables Crop to Selection only when it would crop', () => {
    const editor = setup();
    expect(canRunImageAction(editor, 'crop-to-selection')).toBe(false);
    select(editor, { x: 0, y: 0, width: 6, height: 4 });
    expect(canRunImageAction(editor, 'crop-to-selection')).toBe(false);
    select(editor, { x: 2, y: 1, width: 3, height: 2 });
    expect(canRunImageAction(editor, 'crop-to-selection')).toBe(true);
  });

  it('always enables the rotations and flips', () => {
    const editor = setup();
    for (const action of ORIENTATIONS) expect(canRunImageAction(editor, action)).toBe(true);
  });
});

describe('runImageAction', () => {
  it('crops to the selection bounds, keeping the pixels past them', () => {
    const editor = setup();
    const layer = editor.document.layers[0];
    const pixels = layer?.pixels;
    select(editor, { x: 2, y: 1, width: 3, height: 2 });
    runImageAction(editor, 'crop-to-selection');
    expect(size(editor)).toEqual([3, 2]);
    expect(editor.history.undoLabel).toBe('Crop to Selection');
    expect(layer).toMatchObject({ x: -1, y: 0, pixels });
    expect(editor.document.selection?.bounds()).toEqual({ x: 0, y: 0, width: 3, height: 2 });
    editor.history.undo();
    expect(size(editor)).toEqual([6, 4]);
    expect(layer).toMatchObject({ x: 1, y: 1 });
  });

  it('does nothing when it would do nothing', () => {
    const editor = setup();
    const before = editor.history.stateId;
    runImageAction(editor, 'crop-to-selection');
    expect(editor.history.stateId).toBe(before);
  });

  it('commits a floating selection first', () => {
    const actions: readonly ImageAction[] = ['crop-to-selection', ...ORIENTATIONS];
    for (const action of actions) {
      const editor = setup();
      float(editor, { x: 2, y: 1, width: 2, height: 1 });
      runImageAction(editor, action);
      expect(editor.floating).toBeNull();
      expect(editor.document.layers).toHaveLength(1);
      editor.history.undo();
      expect(editor.history.undoLabel).toBe('Commit Floating Selection');
    }
  });

  it('turns and flips the whole document', () => {
    const editor = setup();
    runImageAction(editor, 'rotate-cw');
    expect(size(editor)).toEqual([4, 6]);
    expect(editor.history.undoLabel).toBe('Rotate 90° Clockwise');
    runImageAction(editor, 'flip-horizontal');
    expect(size(editor)).toEqual([4, 6]);
    expect(editor.history.undoLabel).toBe('Flip Horizontal');
  });
});

describe('rotateLayerTarget', () => {
  it('turns the active layer when nothing is selected', () => {
    expect(rotateLayerTarget(setup())).toBe('layer');
  });

  it('turns the selected pixels when the selection covers some of the layer', () => {
    const editor = setup();
    select(editor, { x: 0, y: 0, width: 2, height: 2 });
    expect(rotateLayerTarget(editor)).toBe('selection');
  });

  it('turns a floating selection', () => {
    const editor = setup();
    float(editor, { x: 2, y: 1, width: 2, height: 1 });
    expect(rotateLayerTarget(editor)).toBe('selection');
  });

  it('has nothing to turn for a selection that misses the layer, or a hidden layer', () => {
    const editor = setup();
    select(editor, { x: 0, y: 0, width: 1, height: 4 });
    expect(rotateLayerTarget(editor)).toBeNull();

    const hidden = setup();
    hidden.history.execute(new SetLayerVisibilityCommand('layer-1', false));
    expect(rotateLayerTarget(hidden)).toBeNull();
  });

  it('has nothing to turn in a document with no layers', () => {
    expect(rotateLayerTarget(new Editor(createDocument(4, 4)))).toBeNull();
  });
});
