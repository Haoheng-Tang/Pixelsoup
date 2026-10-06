import { describe, expect, it } from 'vitest';
import type { Rect } from '../../core';
import { createDocument, Editor, Selection, SetSelectionCommand } from '../../core';
import { CLICK_TOLERANCE, MarqueeTool, marqueeRect } from './marquee-tool';
import { SelectionOptions } from './selection-options';
import type { ToolModifiers } from './tool';
import { ToolManager } from './tool-manager';

type Modifiers = Partial<ToolModifiers>;

const W = 20;
const H = 12;
const noMods = { shiftKey: false, altKey: false, ctrlKey: false, metaKey: false };

/**
 * Stands in for the viewport: maps screen (CSS pixel) coordinates to document space
 * with `doc = (screen - pan) / zoom` and feeds the ToolManager as the real one does.
 */
class FakeViewport {
  zoom = 1;
  panX = 0;
  panY = 0;
  private held: Required<ToolModifiers> = { ...noMods };

  constructor(readonly tools: ToolManager) {}

  down(sx: number, sy: number, mods: Modifiers = {}): void {
    this.held = { ...this.held, ...mods };
    this.tools.pointerDown(this.event(sx, sy));
  }

  move(sx: number, sy: number, mods: Modifiers = {}): void {
    this.held = { ...this.held, ...mods };
    this.tools.pointerMove(this.event(sx, sy));
  }

  up(sx: number, sy: number, mods: Modifiers = {}): void {
    this.held = { ...this.held, ...mods };
    this.tools.pointerUp(this.event(sx, sy));
  }

  /** Press, move to the end point, release, with the same modifiers throughout. */
  drag(x0: number, y0: number, x1: number, y1: number, mods: Modifiers = {}): void {
    this.down(x0, y0, mods);
    this.move(x1, y1);
    this.up(x1, y1);
    this.held = { ...this.held, shiftKey: false, altKey: false };
  }

  keyDown(key: 'Shift' | 'Alt' | 'Escape'): boolean {
    if (key !== 'Escape')
      this.held = { ...this.held, [key === 'Shift' ? 'shiftKey' : 'altKey']: true };
    return this.tools.keyDown({ key, code: key, repeat: false, ...this.held });
  }

  keyUp(key: 'Shift' | 'Alt'): boolean {
    this.held = { ...this.held, [key === 'Shift' ? 'shiftKey' : 'altKey']: false };
    return this.tools.keyUp({ key, code: key, repeat: false, ...this.held });
  }

  private event(sx: number, sy: number) {
    return {
      x: (sx - this.panX) / this.zoom,
      y: (sy - this.panY) / this.zoom,
      zoom: this.zoom,
      ...this.held,
    };
  }
}

function setup(shape: 'rect' | 'ellipse' = 'rect') {
  const editor = new Editor(createDocument(W, H));
  const options = new SelectionOptions();
  const tools = new ToolManager(
    [new MarqueeTool('rect', options), new MarqueeTool('ellipse', options)],
    editor,
  );
  if (shape === 'ellipse') tools.activate('ellipse-marquee');
  const view = new FakeViewport(tools);
  let overlayChanges = 0;
  tools.subscribeOverlay(() => overlayChanges++);
  return {
    editor,
    options,
    tools,
    view,
    doc: () => editor.document,
    overlayChanges: () => overlayChanges,
    select: (area: Rect) =>
      editor.history.execute(new SetSelectionCommand(Selection.fromRect(W, H, area))),
  };
}

const rect = (area: Rect) => Selection.fromRect(W, H, area);

describe('marqueeRect', () => {
  it('normalises a drag in any direction', () => {
    expect(marqueeRect(5, 6, 2, 1, false, false)).toEqual({ x: 2, y: 1, width: 3, height: 5 });
  });

  it('constrains to a square using the longer side, keeping the drag direction', () => {
    expect(marqueeRect(10, 10, 4, 8, true, false)).toEqual({ x: 4, y: 4, width: 6, height: 6 });
  });

  it('grows from the centre', () => {
    expect(marqueeRect(10, 5, 13, 7, false, true)).toEqual({ x: 7, y: 3, width: 6, height: 4 });
    expect(marqueeRect(10, 5, 13, 7, true, true)).toEqual({ x: 7, y: 2, width: 6, height: 6 });
  });
});

describe('MarqueeTool', () => {
  it('drags out a rectangle as one undoable step', () => {
    const { editor, view, doc } = setup();
    view.drag(2, 3, 7, 9);
    expect(doc().selection?.equals(rect({ x: 2, y: 3, width: 5, height: 6 }))).toBe(true);
    expect(editor.history.undoLabel).toBe('Rectangular Marquee');
    expect(editor.isDirty).toBe(false);
    editor.history.undo();
    expect(doc().selection).toBeNull();
    expect(editor.history.canUndo).toBe(false);
  });

  it('snaps to the nearest pixel corners and normalises a reversed drag', () => {
    const { view, doc } = setup();
    // Anchor (5.6, 4.4) → (6, 4); end (1.2, 0.5) → (1, 1) (0.5 rounds up).
    view.drag(5.6, 4.4, 1.2, 0.5);
    expect(doc().selection?.bounds()).toEqual({ x: 1, y: 1, width: 5, height: 3 });
  });

  it('drags out an anti-aliased ellipse with the elliptical marquee', () => {
    const { editor, view, doc } = setup('ellipse');
    view.drag(2, 1, 12, 11);
    const expected = Selection.fromEllipse(W, H, { x: 2, y: 1, width: 10, height: 10 });
    expect(doc().selection?.equals(expected)).toBe(true);
    expect(editor.history.undoLabel).toBe('Elliptical Marquee');
  });

  it('previews the shape while dragging and clears the preview on release', () => {
    const { tools, view, overlayChanges } = setup();
    view.down(2, 2);
    view.move(3, 2); // under the click tolerance: still a click
    expect(tools.overlay).toBeNull();
    view.move(8, 6);
    expect(tools.overlay).toEqual({
      shape: 'rect',
      rect: { x: 2, y: 2, width: 6, height: 4 },
      hidesSelection: true,
    });
    view.up(8, 6);
    expect(tools.overlay).toBeNull();
    expect(overlayChanges()).toBe(2);
  });

  it('keeps showing the existing selection while previewing an addition', () => {
    const { tools, view, select } = setup();
    select({ x: 0, y: 0, width: 2, height: 2 });
    view.down(4, 4, { shiftKey: true });
    view.move(9, 9);
    expect(tools.overlay?.hidesSelection).toBe(false);
  });

  it('deselects on a click without a drag', () => {
    const { editor, view, doc, select } = setup();
    select({ x: 1, y: 1, width: 4, height: 4 });
    view.down(6, 6);
    view.move(6 + CLICK_TOLERANCE - 1, 6);
    view.up(6 + CLICK_TOLERANCE - 1, 6);
    expect(doc().selection).toBeNull();
    expect(editor.history.undoLabel).toBe('Deselect');
  });

  it('adds no step for a click with nothing selected', () => {
    const { editor, view } = setup();
    view.drag(6, 6, 6, 6);
    expect(editor.history.canUndo).toBe(false);
  });

  it('measures the click tolerance in screen pixels', () => {
    const { view, doc } = setup();
    view.zoom = 8;
    view.panX = 40;
    view.panY = 16;
    // 2 CSS px at 800 %: a click, so nothing is selected.
    view.drag(40 + 16, 16 + 16, 40 + 18, 16 + 16);
    expect(doc().selection).toBeNull();
    // Screen (56, 32)–(96, 64) is document (2, 2)–(7, 6).
    view.drag(56, 32, 96, 64);
    expect(doc().selection?.bounds()).toEqual({ x: 2, y: 2, width: 5, height: 4 });
  });

  it('deselects when a new shape lies entirely off the canvas', () => {
    const { view, doc, select } = setup();
    select({ x: 1, y: 1, width: 4, height: 4 });
    view.drag(-10, -10, -2, -3);
    expect(doc().selection).toBeNull();
  });

  it('combines with the selection when Shift, Alt or both are held at the press', () => {
    const a = { x: 2, y: 2, width: 8, height: 6 };
    const b = { x: 6, y: 4, width: 8, height: 6 };
    const cases = [
      { mods: { shiftKey: true }, expected: rect(a).union(rect(b)) },
      { mods: { altKey: true }, expected: rect(a).subtract(rect(b)) },
      { mods: { shiftKey: true, altKey: true }, expected: rect(a).intersect(rect(b)) },
    ];
    for (const { mods, expected } of cases) {
      const { view, doc, select } = setup();
      select(a);
      view.drag(b.x, b.y, b.x + b.width, b.y + b.height, mods);
      expect(doc().selection?.equals(expected)).toBe(true);
    }
  });

  it('uses the options-bar mode unless modifiers override it', () => {
    const { options, view, doc, select } = setup();
    select({ x: 0, y: 0, width: 10, height: 10 });
    options.setMode('subtract');
    view.drag(5, 0, 10, 10);
    expect(doc().selection?.bounds()).toEqual({ x: 0, y: 0, width: 5, height: 10 });
    view.drag(5, 0, 15, 5, { shiftKey: true });
    expect(doc().selection?.bounds()).toEqual({ x: 0, y: 0, width: 15, height: 10 });
  });

  it('does nothing when subtracting with no selection, or when nothing would change', () => {
    const { editor, options, view, select } = setup();
    options.setMode('subtract');
    view.drag(1, 1, 5, 5);
    expect(editor.history.canUndo).toBe(false);
    options.setMode('replace');
    select({ x: 0, y: 0, width: 10, height: 10 });
    view.drag(2, 2, 6, 6, { shiftKey: true }); // adding a rect already inside
    expect(editor.history.undoLabel).toBe('Change Selection');
  });

  it('subtracting everything deselects', () => {
    const { view, doc, select } = setup();
    select({ x: 2, y: 2, width: 3, height: 3 });
    view.drag(0, 0, 10, 10, { altKey: true });
    expect(doc().selection).toBeNull();
  });

  it('constrains to a square when Shift is pressed during the drag', () => {
    const { view, doc } = setup();
    view.down(10, 10);
    view.move(4, 8);
    view.keyDown('Shift');
    expect(view.tools.overlay?.rect).toEqual({ x: 4, y: 4, width: 6, height: 6 });
    view.up(4, 8);
    expect(doc().selection?.bounds()).toEqual({ x: 4, y: 4, width: 6, height: 6 });
  });

  it('draws from the centre when Alt is pressed during the drag', () => {
    const { view, doc } = setup();
    view.down(10, 5);
    view.move(13, 7, { altKey: true });
    view.up(13, 7);
    expect(doc().selection?.bounds()).toEqual({ x: 7, y: 3, width: 6, height: 4 });
  });

  it('constrains at once when Shift is held at the press with no selection', () => {
    const { view, doc } = setup();
    view.drag(1, 1, 9, 4, { shiftKey: true });
    expect(doc().selection?.bounds()).toEqual({ x: 1, y: 1, width: 8, height: 8 });
  });

  it('lets a mode modifier constrain only after it is released and pressed again', () => {
    const { view, doc, select } = setup();
    select({ x: 0, y: 0, width: 1, height: 1 });
    view.down(2, 2, { shiftKey: true }); // Shift picks "add"
    view.move(10, 4);
    expect(view.tools.overlay?.rect).toEqual({ x: 2, y: 2, width: 8, height: 2 });
    view.keyUp('Shift');
    view.keyDown('Shift'); // now Shift constrains
    expect(view.tools.overlay?.rect).toEqual({ x: 2, y: 2, width: 8, height: 8 });
    view.up(10, 4);
    const expected = rect({ x: 0, y: 0, width: 1, height: 1 }).union(
      rect({ x: 2, y: 2, width: 8, height: 8 }),
    );
    expect(doc().selection?.equals(expected)).toBe(true);
  });

  it('claims Shift and Alt key presses so Alt does not reach the browser', () => {
    const { view } = setup();
    expect(view.keyDown('Alt')).toBe(true);
    expect(view.keyUp('Alt')).toBe(true);
    expect(view.tools.keyDown({ key: 'x', code: 'KeyX', repeat: false, ...noMods })).toBe(false);
  });

  it('abandons the drag on Escape, cancel and document replacement', () => {
    const { editor, tools, view } = setup();
    view.down(1, 1);
    view.move(8, 8);
    expect(view.keyDown('Escape')).toBe(true);
    expect(tools.overlay).toBeNull();
    view.up(8, 8);
    expect(editor.history.canUndo).toBe(false);

    view.down(1, 1);
    view.move(8, 8);
    tools.cancel();
    view.up(8, 8);
    expect(editor.history.canUndo).toBe(false);

    view.down(1, 1);
    view.move(8, 8);
    editor.replaceDocument(createDocument(W, H));
    expect(tools.overlay).toBeNull();
    view.up(8, 8);
    expect(editor.document.selection).toBeNull();
    expect(editor.history.canUndo).toBe(false);
  });

  it('shares the selection mode between the rectangular and elliptical marquees', () => {
    const { options, tools, view, doc, select } = setup();
    select({ x: 0, y: 0, width: 4, height: 4 });
    options.setMode('add');
    tools.handleShortcut('m', true); // Shift+M: elliptical marquee
    expect(tools.activeTool.id).toBe('ellipse-marquee');
    view.drag(10, 2, 14, 6);
    expect(doc().selection?.bounds()).toEqual({ x: 0, y: 0, width: 14, height: 6 });
  });
});
