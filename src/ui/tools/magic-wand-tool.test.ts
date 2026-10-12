import { describe, expect, it } from 'vitest';
import type { Rect, Rgba, SelectionMode } from '../../core';
import {
  createDocument,
  createLayerId,
  createRasterLayer,
  Editor,
  liftSelectionCommand,
  Selection,
  SetSelectionCommand,
} from '../../core';
import { FakeViewport } from './fake-viewport';
import { MagicWandTool } from './magic-wand-tool';
import { RegionOptions } from './region-options';
import { SelectionOptions } from './selection-options';
import { ToolManager } from './tool-manager';

const W = 8;
const H = 6;
const RED: Rgba = [255, 0, 0, 255];
const BLUE: Rgba = [0, 0, 255, 255];
const GREEN: Rgba = [0, 255, 0, 255];
/** Within 10 of red in every channel. */
const NEAR_RED: Rgba = [250, 10, 5, 255];

/**
 * A selection from a picture of its mask, a string per row: `#` is fully selected, `.`
 * unselected, and `+` 32, the anti-aliased edge next to one selected pixel (255 × 1 / 8,
 * rounded).
 */
function mask(rows: readonly string[]): Selection {
  const values = new Uint8ClampedArray(W * H);
  rows.forEach((row, y) => {
    for (let x = 0; x < W; x++) {
      const c = row[x];
      values[y * W + x] = c === '#' ? 255 : c === '+' ? 32 : 0;
    }
  });
  return Selection.fromMask(W, H, values);
}

const RED_REGION = mask(['####....', '####....', '####....', '####....', '####....', '####....']);
const BLUE_REGION = mask(['....####', '....####', '....####', '....####', '....##.#', '....####']);

/**
 * An 8×6 document. The background, which is active, is red in its left half and blue in
 * its right, with a near-red pixel at (1, 1) and a red one at (6, 4) among the blue. Above
 * it, a transparent overlay with a green 2×2 square at the top left.
 */
function setup() {
  const doc = createDocument(W, H);
  const background = createRasterLayer({
    id: createLayerId(doc),
    name: 'Background',
    width: W,
    height: H,
  });
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) background.pixels.data.set(x < 4 ? RED : BLUE, (y * W + x) * 4);
  }
  background.pixels.data.set(NEAR_RED, (1 * W + 1) * 4);
  background.pixels.data.set(RED, (4 * W + 6) * 4);
  const overlay = createRasterLayer({
    id: createLayerId(doc),
    name: 'Overlay',
    width: W,
    height: H,
  });
  for (const [x, y] of [
    [0, 0],
    [1, 0],
    [0, 1],
    [1, 1],
  ] as const) {
    overlay.pixels.data.set(GREEN, (y * W + x) * 4);
  }
  doc.layers.push(background, overlay);
  const editor = new Editor(doc);
  editor.setActiveLayer(background.id);
  const selectionOptions = new SelectionOptions();
  const options = new RegionOptions();
  const tools = new ToolManager([new MagicWandTool(selectionOptions, options)], editor);
  const view = new FakeViewport(tools);
  return {
    editor,
    background,
    overlay,
    selectionOptions,
    options,
    tools,
    view,
    selection: () => editor.document.selection,
    click: (x: number, y: number, mods: { shiftKey?: boolean; altKey?: boolean } = {}) => {
      view.down(x, y, mods);
      view.up(x, y, { shiftKey: false, altKey: false });
    },
    select: (area: Rect) =>
      editor.history.execute(new SetSelectionCommand(Selection.fromRect(W, H, area))),
  };
}

describe('MagicWandTool', () => {
  it('selects the matching colours around the pixel clicked, as one undo step', () => {
    const { editor, tools, options, selection, click } = setup();
    expect(tools.activeTool).toMatchObject({ name: 'Magic Wand', shortcut: 'W' });
    expect(tools.activeTool.cursor).toMatch(/^url\(/);
    options.set({ antiAlias: false });
    click(0.5, 0.5);
    expect(selection()?.equals(RED_REGION)).toBe(true);
    expect(editor.history.undoLabel).toBe('Magic Wand');
    expect(editor.isDirty).toBe(false);
    editor.history.undo();
    expect(selection()).toBeNull();
    expect(editor.history.canUndo).toBe(false);
  });

  it('takes in colours up to the tolerance away in every channel', () => {
    const { options, selection, click } = setup();
    options.set({ antiAlias: false, tolerance: 9 });
    click(0.5, 0.5);
    const withoutNearRed = mask([
      '####....',
      '#.##....',
      '####....',
      '####....',
      '####....',
      '####....',
    ]);
    expect(selection()?.equals(withoutNearRed)).toBe(true);
    options.set({ tolerance: 10 });
    click(0.5, 0.5);
    expect(selection()?.equals(RED_REGION)).toBe(true);
  });

  it('selects every matching pixel when not contiguous', () => {
    const { options, selection, click } = setup();
    options.set({ antiAlias: false, contiguous: false });
    click(2, 3);
    const allRed = mask(['####....', '####....', '####....', '####....', '####..#.', '####....']);
    expect(selection()?.equals(allRed)).toBe(true);
  });

  it("softens the region's edge by a pixel when anti-aliased", () => {
    const { options, selection, click } = setup();
    expect(options.settings).toMatchObject({
      tolerance: 32,
      contiguous: true,
      antiAlias: true,
      sampleAll: false,
    });
    click(6.5, 4.5);
    const soft = mask(['........', '........', '........', '.....+++', '.....+#+', '.....+++']);
    expect(selection()?.equals(soft)).toBe(true);
  });

  it.each<[string, { shiftKey?: boolean; altKey?: boolean }, SelectionMode, Selection]>([
    [
      'adds with Shift',
      { shiftKey: true },
      'replace',
      mask(['..######', '..######', '..######', '..######', '..####.#', '..######']),
    ],
    [
      'subtracts with Alt',
      { altKey: true },
      'replace',
      mask(['....##..', '....##..', '....##..', '....##..', '....##..', '....##..']),
    ],
    [
      'intersects with Shift+Alt',
      { shiftKey: true, altKey: true },
      'replace',
      mask(['..##....', '..##....', '..##....', '..##....', '..##....', '..##....']),
    ],
    [
      "uses the options bar's mode without modifiers",
      {},
      'intersect',
      mask(['..##....', '..##....', '..##....', '..##....', '..##....', '..##....']),
    ],
  ])('%s', (_, mods, mode, expected) => {
    const { selectionOptions, options, selection, click, select } = setup();
    options.set({ antiAlias: false });
    selectionOptions.setMode(mode);
    select({ x: 2, y: 0, width: 4, height: 6 });
    // Shift adds the blue; the others take the red.
    click(mods.shiftKey && !mods.altKey ? 5.5 : 0.5, 0.5, mods);
    expect(selection()?.equals(expected)).toBe(true);
  });

  it('replaces with Shift or Alt held when nothing is selected', () => {
    const { options, selection, click } = setup();
    options.set({ antiAlias: false });
    click(0.5, 0.5, { altKey: true });
    expect(selection()?.equals(RED_REGION)).toBe(true);
  });

  it('deselects on a click off the canvas in New mode, and not in the others', () => {
    const { editor, selectionOptions, selection, click, select } = setup();
    select({ x: 2, y: 0, width: 4, height: 6 });
    click(-1, 2);
    expect(selection()).toBeNull();
    expect(editor.history.undoLabel).toBe('Deselect');
    editor.history.undo();
    selectionOptions.setMode('add');
    click(9, 2);
    expect(editor.history.undoLabel).toBe('Change Selection');
    expect(selection()?.equals(Selection.fromRect(W, H, { x: 2, y: 0, width: 4, height: 6 }))).toBe(
      true,
    );
  });

  it('compares the composite of the visible layers when sampling all layers', () => {
    const { editor, overlay, options, selection, click } = setup();
    editor.setActiveLayer(overlay.id);
    options.set({ antiAlias: false });
    click(5.5, 2.5);
    const transparent = mask([
      '..######',
      '..######',
      '########',
      '########',
      '########',
      '########',
    ]);
    expect(selection()?.equals(transparent)).toBe(true);
    options.set({ sampleAll: true });
    click(5.5, 2.5);
    expect(selection()?.equals(BLUE_REGION)).toBe(true);
    click(0.5, 0.5);
    const green = mask(['##......', '##......', '........', '........', '........', '........']);
    expect(selection()?.equals(green)).toBe(true);
  });

  it('drops a floating selection back into its layer first, and compares the result', () => {
    const { editor, background, options, selection, click, select } = setup();
    options.set({ antiAlias: false });
    select({ x: 0, y: 0, width: 5, height: 1 });
    const lift = liftSelectionCommand(editor.document, background.id);
    if (!lift) throw new Error('nothing to lift');
    editor.history.execute(lift);
    expect(editor.floating).not.toBeNull();
    click(7.5, 2.5);
    expect(editor.floating).toBeNull();
    expect(editor.activeLayerId).toBe(background.id);
    expect(selection()?.equals(BLUE_REGION)).toBe(true);
    expect(editor.history.undoLabel).toBe('Magic Wand');
    editor.history.undo();
    expect(editor.history.undoLabel).toBe('Commit Floating Selection');
  });
});
