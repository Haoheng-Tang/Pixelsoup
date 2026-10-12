import { describe, expect, it } from 'vitest';
import type { RasterLayer, Rect, Rgba } from '../../core';
import {
  createDocument,
  createLayerId,
  createRasterLayer,
  Editor,
  liftSelectionCommand,
  Selection,
  SetLayerVisibilityCommand,
  SetSelectionCommand,
} from '../../core';
import { Colors } from '../color/colors';
import { FakeViewport } from './fake-viewport';
import { PaintBucketTool } from './paint-bucket-tool';
import { RegionOptions } from './region-options';
import { ToolManager } from './tool-manager';

const W = 6;
const H = 4;
const WHITE: Rgba = [255, 255, 255, 255];
const BLACK: Rgba = [0, 0, 0, 255];
const RED: Rgba = [255, 0, 0, 255];
const CLEAR: Rgba = [0, 0, 0, 0];

function pixelAt(layer: RasterLayer, x: number, y: number): Rgba {
  const i = (y * layer.pixels.width + x) * 4;
  const d = layer.pixels.data;
  return [d[i] ?? 0, d[i + 1] ?? 0, d[i + 2] ?? 0, d[i + 3] ?? 0];
}

/** Every row of the layer, as the colours of its pixels. */
function rowsOf(layer: RasterLayer): Rgba[][] {
  const rows: Rgba[][] = [];
  for (let y = 0; y < layer.pixels.height; y++) {
    const row: Rgba[] = [];
    for (let x = 0; x < layer.pixels.width; x++) row.push(pixelAt(layer, x, y));
    rows.push(row);
  }
  return rows;
}

/** Rows of `width` pixels, `left` in the first `split` columns and `right` in the rest. */
function halves(left: Rgba, right: Rgba, split = 3, width = W, height = H): Rgba[][] {
  return Array.from({ length: height }, () =>
    Array.from({ length: width }, (_, x) => (x < split ? left : right)),
  );
}

/**
 * A 6×4 document. The background, which is active, is white in its left three columns
 * and black in the rest; above it is a transparent overlay, canvas-sized unless `overlayArea`
 * says otherwise. The foreground colour is red.
 */
function setup(overlayArea: Rect = { x: 0, y: 0, width: W, height: H }) {
  const doc = createDocument(W, H);
  const background = createRasterLayer({
    id: createLayerId(doc),
    name: 'Background',
    width: W,
    height: H,
  });
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) background.pixels.data.set(x < 3 ? WHITE : BLACK, (y * W + x) * 4);
  }
  const overlay = createRasterLayer({ id: createLayerId(doc), name: 'Overlay', ...overlayArea });
  doc.layers.push(background, overlay);
  const editor = new Editor(doc);
  editor.setActiveLayer(background.id);
  editor.markSaved();
  const colors = new Colors();
  colors.set('foreground', [255, 0, 0]);
  const options = new RegionOptions();
  const tools = new ToolManager([new PaintBucketTool(colors, options)], editor);
  const view = new FakeViewport(tools);
  const messages: string[] = [];
  tools.subscribeMessages((text) => messages.push(text));
  return {
    editor,
    background,
    overlay,
    colors,
    options,
    tools,
    messages,
    click: (x: number, y: number) => {
      view.down(x, y);
      view.up(x, y);
    },
    select: (area: Rect) =>
      editor.history.execute(new SetSelectionCommand(Selection.fromRect(W, H, area))),
  };
}

describe('PaintBucketTool', () => {
  it('fills the matching region with the foreground colour, as one undo step', () => {
    const { editor, tools, background, options, click } = setup();
    expect(tools.activeTool).toMatchObject({ name: 'Paint Bucket', shortcut: 'G' });
    expect(tools.activeTool.cursor).toMatch(/^url\(/);
    options.set({ antiAlias: false });
    click(1.5, 2.5);
    expect(rowsOf(background)).toEqual(halves(RED, BLACK));
    expect(editor.history.undoLabel).toBe('Paint Bucket');
    expect(editor.isDirty).toBe(true);
    editor.history.undo();
    expect(rowsOf(background)).toEqual(halves(WHITE, BLACK));
    expect(editor.history.canUndo).toBe(false);
    expect(editor.isDirty).toBe(false);
    editor.history.redo();
    expect(rowsOf(background)).toEqual(halves(RED, BLACK));
  });

  it('fills with the colour as it is at the click', () => {
    const { background, colors, options, click } = setup();
    options.set({ antiAlias: false, contiguous: false });
    colors.set('foreground', [0, 0, 255]);
    click(4.5, 0.5);
    expect(rowsOf(background)).toEqual(halves(WHITE, [0, 0, 255, 255]));
  });

  it('softens the edge of the region when anti-aliasing', () => {
    const { background, click } = setup();
    click(0.5, 0.5);
    // Column 3 is just outside the region. The region covers (255 × n + 4) >> 3 of each of
    // its pixels, for the n of its eight neighbours inside: two at the top and bottom rows
    // (64), three between them (96). The fill's weight is that over 255, so the black
    // pixels' red channel becomes 255 × 64 / 255 = 64 and 255 × 96 / 255 = 96.
    const edge = [64, 96, 96, 64];
    expect(rowsOf(background)).toEqual(
      edge.map((red) => [RED, RED, RED, [red, 0, 0, 255], BLACK, BLACK]),
    );
  });

  it('fills only within the selection', () => {
    const { editor, background, options, select, click } = setup();
    options.set({ antiAlias: false });
    select({ x: 0, y: 1, width: 2, height: 2 });
    click(2.5, 3.5);
    expect(rowsOf(background)).toEqual([
      [WHITE, WHITE, WHITE, BLACK, BLACK, BLACK],
      [RED, RED, WHITE, BLACK, BLACK, BLACK],
      [RED, RED, WHITE, BLACK, BLACK, BLACK],
      [WHITE, WHITE, WHITE, BLACK, BLACK, BLACK],
    ]);
    expect(editor.history.undoLabel).toBe('Paint Bucket');
  });

  it('does nothing when the region misses the selection', () => {
    const { editor, background, options, select, click } = setup();
    options.set({ antiAlias: false });
    select({ x: 4, y: 0, width: 2, height: 4 });
    click(0.5, 0.5);
    expect(rowsOf(background)).toEqual(halves(WHITE, BLACK));
    expect(editor.history.undoLabel).toBe('Change Selection');
  });

  it('fills at the opacity set', () => {
    const { background, options, click } = setup();
    options.set({ antiAlias: false, opacity: 50 });
    click(0.5, 0.5);
    // Half of red over white: green and blue are 255 × 0.5 = 127.5, rounded up.
    expect(rowsOf(background)).toEqual(halves([255, 128, 128, 255], BLACK));
  });

  it('matches the active layer alone, or all the visible layers', () => {
    const { editor, overlay, options, click } = setup();
    editor.setActiveLayer(overlay.id);
    options.set({ antiAlias: false });
    // The overlay is wholly transparent, so all of it matches.
    click(0.5, 0.5);
    expect(rowsOf(overlay)).toEqual(halves(RED, RED));
    editor.history.undo();
    options.set({ sampleAll: true });
    click(0.5, 0.5);
    expect(rowsOf(overlay)).toEqual(halves(RED, CLEAR));
  });

  it('grows a smaller layer to take in the fill', () => {
    const { editor, overlay, options, click } = setup({ x: 1, y: 1, width: 1, height: 1 });
    editor.setActiveLayer(overlay.id);
    options.set({ antiAlias: false, sampleAll: true });
    click(0.5, 0.5);
    expect(overlay).toMatchObject({ x: 0, y: 0 });
    expect(rowsOf(overlay)).toEqual(halves(RED, RED, 3, 3, 4));
    editor.history.undo();
    expect(overlay).toMatchObject({ x: 1, y: 1 });
    expect(rowsOf(overlay)).toEqual([[CLEAR]]);
  });

  it('fills nothing on a hidden layer, and says why', () => {
    const { editor, background, messages, click } = setup();
    editor.history.execute(new SetLayerVisibilityCommand(background.id, false));
    click(0.5, 0.5);
    expect(messages).toEqual(['The active layer is hidden']);
    expect(rowsOf(background)).toEqual(halves(WHITE, BLACK));
    expect(editor.history.undoLabel).toBe('Hide Layer');
  });

  it('does nothing off the canvas', () => {
    const { editor, click } = setup();
    click(-0.5, 1.5);
    click(6.5, 1.5);
    expect(editor.history.canUndo).toBe(false);
  });

  it('fills a floating selection within its bounds', () => {
    const { editor, background, options, select, click } = setup();
    options.set({ antiAlias: false });
    select({ x: 0, y: 0, width: 2, height: 2 });
    const lift = liftSelectionCommand(editor.document, background.id);
    if (!lift) throw new Error('nothing to lift');
    editor.history.execute(lift);
    const floating = editor.floating;
    const layer = editor.activeLayer;
    if (!floating || layer?.id !== floating.layerId) throw new Error('not floating');
    click(0.5, 0.5);
    expect(rowsOf(layer)).toEqual(halves(RED, RED, 2, 2, 2));
    expect(layer).toMatchObject({ x: 0, y: 0 });
    expect(editor.floating?.edited).toBe(true);
    expect(editor.history.undoLabel).toBe('Paint Bucket');
    // Outside the floating layer the region is transparent, and misses it.
    click(4.5, 0.5);
    expect(editor.history.undoLabel).toBe('Paint Bucket');
    editor.commitFloating();
    expect(pixelAt(background, 1, 1)).toEqual(RED);
    expect(pixelAt(background, 2, 1)).toEqual(WHITE);
  });
});
