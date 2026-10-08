import { describe, expect, it } from 'vitest';
import type { Rgba } from '../../core';
import { createDocument, createLayerId, createRasterLayer, Editor, setPixel } from '../../core';
import { Colors } from '../color/colors';
import { EyedropperOptions } from './eyedropper-options';
import { EyedropperTool } from './eyedropper-tool';
import { FakeViewport } from './fake-viewport';
import { ToolManager } from './tool-manager';

const RED: Rgba = [200, 10, 20, 255];
const HALF_BLUE: Rgba = [0, 0, 255, 128];
// Half blue over opaque red, as the compositor blends it (see sample-color.test.ts).
const BLEND = [100, 5, 138];

/**
 * A 4×3 canvas: an opaque red background, transparent at (3, 2), and above it the active
 * 2×1 "Paint" layer at (1, 1): half-transparent blue at (1, 1), transparent at (2, 1).
 * The view is at 100 % with no pan, so screen and document coordinates match.
 */
function setup() {
  const doc = createDocument(4, 3);
  const background = createRasterLayer({
    id: createLayerId(doc),
    name: 'Background',
    width: 4,
    height: 3,
  });
  for (let y = 0; y < 3; y++) {
    for (let x = 0; x < 4; x++) if (x !== 3 || y !== 2) setPixel(background.pixels, x, y, RED);
  }
  const paint = createRasterLayer({
    id: createLayerId(doc),
    name: 'Paint',
    x: 1,
    y: 1,
    width: 2,
    height: 1,
  });
  setPixel(paint.pixels, 0, 0, HALF_BLUE);
  doc.layers.push(background, paint);
  const editor = new Editor(doc);
  const colors = new Colors();
  const options = new EyedropperOptions();
  const tools = new ToolManager([new EyedropperTool(colors, options)], editor);
  return { editor, colors, options, view: new FakeViewport(tools) };
}

function click(view: FakeViewport, x: number, y: number, altKey = false): void {
  view.down(x, y, { altKey });
  view.up(x, y, { altKey: false });
}

describe('EyedropperTool', () => {
  it('picks the composite colour under the pointer into the foreground', () => {
    const { editor, colors, view } = setup();
    click(view, 1.5, 1.5);
    expect(colors.foreground).toEqual(BLEND);
    expect(colors.background).toEqual([255, 255, 255]);
    expect(editor.history.canUndo).toBe(false);
  });

  it('picks into the background with Alt held at the press', () => {
    const { colors, view } = setup();
    click(view, 0.5, 0.5, true);
    expect(colors.background).toEqual([200, 10, 20]);
    expect(colors.foreground).toEqual([0, 0, 0]);
  });

  it("samples the active layer's own pixels when set to", () => {
    const { colors, options, view } = setup();
    options.setSource('layer');
    click(view, 1.9, 1.1);
    expect(colors.foreground).toEqual([0, 0, 255]);
    // Outside the layer, and where it's transparent, there's nothing to pick.
    click(view, 0.5, 0.5);
    click(view, 2.5, 1.5);
    expect(colors.foreground).toEqual([0, 0, 255]);
  });

  it('picks nothing where the composite is transparent or off the canvas', () => {
    const { colors, view } = setup();
    click(view, 3.5, 2.5);
    click(view, -2, 1);
    click(view, 1, 3.2);
    expect(colors.foreground).toEqual([0, 0, 0]);
  });

  it('keeps picking while dragging, but not while hovering', () => {
    const { colors, view } = setup();
    view.move(0.5, 0.5);
    expect(colors.foreground).toEqual([0, 0, 0]);
    view.down(0.5, 0.5);
    expect(colors.foreground).toEqual([200, 10, 20]);
    view.move(1.5, 1.5);
    expect(colors.foreground).toEqual(BLEND);
    view.up(0.5, 0.5);
    expect(colors.foreground).toEqual([200, 10, 20]);
    view.move(1.5, 1.5);
    expect(colors.foreground).toEqual([200, 10, 20]);
  });

  it('puts back the colour from before the press on Escape', () => {
    const { colors, view } = setup();
    colors.set('background', [1, 2, 3]);
    view.down(0.5, 0.5, { altKey: true });
    view.move(1.5, 1.5);
    expect(colors.background).toEqual(BLEND);
    expect(view.keyDown('Escape')).toBe(true);
    expect(colors.background).toEqual([1, 2, 3]);
    view.up(0.5, 0.5);
    expect(colors.background).toEqual([1, 2, 3]);
  });

  it('claims Alt so that it does not open browser menus', () => {
    const { view } = setup();
    expect(view.keyDown('Alt')).toBe(true);
    expect(view.keyUp('Alt')).toBe(true);
    expect(view.keyDown('a')).toBe(false);
  });
});
