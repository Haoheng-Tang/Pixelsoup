import { describe, expect, it } from 'vitest';
import type { Rect, Rgba } from '../core';
import {
  Editor,
  MoveLayerCommand,
  Selection,
  SetLayerVisibilityCommand,
  SetSelectionCommand,
  createBlankDocument,
  liftSelectionCommand,
  newLayerCommand,
} from '../core';
import { Colors } from './color/colors';
import type { FillContents } from './edit-actions';
import { canClear, canFill, fillColor, runClear, runFill } from './edit-actions';

/** An editor on a 4×3 document with one opaque white layer, "layer-1". */
function setup(): Editor {
  return new Editor(createBlankDocument({ width: 4, height: 3, background: 'white' }));
}

function select(editor: Editor, area: Rect): void {
  const { width, height } = editor.document;
  editor.history.execute(new SetSelectionCommand(Selection.fromRect(width, height, area)));
}

function pixel(editor: Editor, x: number, y: number, id = 'layer-1'): Rgba {
  const layer = editor.document.layers.find((l) => l.id === id);
  if (!layer) throw new Error(`No layer ${id}`);
  const o = ((y - layer.y) * layer.pixels.width + x - layer.x) * 4;
  const d = layer.pixels.data;
  return [d[o] ?? -1, d[o + 1] ?? -1, d[o + 2] ?? -1, d[o + 3] ?? -1];
}

function pixels(editor: Editor, id = 'layer-1'): number[] {
  const layer = editor.document.layers.find((l) => l.id === id);
  if (!layer) throw new Error(`No layer ${id}`);
  return [...layer.pixels.data];
}

const WHITE: Rgba = [255, 255, 255, 255];
const RED: Rgba = [255, 0, 0, 255];

describe('fillColor', () => {
  it('gives the colour each choice stands for', () => {
    const colors = new Colors();
    colors.set('foreground', [10, 20, 30]);
    colors.set('background', [40, 50, 60]);
    const of = (contents: FillContents) => fillColor({ contents, custom: [7, 8, 9] }, colors);
    expect(of('foreground')).toEqual([10, 20, 30]);
    expect(of('background')).toEqual([40, 50, 60]);
    expect(of('black')).toEqual([0, 0, 0]);
    expect(of('white')).toEqual([255, 255, 255]);
    expect(of('gray')).toEqual([128, 128, 128]);
    expect(of('custom')).toEqual([7, 8, 9]);
  });

  it('starts a custom colour from the foreground colour', () => {
    const colors = new Colors();
    colors.set('foreground', [10, 20, 30]);
    expect(fillColor({ contents: 'custom', custom: null }, colors)).toEqual([10, 20, 30]);
  });
});

describe('canFill and canClear', () => {
  it('fills a visible active layer, with or without a selection', () => {
    const editor = setup();
    expect(canFill(editor)).toBe(true);
    select(editor, { x: 1, y: 1, width: 2, height: 1 });
    expect(canFill(editor)).toBe(true);
    editor.history.execute(new SetLayerVisibilityCommand('layer-1', false));
    expect(canFill(editor)).toBe(false);
  });

  it('clears only a selection that reaches the visible active layer', () => {
    const editor = setup();
    expect(canClear(editor)).toBe(false);
    select(editor, { x: 3, y: 0, width: 1, height: 3 });
    expect(canClear(editor)).toBe(true);
    editor.history.execute(new MoveLayerCommand('layer-1', -1, 0));
    expect(canClear(editor)).toBe(false);
    editor.history.undo();
    editor.history.execute(new SetLayerVisibilityCommand('layer-1', false));
    expect(canClear(editor)).toBe(false);
  });
});

describe('runFill', () => {
  it('fills the whole active layer without a selection, as one step', () => {
    const editor = setup();
    runFill(editor, [255, 0, 0], 1, 'normal');
    expect(pixels(editor)).toEqual(Array.from({ length: 12 }, () => RED).flat());
    expect(editor.history.undoLabel).toBe('Fill');
    editor.history.undo();
    expect(pixels(editor)).toEqual(Array.from({ length: 12 }, () => WHITE).flat());
    expect(editor.history.canUndo).toBe(false);
  });

  it('fills the selection at the opacity', () => {
    const editor = setup();
    select(editor, { x: 1, y: 1, width: 2, height: 1 });
    runFill(editor, [255, 0, 0], 0.5, 'normal');
    // Half red over white: 255 × 0.5 + 255 × 0.5 = 255 red, and 0 × 0.5 + 255 × 0.5 =
    // 127.5, rounded to 128, green and blue.
    expect(pixel(editor, 1, 1)).toEqual([255, 128, 128, 255]);
    expect(pixel(editor, 2, 1)).toEqual([255, 128, 128, 255]);
    expect(pixel(editor, 0, 1)).toEqual(WHITE);
    expect(pixel(editor, 1, 0)).toEqual(WHITE);
  });

  it('keeps the alpha when preserving transparency', () => {
    const editor = setup();
    select(editor, { x: 0, y: 0, width: 2, height: 1 });
    runClear(editor);
    select(editor, { x: 0, y: 0, width: 4, height: 1 });
    runFill(editor, [255, 0, 0], 1, 'preserve-transparency');
    expect(pixel(editor, 0, 0)).toEqual([0, 0, 0, 0]);
    expect(pixel(editor, 2, 0)).toEqual(RED);
    expect(editor.history.undoLabel).toBe('Fill');
  });

  it('fills the active layer, and nothing while it is hidden', () => {
    const editor = setup();
    const add = newLayerCommand(editor.document, 'layer-1');
    editor.history.execute(add);
    editor.setActiveLayer(add.layer.id);
    runFill(editor, [255, 0, 0], 1, 'normal');
    expect(pixel(editor, 0, 0, add.layer.id)).toEqual(RED);
    expect(pixel(editor, 0, 0)).toEqual(WHITE);
    editor.history.execute(new SetLayerVisibilityCommand(add.layer.id, false));
    const steps = editor.history.undoLabel;
    runFill(editor, [0, 0, 255], 1, 'normal');
    expect(pixel(editor, 0, 0, add.layer.id)).toEqual(RED);
    expect(editor.history.undoLabel).toBe(steps);
  });

  it('fills a floating selection where it floats, without committing it', () => {
    const editor = setup();
    select(editor, { x: 1, y: 1, width: 2, height: 2 });
    const lift = liftSelectionCommand(editor.document, 'layer-1');
    if (!lift) throw new Error('Nothing to lift');
    editor.history.execute(lift);
    const floating = editor.floating;
    if (!floating) throw new Error('Nothing floats');
    const source = pixels(editor);
    runFill(editor, [255, 0, 0], 1, 'normal');
    expect(editor.floating).toMatchObject({ layerId: floating.layerId, edited: true });
    expect(pixel(editor, 1, 1, floating.layerId)).toEqual(RED);
    expect(pixels(editor)).toEqual(source);
    editor.history.undo();
    expect(editor.floating).toEqual(floating);
  });
});

describe('runClear', () => {
  it('clears the selected pixels to transparent, as one step', () => {
    const editor = setup();
    select(editor, { x: 1, y: 0, width: 2, height: 3 });
    runClear(editor);
    expect(pixel(editor, 1, 2)).toEqual([0, 0, 0, 0]);
    expect(pixel(editor, 2, 0)).toEqual([0, 0, 0, 0]);
    expect(pixel(editor, 0, 0)).toEqual(WHITE);
    expect(pixel(editor, 3, 2)).toEqual(WHITE);
    expect(editor.history.undoLabel).toBe('Clear');
    editor.history.undo();
    expect(pixels(editor)).toEqual(Array.from({ length: 12 }, () => WHITE).flat());
  });

  it('does nothing without a selection, or where nothing is left to clear', () => {
    const editor = setup();
    runClear(editor);
    expect(editor.history.canUndo).toBe(false);
    select(editor, { x: 0, y: 0, width: 1, height: 1 });
    runClear(editor);
    runClear(editor);
    editor.history.undo();
    expect(editor.history.undoLabel).toBe('Change Selection');
  });

  it('clears a floating selection where it floats, without committing it', () => {
    const editor = setup();
    select(editor, { x: 0, y: 0, width: 2, height: 2 });
    const lift = liftSelectionCommand(editor.document, 'layer-1', true);
    if (!lift) throw new Error('Nothing to lift');
    editor.history.execute(lift);
    const floating = editor.floating;
    if (!floating) throw new Error('Nothing floats');
    expect(canClear(editor)).toBe(true);
    runClear(editor);
    expect(editor.floating).toMatchObject({ layerId: floating.layerId, edited: true });
    expect(pixel(editor, 1, 1, floating.layerId)).toEqual([0, 0, 0, 0]);
    expect(pixel(editor, 1, 1)).toEqual(WHITE);
    expect(editor.history.undoLabel).toBe('Clear');
  });
});
