import { describe, expect, it } from 'vitest';
import type { Rgb, Rgba, StrokeSample } from '../../core';
import {
  beginStroke,
  createDocument,
  createLayerId,
  createRasterLayer,
  DabPlacer,
  Editor,
  fillRect,
  getPixel,
  selectAllCommand,
  setPixel,
  strokeCommand,
} from '../../core';
import { Colors } from '../color/colors';
import type { BrushSettings } from './brush-options';
import { BrushOptions } from './brush-options';
import { EyedropperOptions } from './eyedropper-options';
import { EYEDROPPER_CURSOR } from './eyedropper-tool';
import { FakeClock } from './fake-clock';
import { FakeViewport } from './fake-viewport';
import { MarqueeTool } from './marquee-tool';
import type { PaintMode } from './paint-tool';
import { PaintTool } from './paint-tool';
import { SelectionOptions } from './selection-options';
import { ToolManager } from './tool-manager';

const WIDTH = 12;
const HEIGHT = 6;
const WHITE: Rgba = [255, 255, 255, 255];
const RED: Rgba = [200, 10, 20, 255];
const BLACK: Rgb = [0, 0, 0];

/** A soft, translucent brush, so that every pixel it touches shows how much it covered. */
const TEST_BRUSH: Partial<BrushSettings> = {
  size: 3,
  hardness: 50,
  opacity: 60,
  pressure: false,
};

function required<T>(value: T | null | undefined): T {
  if (value === null || value === undefined) throw new Error('Expected a value');
  return value;
}

/** A 12×6 canvas with one opaque white layer, red at (10, 4). */
function createTestDocument(visible = true) {
  const doc = createDocument(WIDTH, HEIGHT);
  const layer = createRasterLayer({
    id: createLayerId(doc),
    name: 'Background',
    width: WIDTH,
    height: HEIGHT,
    visible,
  });
  fillRect(layer.pixels, { x: 0, y: 0, width: WIDTH, height: HEIGHT }, WHITE);
  setPixel(layer.pixels, 10, 4, RED);
  doc.layers.push(layer);
  return doc;
}

/** The view is at 100 % with no pan, so screen and document coordinates match. */
function setup(brush: Partial<BrushSettings> = {}, visible = true) {
  const editor = new Editor(createTestDocument(visible));
  const colors = new Colors();
  const clock = new FakeClock();
  const eyedropper = new EyedropperOptions();
  const settings = { ...TEST_BRUSH, ...brush };
  const brushTool = new PaintTool(
    'paint',
    new BrushOptions(settings),
    colors,
    eyedropper,
    undefined,
    clock,
  );
  const eraser = new PaintTool(
    'erase',
    new BrushOptions(settings),
    colors,
    eyedropper,
    undefined,
    clock,
  );
  const tools = new ToolManager(
    [brushTool, eraser, new MarqueeTool('rect', new SelectionOptions())],
    editor,
  );
  const messages: string[] = [];
  tools.subscribeMessages((text) => messages.push(text));
  let changes = 0;
  editor.subscribe(() => changes++);
  return {
    editor,
    colors,
    clock,
    brush: brushTool,
    tools,
    messages,
    view: new FakeViewport(tools),
    changes: () => changes,
  };
}

function at(x: number, y: number, pressure = 1): StrokeSample {
  return { x, y, pressure };
}

/** A copy of the bottom layer's pixels. */
function pixelsOf(editor: Editor): Uint8ClampedArray {
  return required(editor.document.layers[0]).pixels.data.slice();
}

/**
 * What the core stroke engine paints on a fresh test document for these strokes, each
 * painted in one go from all its positions.
 */
function reference(
  strokes: readonly (readonly StrokeSample[])[],
  brush: Partial<BrushSettings> = {},
  mode: PaintMode = 'paint',
  color: Rgb = BLACK,
): Uint8ClampedArray {
  const settings = new BrushOptions({ ...TEST_BRUSH, ...brush }).settings;
  const editor = new Editor(createTestDocument());
  const layerId = required(editor.activeLayerId);
  for (const samples of strokes) {
    const stroke = required(
      beginStroke(
        editor.document,
        layerId,
        { mode, color, opacity: settings.opacity / 100, hardness: settings.hardness / 100 },
        null,
      ),
    );
    const placer = new DabPlacer(settings.size, settings.pressure ? settings.pressureTarget : null);
    const dabs = samples.flatMap((sample) => placer.add(sample));
    editor.history.execute(required(strokeCommand(stroke, dabs)));
  }
  return pixelsOf(editor);
}

describe('PaintTool', () => {
  it('paints a stroke as one undo step, one command per animation frame', () => {
    const { editor, colors, clock, view, changes } = setup();
    const blue: Rgb = [0, 128, 255];
    colors.set('foreground', blue);
    const before = pixelsOf(editor);

    view.down(1.5, 1.5);
    // The first dab shows straight away.
    expect(changes()).toBe(1);
    view.move(3.5, 1.5);
    view.move(5.5, 2.5);
    expect(changes()).toBe(1);
    expect(clock.pendingFrames).toBe(1);
    clock.runFrame();
    expect(changes()).toBe(2);
    view.move(8.5, 2.5);
    view.up(8.5, 2.5);
    expect(changes()).toBe(3);
    expect(clock.pendingFrames).toBe(0);

    // The same pixels as the whole stroke painted at once.
    const painted = reference(
      [[at(1.5, 1.5), at(3.5, 1.5), at(5.5, 2.5), at(8.5, 2.5)]],
      {},
      'paint',
      blue,
    );
    expect(pixelsOf(editor)).toEqual(painted);
    expect(pixelsOf(editor)).not.toEqual(before);

    editor.history.undo();
    expect(pixelsOf(editor)).toEqual(before);
    expect(editor.history.canUndo).toBe(false);
    editor.history.redo();
    expect(pixelsOf(editor)).toEqual(painted);
  });

  it('paints every position a move reports, coalesced ones included', () => {
    const { editor, view } = setup();
    view.down(1.5, 1.5);
    view.move(
      1.5,
      4.5,
      {},
      {
        via: [
          [9.5, 1.5],
          [9.5, 4.5],
        ],
      },
    );
    view.up(1.5, 4.5);
    expect(pixelsOf(editor)).toEqual(
      reference([[at(1.5, 1.5), at(9.5, 1.5), at(9.5, 4.5), at(1.5, 4.5)]]),
    );
    expect(getPixel(required(editor.document.layers[0]).pixels, 9, 2)).not.toEqual(WHITE);
  });

  it('scales the dabs by pen pressure, when that is on', () => {
    const pen = { size: 8, hardness: 100, opacity: 100, pressure: true } as const;
    const { editor, view } = setup(pen);
    view.down(3.5, 2.5, {}, { pressure: 0.5 });
    view.move(7.5, 2.5, {}, { pressure: 0.25 });
    // Positions without a pressure take the pen's latest.
    view.up(8.5, 2.5);
    const stroke = [at(3.5, 2.5, 0.5), at(7.5, 2.5, 0.25), at(8.5, 2.5, 0.25)];
    expect(pixelsOf(editor)).toEqual(reference([stroke], pen));
    expect(pixelsOf(editor)).not.toEqual(reference([stroke], { ...pen, pressure: false }));
  });

  it('ignores pen pressure when that is off', () => {
    const { editor, view } = setup({ size: 8, pressure: false });
    view.down(3.5, 2.5, {}, { pressure: 0.25 });
    view.up(3.5, 2.5, {}, { pressure: 0.25 });
    expect(pixelsOf(editor)).toEqual(reference([[at(3.5, 2.5)]], { size: 8 }));
  });

  it('draws a straight line from where the last stroke ended on Shift-click', () => {
    const { editor, view, changes } = setup();
    view.down(1.5, 1.5);
    view.up(1.5, 1.5);
    view.down(9.5, 4.5, { shiftKey: true });
    view.up(9.5, 4.5);
    expect(changes()).toBe(2);
    expect(pixelsOf(editor)).toEqual(reference([[at(1.5, 1.5)], [at(1.5, 1.5), at(9.5, 4.5)]]));
    // The line is a stroke of its own.
    editor.history.undo();
    expect(pixelsOf(editor)).toEqual(reference([[at(1.5, 1.5)]]));
  });

  it('paints a single dab on Shift-click with no stroke to continue', () => {
    const { editor, view } = setup();
    view.down(4.5, 2.5, { shiftKey: true });
    view.up(4.5, 2.5);
    expect(pixelsOf(editor)).toEqual(reference([[at(4.5, 2.5)]]));

    // Nor from a stroke in a document that has since been replaced.
    editor.replaceDocument(createTestDocument());
    view.down(9.5, 4.5, { shiftKey: true });
    view.up(9.5, 4.5);
    expect(pixelsOf(editor)).toEqual(reference([[at(9.5, 4.5)]]));
  });

  it('erases with the eraser', () => {
    const { editor, tools, view } = setup();
    tools.activate('eraser');
    view.down(4.5, 2.5);
    view.move(7.5, 3.5);
    view.up(7.5, 3.5);
    expect(pixelsOf(editor)).toEqual(reference([[at(4.5, 2.5), at(7.5, 3.5)]], {}, 'erase'));
    expect(getPixel(required(editor.document.layers[0]).pixels, 4, 2)[3]).toBeLessThan(255);
  });

  it('samples the foreground colour instead with Alt held at the press', () => {
    const { editor, colors, view, changes } = setup();
    view.down(10.5, 4.5, { altKey: true });
    expect(colors.foreground).toEqual([200, 10, 20]);
    // A drag keeps sampling, even once Alt is let go.
    view.move(1.5, 1.5, { altKey: false });
    expect(colors.foreground).toEqual([255, 255, 255]);
    view.up(10.5, 4.5);
    expect(colors.foreground).toEqual([200, 10, 20]);
    expect(changes()).toBe(0);
    expect(editor.history.canUndo).toBe(false);

    // Escape puts back the colour from before the press.
    view.down(1.5, 1.5, { altKey: true });
    expect(colors.foreground).toEqual([255, 255, 255]);
    expect(view.keyDown('Escape')).toBe(true);
    expect(colors.foreground).toEqual([200, 10, 20]);
  });

  it('shows the eyedropper while Alt is held, except during a stroke', () => {
    const { editor, colors, clock, brush, tools, view } = setup();
    view.move(4.5, 2.5);
    expect(view.keyDown('Alt')).toBe(true);
    expect(brush.cursor).toBe(EYEDROPPER_CURSOR);
    expect(tools.overlay).toBeNull();
    expect(view.keyUp('Alt')).toBe(true);
    expect(brush.cursor).toBe('none');
    expect(tools.overlay).toMatchObject({ shape: 'brush' });

    view.down(1.5, 1.5);
    view.keyDown('Alt');
    expect(brush.cursor).toBe('none');
    view.move(5.5, 1.5);
    clock.runFrame();
    view.up(5.5, 1.5);
    expect(pixelsOf(editor)).toEqual(reference([[at(1.5, 1.5), at(5.5, 1.5)]]));
    expect(colors.foreground).toEqual(BLACK);
    // Once the stroke is over, Alt samples again.
    expect(brush.cursor).toBe(EYEDROPPER_CURSOR);
  });

  it('undoes the stroke in progress on Escape, leaving it redoable', () => {
    const { editor, clock, view, changes } = setup();
    const before = pixelsOf(editor);
    view.down(1.5, 1.5);
    view.move(5.5, 1.5);
    clock.runFrame();
    view.move(8.5, 1.5);
    expect(view.keyDown('Escape')).toBe(true);
    expect(pixelsOf(editor)).toEqual(before);
    expect(clock.pendingFrames).toBe(0);
    expect(editor.history.canUndo).toBe(false);

    // The gesture is over: the rest of the drag paints nothing.
    const count = changes();
    view.move(9.5, 3.5);
    view.up(9.5, 3.5);
    expect(changes()).toBe(count);

    editor.history.redo();
    expect(pixelsOf(editor)).toEqual(reference([[at(1.5, 1.5), at(5.5, 1.5)]]));
  });

  it('ends the stroke when something else undoes it', () => {
    const { editor, clock, view } = setup();
    const before = pixelsOf(editor);
    view.down(1.5, 1.5);
    editor.history.undo();
    view.move(5.5, 1.5);
    clock.runFrame();
    view.up(5.5, 1.5);
    expect(pixelsOf(editor)).toEqual(before);
    expect(editor.history.canRedo).toBe(true);
  });

  it('ends the stroke when the selection changes', () => {
    const { editor, clock, view } = setup();
    view.down(1.5, 1.5);
    editor.history.execute(required(selectAllCommand(editor.document)));
    view.move(5.5, 1.5);
    clock.runFrame();
    view.up(5.5, 1.5);
    expect(pixelsOf(editor)).toEqual(reference([[at(1.5, 1.5)]]));

    // And it doesn't count as the last stroke for a Shift-click.
    view.down(9.5, 4.5, { shiftKey: true });
    view.up(9.5, 4.5);
    expect(pixelsOf(editor)).toEqual(reference([[at(1.5, 1.5)], [at(9.5, 4.5)]]));
  });

  it('ends the stroke when the document is replaced', () => {
    const { editor, clock, view } = setup();
    view.down(1.5, 1.5);
    editor.replaceDocument(createTestDocument());
    const fresh = pixelsOf(editor);
    view.move(5.5, 1.5);
    clock.runFrame();
    view.up(5.5, 1.5);
    expect(pixelsOf(editor)).toEqual(fresh);
    expect(editor.history.canUndo).toBe(false);
  });

  it('says so instead of painting a hidden layer', () => {
    const { clock, view, messages, changes } = setup({}, false);
    view.down(4.5, 2.5);
    view.move(6.5, 2.5);
    view.up(6.5, 2.5);
    expect(messages).toEqual(['The active layer is hidden']);
    expect(changes()).toBe(0);
    expect(clock.pendingFrames).toBe(0);
  });

  it('steps the brush size and hardness, and says so', () => {
    const { brush, tools, messages } = setup({ size: 30, hardness: 100 });
    expect(tools.stepBrush('size', 1)).toBe(true);
    expect(tools.stepBrush('hardness', -1)).toBe(true);
    expect(brush.options.settings).toMatchObject({ size: 40, hardness: 75 });
    expect(messages).toEqual(['Size: 40 px', 'Hardness: 75%']);

    tools.activate('rect-marquee');
    expect(tools.stepBrush('size', 1)).toBe(false);
    expect(brush.options.settings.size).toBe(40);
    expect(messages).toHaveLength(2);
  });

  it('outlines the brush at the pointer, in document space', () => {
    const { brush, tools, view } = setup({ size: 9 });
    expect(tools.overlay).toBeNull();
    expect(brush.cursor).toBe('crosshair');
    let notified = 0;
    tools.subscribeOverlay(() => notified++);

    view.zoom = 2;
    view.panX = 10;
    view.move(20, 6);
    expect(tools.overlay).toEqual({ shape: 'brush', x: 5, y: 3, diameter: 9 });
    expect(brush.cursor).toBe('none');
    expect(notified).toBe(1);

    brush.options.set({ size: 40 });
    expect(notified).toBe(2);
    expect(tools.overlay).toMatchObject({ diameter: 40 });

    // Switching tools forgets the pointer; the next move shows it again.
    tools.activate('rect-marquee');
    tools.activate('brush');
    expect(tools.overlay).toBeNull();
    view.move(22, 6);
    expect(tools.overlay).toMatchObject({ x: 6, y: 3 });
  });
});
