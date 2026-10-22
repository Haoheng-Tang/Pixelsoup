import { describe, expect, it } from 'vitest';
import type { Layer, Orientation, PixelBuffer, Rect } from '../../core';
import {
  compose,
  createDocument,
  createLayerId,
  createRasterLayer,
  Editor,
  liftSelectionCommand,
  orientedSize,
  orientPixels,
  Selection,
  SetLayerVisibilityCommand,
  SetSelectionCommand,
  transformPixels,
  translation,
} from '../../core';
import { canvasMenuSections } from '../canvas-menu';
import { FakeClock } from '../tools/fake-clock';
import { FakeViewport } from '../tools/fake-viewport';
import { MarqueeTool } from '../tools/marquee-tool';
import { MoveTool } from '../tools/move-tool';
import { SelectionOptions } from '../tools/selection-options';
import { ToolManager } from '../tools/tool-manager';
import { FreeTransform } from './free-transform';
import type { TransformSession } from './transform-session';

const W = 40;
const H = 30;

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

function copyOf(pixels: PixelBuffer): PixelBuffer {
  return { width: pixels.width, height: pixels.height, data: pixels.data.slice() };
}

/** `pixels` turned or flipped exactly, as the canvas commands do it. */
function oriented(pixels: PixelBuffer, orientation: Orientation): PixelBuffer {
  const { width, height } = orientedSize(orientation, pixels.width, pixels.height);
  const data = orientPixels(orientation, pixels.data, pixels.width, pixels.height, 4);
  return { width, height, data };
}

function boundsOf(layer: Layer): Rect {
  return { x: layer.x, y: layer.y, width: layer.pixels.width, height: layer.pixels.height };
}

/**
 * A 40×30 document: a transparent background and, above it and active, a 10×8 photo at
 * (5, 4), so its centre is (10, 8). The Move tool is active; the view is at 100 % with no
 * pan, so screen and document coordinates match.
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
    x: 5,
    y: 4,
    width: 10,
    height: 8,
  });
  photo.pixels.data.forEach((_, i, data) => (data[i] = i % 4 === 3 ? 255 : (i * 37 + 11) % 256));
  doc.layers.push(background, photo);
  const original = copyOf(photo.pixels);
  const editor = new Editor(doc);
  const options = new SelectionOptions();
  const tools = new ToolManager(
    [new MarqueeTool('rect', options), new MoveTool(undefined, new FakeClock())],
    editor,
  );
  tools.activate('move');
  const messages: string[] = [];
  tools.subscribeMessages((text) => messages.push(text));
  const freeTransform = new FreeTransform(editor, tools);
  const start = (mode?: 'free' | 'scale' | 'rotate'): TransformSession => {
    expect(freeTransform.start(mode)).toBe(true);
    const session = freeTransform.session;
    if (!session) throw new Error('No session');
    return session;
  };
  return {
    doc,
    editor,
    tools,
    background,
    photo,
    original,
    messages,
    freeTransform,
    start,
    view: new FakeViewport(tools),
    select: (area: Rect) =>
      editor.history.execute(new SetSelectionCommand(Selection.fromRect(W, H, area))),
  };
}

describe('Free Transform sessions', () => {
  it('preview on the overlay without touching the document or history', () => {
    const { editor, tools, photo, start } = setup();
    const session = start();
    expect(tools.session).toBe(session);
    expect(tools.options).toBe(session);
    expect(session.name).toBe('Free Transform');
    expect(editor.pending).toBe(session.edit);
    expect(tools.overlay).toMatchObject({
      shape: 'transform',
      layerId: photo.id,
      pixels: photo.pixels,
      x: 5,
      y: 4,
      matrix: [1, 0, 0, 1, 0, 0],
      corners: [
        { x: 5, y: 4 },
        { x: 15, y: 4 },
        { x: 15, y: 12 },
        { x: 5, y: 12 },
      ],
      pivot: { x: 10, y: 8 },
    });
    // Nothing in history: undo would cancel the session, and is offered as that.
    expect(editor.history.undoLabel).toBe('Free Transform');
    expect(editor.history.canRedo).toBe(false);
    expect(editor.isDirty).toBe(false);
  });

  it('apply as one Free Transform step on Enter, resampled with the session’s transform', () => {
    const { editor, tools, photo, original, view, start } = setup();
    const session = start();
    // The right edge's handle, dragged 10 px right: twice as wide, the left edge staying put.
    view.drag(15, 8, 25, 8);
    expect(session.params).toMatchObject({ x: 15, y: 8, scaleX: 2, scaleY: 1, angle: 0 });
    const m = session.matrix;
    expect(view.keyDown('Enter')).toBe(true);
    expect(undoLabels(editor)).toEqual(['Free Transform']);
    expect(tools.session).toBeNull();
    expect(editor.pending).toBeNull();
    expect(session.active).toBe(false);
    const expected = transformPixels(original, compose(m, translation(5, 4)), 'bilinear');
    expect(boundsOf(photo)).toEqual({ x: 5, y: 4, width: 20, height: 8 });
    expect(photo.pixels).toEqual(expected?.pixels);
    editor.history.undo();
    expect(boundsOf(photo)).toEqual({ x: 5, y: 4, width: 10, height: 8 });
    expect(photo.pixels).toEqual(original);
  });

  it('cancel on Escape, leaving history and the layer untouched', () => {
    const { editor, tools, photo, original, view, start } = setup();
    const session = start();
    view.drag(15, 8, 25, 8);
    expect(view.keyDown('Escape')).toBe(true);
    expect(session.active).toBe(false);
    expect(tools.session).toBeNull();
    expect(editor.pending).toBeNull();
    expect(editor.history.canUndo).toBe(false);
    expect(boundsOf(photo)).toEqual({ x: 5, y: 4, width: 10, height: 8 });
    expect(photo.pixels).toEqual(original);
  });

  it('add no step when applied unchanged, or changed back', () => {
    const { editor, tools, view, start } = setup();
    start();
    view.keyDown('Enter');
    expect(tools.session).toBeNull();
    expect(editor.history.canUndo).toBe(false);
    const session = start();
    view.keyDown('ArrowLeft');
    view.keyDown('ArrowRight');
    expect(session.apply()).toBe(true);
    expect(editor.history.canUndo).toBe(false);
  });

  it('move the box by whole pixels from inside it, and nudge it with the arrow keys', () => {
    const { editor, photo, original, view, start } = setup();
    const session = start();
    expect(view.tools.cursor).toBe('default');
    view.move(10, 8);
    expect(view.tools.cursor).toBe('move');
    view.drag(10, 8, 13.4, 9.6);
    expect(session.params).toMatchObject({ x: 13, y: 10 });
    view.keyDown('ArrowRight');
    view.keyDown('ArrowDown', { shiftKey: true });
    expect(session.params).toMatchObject({ x: 14, y: 20 });
    view.keyDown('Enter');
    // Only the session's step: the Move tool never saw the drag or the nudges.
    expect(undoLabels(editor)).toEqual(['Free Transform']);
    expect(boundsOf(photo)).toEqual({ x: 9, y: 16, width: 10, height: 8 });
    expect(photo.pixels).toEqual(original);
  });

  it('keep the proportions on a corner drag with Shift, and scale about the pivot with Alt', () => {
    const { view, start } = setup();
    const session = start();
    // The bottom-right corner, dragged by (10, 2) with Shift: projected onto the diagonal.
    view.drag(15, 12, 25, 14, { shiftKey: true });
    const k = (20 * 10 + 10 * 8) / (10 * 10 + 8 * 8);
    expect(session.params?.scaleX).toBeCloseTo(k, 12);
    expect(session.params?.scaleY).toBeCloseTo(k, 12);
    expect(session.overlay.corners[0].x).toBeCloseTo(5, 12);
    expect(session.overlay.corners[0].y).toBeCloseTo(4, 12);
    session.discard();

    const scaled = start();
    // The right edge with Alt: the pivot stays, so both edges move.
    view.drag(15, 8, 20, 8, { altKey: true });
    expect(scaled.params).toMatchObject({ x: 10, y: 8, scaleX: 2, scaleY: 1 });
    expect(scaled.overlay.corners[0]).toEqual({ x: 0, y: 4 });
    expect(scaled.overlay.corners[1]).toEqual({ x: 20, y: 4 });
  });

  it('follow Shift and Alt pressed or released during a drag', () => {
    const { view, start } = setup();
    const session = start();
    view.down(15, 12);
    view.move(25, 14);
    expect(session.params).toMatchObject({ scaleX: 2, scaleY: 1.25 });
    view.keyDown('Shift');
    expect(session.params?.scaleX).toBeCloseTo(session.params?.scaleY ?? NaN, 12);
    view.keyUp('Shift');
    view.keyDown('Alt');
    expect(session.params).toMatchObject({ x: 10, y: 8, scaleX: 3, scaleY: 1.5 });
    view.keyUp('Alt');
    view.up(25, 14);
    expect(session.params).toMatchObject({ scaleX: 2, scaleY: 1.25 });
  });

  it('rotate from just outside a corner, snapping to 15° steps with Shift', () => {
    const { editor, photo, original, view, start } = setup();
    const session = start();
    // 7 px past the bottom-right corner each way: beyond its handle, within the rotate zone.
    view.move(22, 19);
    expect(view.tools.cursor).toMatch(/^url\("data:image\/svg\+xml,/);
    view.move(30, 30);
    expect(view.tools.cursor).toBe('default');
    // From (12, 11) off the pivot (10, 8) round to (−11, 12): a quarter turn clockwise.
    view.drag(22, 19, -1, 20, { shiftKey: true });
    expect(session.params).toMatchObject({ x: 10, y: 8, scaleX: 1, scaleY: 1, angle: 90 });
    view.keyDown('Enter');
    expect(undoLabels(editor)).toEqual(['Free Transform']);
    // A quarter turn copies the pixels exactly.
    expect(boundsOf(photo)).toEqual({ x: 6, y: 3, width: 8, height: 10 });
    expect(photo.pixels).toEqual(oriented(original, 'rotate-cw'));
  });

  it('rotate freely without Shift, and to the nearest 15° with it', () => {
    const { view, start } = setup();
    const session = start();
    const radius = Math.hypot(12, 11);
    const from = Math.atan2(11, 12);
    const at = (degrees: number): [number, number] => {
      const angle = from + (degrees * Math.PI) / 180;
      return [10 + radius * Math.cos(angle), 8 + radius * Math.sin(angle)];
    };
    view.down(22, 19);
    view.move(...at(20));
    expect(session.params?.angle).toBeCloseTo(20, 9);
    view.move(...at(20), { shiftKey: true });
    expect(session.params?.angle).toBe(15);
    view.move(...at(-37));
    expect(session.params?.angle).toBe(-30);
    view.up(...at(-37));
  });

  it('put the box back when Escape cancels a drag, and cancel the session on a second', () => {
    const { tools, view, start } = setup();
    const session = start();
    view.down(10, 8);
    view.move(16, 8);
    expect(session.params?.x).toBe(16);
    expect(view.keyDown('Escape')).toBe(true);
    expect(session.params?.x).toBe(10);
    view.up(16, 8);
    expect(session.params?.x).toBe(10);
    expect(tools.session).toBe(session);
    view.keyDown('Escape');
    expect(tools.session).toBeNull();
  });

  it('apply on a double-click inside the box', () => {
    const { editor, view, start } = setup();
    start();
    view.keyDown('ArrowRight');
    view.doubleClick(30, 20);
    expect(view.tools.session).not.toBeNull();
    view.doubleClick(10, 8);
    expect(view.tools.session).toBeNull();
    expect(undoLabels(editor)).toEqual(['Free Transform']);
  });

  it('lift the selected pixels first, and transform the floating selection outline and all', () => {
    const { editor, doc, photo, view, select, start } = setup();
    select({ x: 7, y: 5, width: 4, height: 3 });
    const session = start();
    const floating = editor.floating;
    expect(floating).not.toBeNull();
    expect(session.source).toMatchObject({
      layerId: floating?.layerId,
      rect: { x: 7, y: 5, width: 4, height: 3 },
    });
    view.drag(9, 6.5, 14, 6.5);
    view.keyDown('Enter');
    const float = doc.layers.find((layer) => layer.id === floating?.layerId);
    expect(float && boundsOf(float)).toEqual({ x: 12, y: 5, width: 4, height: 3 });
    expect(doc.selection?.bounds()).toEqual({ x: 12, y: 5, width: 4, height: 3 });
    expect(editor.floating).toMatchObject({ layerId: floating?.layerId, edited: true });
    expect(editor.activeLayerId).toBe(floating?.layerId);
    expect(boundsOf(photo)).toEqual({ x: 5, y: 4, width: 10, height: 8 });
    expect(undoLabels(editor)).toEqual(['Free Transform', 'Lift Selection', 'Change Selection']);
  });

  it('undo the lift they began with when cancelled, or applied unchanged', () => {
    const { editor, doc, photo, original, view, select, start } = setup();
    select({ x: 7, y: 5, width: 4, height: 3 });
    start();
    view.drag(9, 6.5, 14, 6.5);
    view.keyDown('Escape');
    expect(undoLabels(editor)).toEqual(['Change Selection']);
    expect(editor.floating).toBeNull();
    expect(doc.layers).toHaveLength(2);
    expect(photo.pixels).toEqual(original);
    expect(doc.selection?.bounds()).toEqual({ x: 7, y: 5, width: 4, height: 3 });

    start();
    view.keyDown('Enter');
    expect(undoLabels(editor)).toEqual(['Change Selection']);
    expect(editor.floating).toBeNull();
  });

  it('transform a floating selection as it is, leaving its lift alone when cancelled', () => {
    const { editor, doc, photo, view, select, start } = setup();
    select({ x: 7, y: 5, width: 4, height: 3 });
    const lift = liftSelectionCommand(doc, photo.id);
    if (lift) editor.history.execute(lift);
    const floating = editor.floating;
    const session = start();
    expect(session.source.layerId).toBe(floating?.layerId);
    view.keyDown('Escape');
    expect(editor.floating).toBe(floating);
    expect(undoLabels(editor)).toEqual(['Lift Selection', 'Change Selection']);
  });

  it('refuse a hidden layer, or a selection that misses it, and say why', () => {
    const { editor, freeTransform, photo, messages, select } = setup();
    editor.history.execute(new SetLayerVisibilityCommand(photo.id, false));
    expect(freeTransform.start()).toBe(false);
    expect(messages).toEqual(['The active layer is hidden']);
    editor.history.undo();
    select({ x: 30, y: 20, width: 5, height: 5 });
    expect(freeTransform.start()).toBe(false);
    expect(messages).toEqual([
      'The active layer is hidden',
      'The selection misses the active layer',
    ]);
    expect(undoLabels(editor)).toEqual(['Change Selection']);
    expect(freeTransform.session).toBeNull();
    expect(editor.pending).toBeNull();
  });

  it('are applied first by a tool switch, or anything else that changes the document', () => {
    const { editor, tools, background, view, start } = setup();
    start();
    view.keyDown('ArrowRight');
    expect(tools.activate('rect-marquee')).toBe(true);
    expect(tools.session).toBeNull();
    expect(undoLabels(editor)).toEqual(['Free Transform']);

    start();
    view.keyDown('ArrowRight');
    editor.setActiveLayer(background.id);
    expect(tools.session).toBeNull();
    expect(undoLabels(editor)).toEqual(['Free Transform', 'Free Transform']);
  });

  it('are cancelled by undo, lift and all', () => {
    const { editor, doc, tools, view, select, start } = setup();
    select({ x: 7, y: 5, width: 4, height: 3 });
    const session = start();
    view.drag(9, 6.5, 14, 6.5);
    expect(editor.history.undo()).toBe(true);
    expect(session.active).toBe(false);
    expect(tools.session).toBeNull();
    expect(editor.pending).toBeNull();
    expect(editor.floating).toBeNull();
    expect(doc.layers).toHaveLength(2);
    expect(undoLabels(editor)).toEqual(['Change Selection']);
  });

  it('end without a step if the document is replaced under them', () => {
    const { editor, tools, start } = setup();
    const session = start();
    editor.replaceDocument(createDocument(8, 8));
    expect(session.active).toBe(false);
    expect(tools.session).toBeNull();
    expect(editor.pending).toBeNull();
    expect(editor.history.canUndo).toBe(false);
  });

  it('refuse to apply a result too big for a layer, with a message', () => {
    const { editor, tools, messages, freeTransform, view, start } = setup();
    freeTransform.options.set({ unit: 'px' });
    const session = start();
    expect(session.setField('width', 9000)).toBe(true);
    view.keyDown('Enter');
    expect(messages).toEqual(['A transformed layer can be at most 8192 × 8192 pixels']);
    expect(tools.session).toBe(session);
    expect(editor.pending).toBe(session.edit);
    expect(editor.isDirty).toBe(false);
  });

  it('cut a result too big for a layer to the canvas when applied by something else', () => {
    const { editor, tools, messages, freeTransform, photo, start } = setup();
    freeTransform.options.set({ unit: 'px' });
    const session = start();
    session.setField('width', 9000);
    tools.activate('rect-marquee');
    expect(messages).toEqual(['The transformed layer was cut to the canvas']);
    expect(undoLabels(editor)).toEqual(['Free Transform']);
    expect(boundsOf(photo)).toEqual({ x: 0, y: 4, width: W, height: 8 });
  });

  it('take the options bar’s fields, refusing values out of range', () => {
    const { view, start } = setup();
    const session = start();
    let changes = 0;
    session.subscribe(() => changes++);
    expect(session.setField('width', 200)).toBe(true);
    expect(session.params).toMatchObject({ scaleX: 2, scaleY: 1 });
    expect(session.overlay.corners[0]).toEqual({ x: 0, y: 4 });
    expect(session.setField('angle', 45)).toBe(true);
    expect(session.setField('width', 0)).toBe(false);
    expect(session.setField('x', Number.NaN)).toBe(false);
    expect(changes).toBe(2);
    expect(session.params).toMatchObject({ x: 10, y: 8, scaleX: 2, scaleY: 1, angle: 45 });
    view.keyDown('Escape');
  });

  it('resample with the interpolation chosen in the options', () => {
    const { freeTransform, photo, original, view, start } = setup();
    freeTransform.options.set({ interpolation: 'nearest' });
    const session = start();
    expect(session.overlay.interpolation).toBe('nearest');
    session.setField('angle', 30);
    const m = session.matrix;
    view.keyDown('Enter');
    const expected = transformPixels(original, compose(m, translation(5, 4)), 'nearest');
    expect(photo.pixels).toEqual(expected?.pixels);
  });

  it('switch between Free Transform, Scale and Rotate, which only scale or only rotate', () => {
    const { editor, view, start } = setup();
    const session = start('scale');
    expect(session.name).toBe('Scale');
    expect(editor.pending?.label).toBe('Scale');
    // No rotate zone round the corners.
    view.drag(22, 19, -1, 20);
    expect(session.params?.angle).toBe(0);
    expect(start('rotate')).toBe(session);
    expect(session.name).toBe('Rotate');
    // The handles rotate: the right edge's, dragged a quarter turn round the pivot.
    view.drag(15, 8, 10, 13, { shiftKey: true });
    expect(session.params).toMatchObject({ scaleX: 1, scaleY: 1, angle: 90 });
    expect(start('free')).toBe(session);
    view.keyDown('Enter');
    expect(undoLabels(editor)).toEqual(['Free Transform']);
  });

  it('flip and turn the transformed layer about its pivot, as the canvas sees it', () => {
    const { editor, photo, original, view, start } = setup();
    const session = start();
    session.orient('flip-horizontal');
    expect(session.params).toMatchObject({ scaleX: -1, scaleY: 1, angle: 0 });
    session.orient('flip-horizontal');
    expect(session.params).toMatchObject({ scaleX: 1, scaleY: 1, angle: 0 });
    session.orient('rotate-ccw');
    view.keyDown('Enter');
    expect(undoLabels(editor)).toEqual(['Free Transform']);
    expect(photo.pixels).toEqual(oriented(original, 'rotate-ccw'));
  });

  it('offer their turns and flips, Apply and Cancel on the canvas’s context menu', () => {
    const { editor, tools, photo, original, start } = setup();
    start();
    const menu = tools.contextMenu();
    expect(menu.map((section) => section.map((item) => item.label))).toEqual([
      ['Flip Horizontal', 'Flip Vertical'],
      ['Rotate 180°', 'Rotate 90° Clockwise', 'Rotate 90° Anticlockwise'],
      ['Apply', 'Cancel'],
    ]);
    const run = (label: string) =>
      tools
        .contextMenu()
        .flat()
        .find((item) => item.label === label)
        ?.run();
    run('Rotate 180°');
    expect(photo.pixels).toEqual(original);
    run('Apply');
    expect(tools.session).toBeNull();
    expect(undoLabels(editor)).toEqual(['Free Transform']);
    expect(photo.pixels).toEqual(oriented(original, 'rotate-180'));

    start();
    run('Flip Vertical');
    run('Cancel');
    expect(tools.session).toBeNull();
    expect(undoLabels(editor)).toEqual(['Free Transform']);
    expect(photo.pixels).toEqual(oriented(original, 'rotate-180'));
  });

  it('start from the canvas’s context menu as from the Edit menu, lifting a selection', () => {
    const { editor, tools, freeTransform, select } = setup();
    select({ x: 6, y: 5, width: 4, height: 3 });
    const controller = { blocked: false, openDuplicateLayer() {}, openDeleteLayer() {} };
    const menu = () =>
      canvasMenuSections(editor, controller, freeTransform, tools.contextMenu(), {
        exclusive: tools.session !== null,
      });
    const item = menu()
      .flat()
      .find((entry) => entry.label === 'Free Transform');
    expect(item?.disabled).toBe(false);
    item?.run();
    expect(freeTransform.session?.mode).toBe('free');
    expect(editor.floating?.layerId).toBe(editor.activeLayerId);
    expect(editor.pending?.label).toBe('Free Transform');
    expect(
      menu()
        .flat()
        .map((entry) => entry.label),
    ).toEqual([
      'Flip Horizontal',
      'Flip Vertical',
      'Rotate 180°',
      'Rotate 90° Clockwise',
      'Rotate 90° Anticlockwise',
      'Apply',
      'Cancel',
    ]);
  });
});

describe('Edit → Transform’s turns and flips', () => {
  it('turn the active layer losslessly, one step each, back to the same bytes and place', () => {
    const { editor, freeTransform, photo, original } = setup();
    expect(freeTransform.orient('rotate-cw')).toBe(true);
    expect(photo.pixels).toEqual(oriented(original, 'rotate-cw'));
    // About its centre, (10, 8).
    expect(boundsOf(photo)).toEqual({ x: 6, y: 3, width: 8, height: 10 });
    expect(freeTransform.orient('rotate-ccw')).toBe(true);
    freeTransform.orient('flip-horizontal');
    freeTransform.orient('flip-horizontal');
    expect(photo.pixels).toEqual(original);
    expect(boundsOf(photo)).toEqual({ x: 5, y: 4, width: 10, height: 8 });
    expect(freeTransform.session).toBeNull();
    expect(undoLabels(editor)).toEqual([
      'Flip Horizontal',
      'Flip Horizontal',
      'Rotate 90° Anticlockwise',
      'Rotate 90° Clockwise',
    ]);
  });

  it('turn the whole layer under a selection, which stays as it is', () => {
    const { doc, editor, freeTransform, photo, original, select } = setup();
    select({ x: 7, y: 5, width: 4, height: 3 });
    freeTransform.orient('flip-horizontal');
    expect(photo.pixels).toEqual(oriented(original, 'flip-horizontal'));
    expect(boundsOf(photo)).toEqual({ x: 5, y: 4, width: 10, height: 8 });
    expect(doc.selection?.bounds()).toEqual({ x: 7, y: 5, width: 4, height: 3 });
    expect(editor.floating).toBeNull();
  });

  it('turn a floating selection with its outline', () => {
    const { doc, editor, freeTransform, photo, select } = setup();
    select({ x: 7, y: 5, width: 4, height: 3 });
    const lift = liftSelectionCommand(doc, photo.id);
    if (lift) editor.history.execute(lift);
    const floating = editor.floating;
    expect(freeTransform.orient('rotate-cw')).toBe(true);
    // 3 × 4 about (9, 6.5) would start at (7.5, 4.5): half a pixel further from (7, 5).
    const float = doc.layers.find((layer) => layer.id === floating?.layerId);
    expect(float && boundsOf(float)).toEqual({ x: 8, y: 4, width: 3, height: 4 });
    expect(doc.selection?.bounds()).toEqual({ x: 8, y: 4, width: 3, height: 4 });
    expect(editor.floating).toMatchObject({ layerId: floating?.layerId, edited: true });
    expect(undoLabels(editor)).toEqual([
      'Rotate 90° Clockwise',
      'Lift Selection',
      'Change Selection',
    ]);
  });

  it('compose into a running session instead', () => {
    const { editor, freeTransform, photo, original, view, start } = setup();
    const session = start();
    expect(freeTransform.orient('flip-vertical')).toBe(true);
    expect(photo.pixels).toEqual(original);
    expect(editor.pending).toBe(session.edit);
    view.keyDown('Enter');
    expect(photo.pixels).toEqual(oriented(original, 'flip-vertical'));
    expect(undoLabels(editor)).toEqual(['Free Transform']);
  });

  it('refuse a hidden layer, and say why', () => {
    const { editor, freeTransform, photo, original, messages } = setup();
    editor.history.execute(new SetLayerVisibilityCommand(photo.id, false));
    expect(freeTransform.orient('flip-horizontal')).toBe(false);
    expect(messages).toEqual(['The active layer is hidden']);
    expect(photo.pixels).toEqual(original);
    expect(undoLabels(editor)).toHaveLength(1);
  });
});
