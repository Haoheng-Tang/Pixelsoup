import { describe, expect, it } from 'vitest';
import type { Point, Rect } from '../../core';
import {
  createDocument,
  createLayerId,
  createRasterLayer,
  Editor,
  liftSelectionCommand,
  Selection,
  SetSelectionCommand,
} from '../../core';
import type { Modifiers } from './fake-viewport';
import { FakeViewport, NO_MODIFIERS } from './fake-viewport';
import {
  CLOSE_REACH,
  LASSO_CURSOR,
  LassoTool,
  POLYGON_LASSO_CURSOR,
  PolygonLassoTool,
  lassoBounds,
  snapToAngle,
} from './lasso-tool';
import { MarqueeTool } from './marquee-tool';
import { SelectionOptions } from './selection-options';
import type { LassoOverlay, ToolKeyEvent } from './tool';
import { ToolManager } from './tool-manager';

const W = 20;
const H = 12;

function setup(tool: 'lasso' | 'polygon-lasso') {
  const editor = new Editor(createDocument(W, H));
  const options = new SelectionOptions();
  const tools = new ToolManager(
    [new LassoTool(options), new PolygonLassoTool(options), new MarqueeTool('rect', options)],
    editor,
  );
  tools.activate(tool);
  const view = new FakeViewport(tools);
  return {
    editor,
    options,
    tools,
    view,
    doc: () => editor.document,
    lasso: () => tools.overlay as LassoOverlay | null,
    click: (x: number, y: number, mods: Modifiers = {}) => {
      view.down(x, y, mods);
      view.up(x, y);
    },
    select: (area: Rect) =>
      editor.history.execute(new SetSelectionCommand(Selection.fromRect(W, H, area))),
  };
}

const polygon = (...points: Point[]) => Selection.fromPolygon(W, H, points);
const rect = (area: Rect) => Selection.fromRect(W, H, area);

describe('snapToAngle', () => {
  it('keeps the distance along the nearest of the eight directions', () => {
    const from = { x: 10, y: 10 };
    expect(snapToAngle(from, { x: 17, y: 11 })).toEqual({ x: 17, y: 10 });
    expect(snapToAngle(from, { x: 9.5, y: 3 })).toEqual({ x: 10, y: 3 });
    expect(snapToAngle(from, { x: 4, y: 10.5 })).toEqual({ x: 4, y: 10 });
    // 45° down and right: the projection of (5, 3) on (1, 1) / √2 is 8 / √2, so 4 each way.
    const diagonal = snapToAngle(from, { x: 15, y: 13 });
    expect(diagonal.x).toBeCloseTo(14, 12);
    expect(diagonal.y).toBeCloseTo(14, 12);
    const upLeft = snapToAngle(from, { x: 6, y: 7 });
    expect(upLeft.x).toBeCloseTo(6.5, 12);
    expect(upLeft.y).toBeCloseTo(6.5, 12);
    expect(snapToAngle(from, from)).toEqual(from);
  });
});

describe('lassoBounds', () => {
  it('covers every pixel the points and the rubber band touch', () => {
    const overlay: LassoOverlay = {
      shape: 'lasso',
      points: [
        { x: 2.5, y: 3 },
        { x: 7.2, y: 1.5 },
      ],
      next: { x: 4, y: 8.1 },
      closing: false,
    };
    expect(lassoBounds(overlay)).toEqual({ x: 2, y: 1, width: 6, height: 8 });
    expect(lassoBounds({ ...overlay, points: [], next: null })).toBeNull();
  });
});

describe('the lasso cursors', () => {
  const svgOf = (cursor: string): string =>
    decodeURIComponent(/^url\("data:image\/svg\+xml,([^"]+)"/.exec(cursor)?.[1] ?? '');

  it('are SVG arrows with a rope, whose hot spot is the tip of the arrow', () => {
    for (const cursor of [LASSO_CURSOR, POLYGON_LASSO_CURSOR]) {
      expect(cursor).toMatch(/^url\("data:image\/svg\+xml,[^"]+"\) 2 2, default$/);
      const svg = svgOf(cursor);
      expect(svg).toMatch(/^<svg xmlns='http:\/\/www\.w3\.org\/2000\/svg' width='32' height='32'/);
      // A solid (default black) arrow whose tip is the hot spot, (2, 2).
      expect(svg).toMatch(/<path d='M2 2[^']*Z'\/>/);
    }
    // The Lasso's rope is rounded and the Polygonal Lasso's has straight sides.
    expect(svgOf(LASSO_CURSOR)).toContain("<g fill='none' stroke-linejoin='round'>");
    expect(svgOf(POLYGON_LASSO_CURSOR)).toContain("<g fill='none' stroke-linejoin='miter'>");
  });

  it('are the Lasso and the Polygonal Lasso cursors', () => {
    const { tools } = setup('lasso');
    expect(tools.activeTool.cursor).toBe(LASSO_CURSOR);
    tools.activate('polygon-lasso');
    expect(tools.activeTool.cursor).toBe(POLYGON_LASSO_CURSOR);
  });
});

describe('PolygonLassoTool', () => {
  it('adds a vertex per click and closes on the first vertex, as one undo step', () => {
    const { editor, view, doc, lasso, click } = setup('polygon-lasso');
    click(2, 2);
    click(12, 2);
    click(2, 10);
    expect(doc().selection).toBeNull();
    view.move(3, 3);
    expect(lasso()).toMatchObject({
      points: [
        { x: 2, y: 2 },
        { x: 12, y: 2 },
        { x: 2, y: 10 },
      ],
    });
    expect(lasso()?.closing).toBe(true);
    click(3, 3);
    expect(doc().selection?.equals(polygon({ x: 2, y: 2 }, { x: 12, y: 2 }, { x: 2, y: 10 }))).toBe(
      true,
    );
    expect(lasso()).toBeNull();
    expect(editor.history.undoLabel).toBe('Polygonal Lasso');
    expect(editor.isDirty).toBe(false);
    editor.history.undo();
    expect(doc().selection).toBeNull();
    expect(editor.history.canUndo).toBe(false);
  });

  it('draws a rubber band from the last vertex to the pointer', () => {
    const { view, lasso, click } = setup('polygon-lasso');
    view.move(1, 1);
    expect(lasso()).toBeNull();
    click(2, 2);
    view.move(8, 5);
    expect(lasso()).toEqual({
      shape: 'lasso',
      points: [{ x: 2, y: 2 }],
      next: { x: 8, y: 5 },
      closing: false,
      hidesSelection: true,
    });
  });

  it('only offers to close on the first vertex with three or more, within reach on screen', () => {
    const { view, lasso, click } = setup('polygon-lasso');
    view.zoom = 4;
    click(8, 8);
    click(48, 8);
    view.move(10, 10);
    expect(lasso()?.closing).toBe(false);
    click(8, 40);
    view.move(8 + CLOSE_REACH - 1, 8);
    expect(lasso()?.closing).toBe(true);
    view.move(8 + CLOSE_REACH, 8);
    expect(lasso()?.closing).toBe(false);
  });

  it('closes on a double-click without adding the second click', () => {
    const { view, doc, click } = setup('polygon-lasso');
    click(2, 2);
    click(14, 3);
    view.doubleClick(8, 10);
    expect(doc().selection?.equals(polygon({ x: 2, y: 2 }, { x: 14, y: 3 }, { x: 8, y: 10 }))).toBe(
      true,
    );
  });

  it('closes on Enter, and takes back vertices with Backspace or Delete', () => {
    const { view, doc, lasso, click } = setup('polygon-lasso');
    click(2, 2);
    click(14, 2);
    click(14, 10);
    click(9, 6);
    expect(view.keyDown('Backspace')).toBe(true);
    expect(lasso()?.points).toHaveLength(3);
    click(2, 10);
    expect(view.keyDown('Delete')).toBe(true);
    click(4, 10);
    expect(view.keyDown('Enter')).toBe(true);
    expect(
      doc().selection?.equals(
        polygon({ x: 2, y: 2 }, { x: 14, y: 2 }, { x: 14, y: 10 }, { x: 4, y: 10 }),
      ),
    ).toBe(true);
    // With no polygon, the keys are left for other shortcuts.
    expect(view.keyDown('Backspace')).toBe(false);
    expect(view.keyDown('Enter')).toBe(false);
  });

  it('abandons the polygon when its last vertex is taken back, or on Escape', () => {
    const { view, doc, lasso, click } = setup('polygon-lasso');
    click(2, 2);
    view.keyDown('Backspace');
    expect(lasso()).toBeNull();
    click(2, 2);
    click(14, 2);
    click(14, 10);
    expect(view.keyDown('Escape')).toBe(true);
    expect(lasso()).toBeNull();
    expect(view.keyDown('Enter')).toBe(false);
    expect(doc().selection).toBeNull();
  });

  it('leaves Backspace with Ctrl, Cmd or Alt to the editing shortcuts', () => {
    const { view, lasso, click } = setup('polygon-lasso');
    click(2, 2);
    click(14, 2);
    expect(view.keyDown('Backspace', { altKey: true })).toBe(false);
    expect(view.keyDown('Backspace', { ctrlKey: true })).toBe(false);
    expect(view.keyDown('Enter', { metaKey: true })).toBe(false);
    expect(lasso()?.points).toHaveLength(2);
  });

  it('constrains the next segment to 45° steps while Shift is held', () => {
    const { view, lasso, click } = setup('polygon-lasso');
    click(2, 2);
    view.move(10, 3);
    view.keyDown('Shift');
    expect(lasso()?.next).toEqual({ x: 10, y: 2 });
    view.move(3, 9);
    expect(lasso()?.next).toEqual({ x: 2, y: 9 });
    click(3, 9);
    expect(lasso()?.points.at(-1)).toEqual({ x: 2, y: 9 });
    view.keyUp('Shift');
    expect(lasso()?.next).toEqual({ x: 3, y: 9 });
  });

  it('adds with Shift at the first click, which constrains only once pressed again', () => {
    const { view, doc, lasso, click, select } = setup('polygon-lasso');
    select({ x: 14, y: 0, width: 6, height: 4 });
    click(2, 2, { shiftKey: true });
    view.move(10, 3);
    expect(lasso()?.next).toEqual({ x: 10, y: 3 });
    expect(lasso()?.hidesSelection).toBe(false);
    view.keyUp('Shift');
    view.keyDown('Shift');
    expect(lasso()?.next).toEqual({ x: 10, y: 2 });
    view.keyUp('Shift');
    click(10, 2);
    click(6, 10);
    view.keyDown('Enter');
    const triangle = polygon({ x: 2, y: 2 }, { x: 10, y: 2 }, { x: 6, y: 10 });
    expect(
      doc().selection?.equals(triangle.union(rect({ x: 14, y: 0, width: 6, height: 4 }))),
    ).toBe(true);
  });

  it('subtracts with Alt at the first click', () => {
    const { view, doc, click, select } = setup('polygon-lasso');
    select({ x: 0, y: 0, width: 20, height: 12 });
    click(2, 2, { altKey: true });
    view.keyUp('Alt');
    click(18, 2);
    click(18, 10);
    view.keyDown('Enter');
    const triangle = polygon({ x: 2, y: 2 }, { x: 18, y: 2 }, { x: 18, y: 10 });
    expect(doc().selection?.equals(Selection.selectAll(W, H).subtract(triangle))).toBe(true);
  });

  it('deselects when closed without an area in New mode, and not in Add mode', () => {
    const { editor, view, doc, click, select, options } = setup('polygon-lasso');
    select({ x: 1, y: 1, width: 4, height: 4 });
    click(2, 2);
    view.keyDown('Enter');
    expect(doc().selection).toBeNull();
    expect(editor.history.undoLabel).toBe('Deselect');

    editor.history.undo();
    options.setMode('add');
    click(2, 2);
    click(10, 2);
    view.keyDown('Enter');
    expect(doc().selection?.equals(rect({ x: 1, y: 1, width: 4, height: 4 }))).toBe(true);
  });

  it('is abandoned when another tool becomes active', () => {
    const { tools, doc, lasso, click } = setup('polygon-lasso');
    click(2, 2);
    click(14, 2);
    click(14, 10);
    tools.activate('rect-marquee');
    expect(tools.overlay).toBeNull();
    tools.activate('polygon-lasso');
    expect(lasso()).toBeNull();
    expect(doc().selection).toBeNull();
  });
});

describe('LassoTool', () => {
  it('closes a freehand outline on release, as one undo step', () => {
    const { editor, view, doc, lasso } = setup('lasso');
    view.down(2, 2);
    view.move(12, 2);
    expect(lasso()).toMatchObject({
      points: [
        { x: 2, y: 2 },
        { x: 12, y: 2 },
      ],
      next: null,
    });
    view.move(12, 10, {}, { via: [[12, 6]] });
    view.up(2, 10);
    const expected = polygon(
      { x: 2, y: 2 },
      { x: 12, y: 2 },
      { x: 12, y: 6 },
      { x: 12, y: 10 },
      {
        x: 2,
        y: 10,
      },
    );
    expect(doc().selection?.equals(expected)).toBe(true);
    expect(lasso()).toBeNull();
    expect(editor.history.undoLabel).toBe('Lasso');
    editor.history.undo();
    expect(doc().selection).toBeNull();
  });

  it('drops points less than a CSS pixel apart', () => {
    const { view, lasso } = setup('lasso');
    view.zoom = 2;
    view.down(4, 4);
    view.move(4.5, 4);
    view.move(5, 4);
    view.move(5.4, 4);
    expect(lasso()?.points).toEqual([
      { x: 2, y: 2 },
      { x: 2.5, y: 2 },
    ]);
  });

  it('deselects on a click in New mode, and not in Add mode', () => {
    const { editor, view, doc, select, options } = setup('lasso');
    select({ x: 1, y: 1, width: 4, height: 4 });
    view.drag(5, 5, 6, 5);
    expect(doc().selection).toBeNull();
    editor.history.undo();
    options.setMode('add');
    view.drag(5, 5, 6, 5);
    expect(doc().selection?.equals(rect({ x: 1, y: 1, width: 4, height: 4 }))).toBe(true);
  });

  it('switches to straight segments when released with Alt held, until Alt is released', () => {
    const { view, doc, lasso } = setup('lasso');
    view.down(2, 2);
    view.move(10, 2);
    view.up(10, 2, { altKey: true });
    expect(doc().selection).toBeNull();
    view.move(12, 6);
    expect(lasso()).toMatchObject({
      points: [
        { x: 2, y: 2 },
        { x: 10, y: 2 },
      ],
      next: { x: 12, y: 6 },
    });
    // A click adds a vertex; dragging from the next one draws freehand again.
    view.down(12, 6);
    view.up(12, 6);
    view.down(12, 10);
    view.move(6, 10);
    expect(lasso()?.next).toBeNull();
    view.up(4, 10);
    expect(lasso()?.next).toEqual({ x: 4, y: 10 });
    expect(view.keyDown('Backspace', { altKey: true })).toBe(true);
    expect(lasso()?.points.at(-1)).toEqual({ x: 6, y: 10 });
    view.keyUp('Alt');
    const expected = polygon(
      { x: 2, y: 2 },
      { x: 10, y: 2 },
      { x: 12, y: 6 },
      { x: 12, y: 10 },
      { x: 6, y: 10 },
    );
    expect(doc().selection?.equals(expected)).toBe(true);
    expect(lasso()).toBeNull();
  });

  it("shows the Polygonal Lasso's cursor while it adds straight segments", () => {
    const { tools, view } = setup('lasso');
    const heard: string[] = [];
    tools.subscribeOverlay(() => heard.push(tools.activeTool.cursor));
    view.down(2, 2);
    view.move(14, 2);
    expect(tools.activeTool.cursor).toBe(LASSO_CURSOR);
    view.up(14, 2, { altKey: true });
    expect(tools.activeTool.cursor).toBe(POLYGON_LASSO_CURSOR);
    expect(heard.at(-1)).toBe(POLYGON_LASSO_CURSOR);
    // While the button is down, the pointer draws freehand again.
    view.down(14, 10, { altKey: true });
    expect(heard.at(-1)).toBe(LASSO_CURSOR);
    view.up(14, 10, { altKey: true });
    expect(heard.at(-1)).toBe(POLYGON_LASSO_CURSOR);
    view.keyUp('Alt');
    expect(heard.at(-1)).toBe(LASSO_CURSOR);

    view.down(2, 2);
    view.move(14, 2);
    view.up(14, 2, { altKey: true });
    expect(heard.at(-1)).toBe(POLYGON_LASSO_CURSOR);
    view.keyDown('Escape', { altKey: true });
    expect(heard.at(-1)).toBe(LASSO_CURSOR);
  });

  it('closes straight segments with Enter, a double-click or a click on the first point', () => {
    for (const close of ['enter', 'double-click', 'first point'] as const) {
      const { view, doc } = setup('lasso');
      view.down(2, 2);
      view.move(14, 2);
      view.up(14, 2, { altKey: true });
      view.down(14, 10);
      view.up(14, 10);
      if (close === 'enter') view.keyDown('Enter');
      else if (close === 'double-click') view.doubleClick(2, 10);
      else view.down(3, 3);
      const expected =
        close === 'double-click'
          ? polygon({ x: 2, y: 2 }, { x: 14, y: 2 }, { x: 14, y: 10 }, { x: 2, y: 10 })
          : polygon({ x: 2, y: 2 }, { x: 14, y: 2 }, { x: 14, y: 10 });
      expect(doc().selection?.equals(expected), close).toBe(true);
    }
  });

  it('closes when the pointer moves with Alt up, if its release went unseen', () => {
    const { view, doc } = setup('lasso');
    view.down(2, 2);
    view.move(14, 2);
    view.up(14, 2, { altKey: true });
    view.down(14, 10);
    view.up(14, 10);
    view.move(8, 8, { altKey: false });
    expect(
      doc().selection?.equals(polygon({ x: 2, y: 2 }, { x: 14, y: 2 }, { x: 14, y: 10 })),
    ).toBe(true);
  });

  it('subtracts with Alt at the press, without switching to straight segments', () => {
    const { view, doc, select } = setup('lasso');
    select({ x: 0, y: 0, width: 20, height: 12 });
    view.down(2, 2, { altKey: true });
    view.move(14, 2);
    view.move(14, 10);
    view.up(14, 10);
    const triangle = polygon({ x: 2, y: 2 }, { x: 14, y: 2 }, { x: 14, y: 10 });
    expect(doc().selection?.equals(Selection.selectAll(W, H).subtract(triangle))).toBe(true);
  });

  it('abandons the outline on Escape, mid-drag or between segments', () => {
    const { view, doc, lasso } = setup('lasso');
    view.down(2, 2);
    view.move(14, 2);
    expect(view.keyDown('Escape')).toBe(true);
    expect(lasso()).toBeNull();
    view.up(14, 10);
    expect(doc().selection).toBeNull();

    view.down(2, 2);
    view.move(14, 2);
    view.up(14, 2, { altKey: true });
    expect(view.keyDown('Escape', { altKey: true })).toBe(true);
    expect(lasso()).toBeNull();
    view.keyUp('Alt');
    expect(doc().selection).toBeNull();
  });
});

describe('Escape with no outline in progress', () => {
  const area = { x: 4, y: 2, width: 8, height: 6 };
  const heldEscape: ToolKeyEvent = {
    key: 'Escape',
    code: 'Escape',
    repeat: true,
    ...NO_MODIFIERS,
  };

  it('deselects with either lasso, as one undo step', () => {
    for (const tool of ['lasso', 'polygon-lasso'] as const) {
      const { view, editor, doc, select } = setup(tool);
      // With nothing selected, Escape is left alone.
      expect(view.keyDown('Escape')).toBe(false);
      select(area);
      expect(view.keyDown('Escape')).toBe(true);
      expect(doc().selection).toBeNull();
      expect(editor.history.undoLabel).toBe('Deselect');
      editor.history.undo();
      expect(doc().selection?.equals(rect(area))).toBe(true);
      expect(editor.history.undoLabel).toBe('Change Selection');
    }
  });

  it('deselects what the lasso just selected', () => {
    const { view, doc } = setup('lasso');
    view.down(2, 2);
    view.move(14, 2);
    view.move(14, 10);
    view.up(14, 10);
    expect(doc().selection).not.toBeNull();
    expect(view.keyDown('Escape')).toBe(true);
    expect(doc().selection).toBeNull();
  });

  it('abandons an outline in progress first, keeping the selection', () => {
    const polygonal = setup('polygon-lasso');
    polygonal.select(area);
    polygonal.click(2, 2);
    polygonal.click(14, 2);
    expect(polygonal.view.keyDown('Escape')).toBe(true);
    expect(polygonal.lasso()).toBeNull();
    expect(polygonal.doc().selection?.equals(rect(area))).toBe(true);
    expect(polygonal.view.keyDown('Escape')).toBe(true);
    expect(polygonal.doc().selection).toBeNull();

    const { view, tools, doc, lasso, select } = setup('lasso');
    select(area);
    view.down(2, 2);
    view.move(14, 2);
    view.up(14, 2, { altKey: true });
    expect(view.keyDown('Escape', { altKey: true })).toBe(true);
    expect(lasso()).toBeNull();
    view.keyUp('Alt');
    view.down(2, 2);
    view.move(14, 2);
    expect(view.keyDown('Escape')).toBe(true);
    // Escape held down repeats, which mustn't deselect as well.
    expect(tools.keyDown(heldEscape)).toBe(false);
    view.up(14, 2);
    expect(doc().selection?.equals(rect(area))).toBe(true);
  });

  it('leaves Escape with Ctrl, Cmd or Alt alone', () => {
    const { view, doc, select } = setup('polygon-lasso');
    select(area);
    expect(view.keyDown('Escape', { ctrlKey: true })).toBe(false);
    expect(view.keyDown('Escape', { metaKey: true })).toBe(false);
    expect(view.keyDown('Escape', { altKey: true })).toBe(false);
    expect(doc().selection?.equals(rect(area))).toBe(true);
  });

  it('commits a floating selection first', () => {
    const doc = createDocument(W, H);
    doc.layers.push(createRasterLayer({ id: createLayerId(doc), name: 'A', width: W, height: H }));
    const editor = new Editor(doc);
    const tools = new ToolManager([new LassoTool(new SelectionOptions())], editor);
    const view = new FakeViewport(tools);
    editor.history.execute(new SetSelectionCommand(rect(area)));
    const lift = liftSelectionCommand(doc, 'layer-1');
    if (!lift) throw new Error('Nothing to lift');
    editor.history.execute(lift);

    expect(view.keyDown('Escape')).toBe(true);
    expect(editor.floating).toBeNull();
    expect(doc.selection).toBeNull();
    expect(doc.layers).toHaveLength(1);
    expect(editor.history.undoLabel).toBe('Deselect');
    editor.history.undo();
    expect(editor.history.undoLabel).toBe('Commit Floating Selection');
  });
});

describe('the lasso key', () => {
  it('selects the lasso, and Shift+L switches between the two', () => {
    const { tools } = setup('lasso');
    tools.activate('rect-marquee');
    expect(tools.handleShortcut('l', false)).toBe(true);
    expect(tools.activeTool.id).toBe('lasso');
    tools.handleShortcut('L', true);
    expect(tools.activeTool.id).toBe('polygon-lasso');
    tools.handleShortcut('L', true);
    expect(tools.activeTool.id).toBe('lasso');
  });
});
