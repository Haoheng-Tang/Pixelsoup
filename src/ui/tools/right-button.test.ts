import { describe, expect, it } from 'vitest';
import { Editor, Selection, SetSelectionCommand, createBlankDocument } from '../../core';
import { Colors } from '../color/colors';
import { BrushOptions } from './brush-options';
import { EyedropperOptions } from './eyedropper-options';
import { FakeClock } from './fake-clock';
import { FakeViewport } from './fake-viewport';
import { LassoTool, PolygonLassoTool } from './lasso-tool';
import { MarqueeTool } from './marquee-tool';
import { MoveTool } from './move-tool';
import { PaintTool } from './paint-tool';
import { SelectionOptions } from './selection-options';
import { ToolManager } from './tool-manager';

/** The secondary (right) button: it opens the canvas's context menu, never a gesture. */
const RIGHT = { button: 2 } as const;

function setup() {
  const editor = new Editor(createBlankDocument({ width: 20, height: 12, background: 'white' }));
  const clock = new FakeClock();
  const selection = new SelectionOptions();
  const tools = new ToolManager(
    [
      new MarqueeTool('rect', selection),
      new PolygonLassoTool(selection),
      new LassoTool(selection),
      new PaintTool(
        'paint',
        new BrushOptions({ size: 4 }),
        new Colors(),
        new EyedropperOptions(),
        undefined,
        clock,
      ),
      new MoveTool(undefined, clock),
    ],
    editor,
  );
  // With a selection, a marquee click would deselect and the Move tool would lift.
  const area = { x: 2, y: 2, width: 8, height: 6 };
  editor.history.execute(new SetSelectionCommand(Selection.fromRect(20, 12, area)));
  let changes = 0;
  editor.subscribe(() => changes++);
  return { editor, clock, tools, view: new FakeViewport(tools), changes: () => changes };
}

describe('the right button', () => {
  it.each(['rect-marquee', 'polygon-lasso', 'lasso', 'brush', 'move'])(
    'starts no gesture with the %s tool',
    (id) => {
      const { editor, clock, tools, view, changes } = setup();
      tools.activate(id);
      const pixels = Array.from(editor.document.layers[0]?.pixels.data ?? []);
      view.down(4, 4, {}, RIGHT);
      expect(tools.isPointerDown).toBe(false);
      view.move(15, 10, {}, RIGHT);
      view.up(15, 10, {}, RIGHT);
      while (clock.pendingFrames > 0) clock.runFrame();
      expect(changes()).toBe(0);
      expect(editor.history.undoLabel).toBe('Change Selection');
      expect(editor.floating).toBeNull();
      expect(Array.from(editor.document.layers[0]?.pixels.data ?? [])).toEqual(pixels);
      // Only the brush's hover outline shows: no marquee, lasso or polygon was started.
      expect(tools.overlay?.shape ?? null).toBe(id === 'brush' ? 'brush' : null);

      // The same press with the primary button does start one.
      view.down(4, 4);
      expect(tools.isPointerDown).toBe(true);
    },
  );

  it('adds no vertex to a polygon in progress', () => {
    const { tools, view } = setup();
    tools.activate('polygon-lasso');
    view.down(2, 2);
    view.up(2, 2);
    view.down(14, 2);
    view.up(14, 2);
    const points = (overlay = tools.overlay) =>
      overlay?.shape === 'lasso' ? overlay.points.length : 0;
    expect(points()).toBe(2);
    view.down(14, 10, {}, RIGHT);
    view.up(14, 10, {}, RIGHT);
    expect(points()).toBe(2);
  });

  it("doesn't double-click", () => {
    const { editor, tools, view } = setup();
    tools.activate('polygon-lasso');
    for (const [x, y] of [
      [2, 2],
      [14, 2],
      [14, 10],
    ] as const) {
      view.down(x, y);
      view.up(x, y);
    }
    const at = {
      x: 8,
      y: 6,
      zoom: 1,
      shiftKey: false,
      altKey: false,
      ctrlKey: false,
      metaKey: false,
    };
    tools.doubleClick({ ...at, button: 2 });
    expect(tools.overlay?.shape).toBe('lasso');
    expect(editor.history.undoLabel).toBe('Change Selection');
    // A primary double-click closes the polygon.
    tools.doubleClick(at);
    expect(tools.overlay).toBeNull();
    expect(editor.history.undoLabel).toBe('Polygonal Lasso');
  });
});
