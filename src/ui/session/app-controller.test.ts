import { describe, expect, it } from 'vitest';
import type { Rect } from '../../core';
import {
  DEFAULT_NEW_DOCUMENT,
  Editor,
  Selection,
  SetLayerVisibilityCommand,
  SetSelectionCommand,
  createBlankDocument,
  createPixelBuffer,
  duplicateName,
  liftSelectionCommand,
} from '../../core';
import type { FillSettings } from '../edit-actions';
import { DEFAULT_FILL_SETTINGS } from '../edit-actions';
import type { DroppedData } from '../io/file-store';
import { runLayerAction } from '../layer-actions';
import { decodePng, encodePng } from '../io/png';
import { FakeClock } from '../tools/fake-clock';
import { AppController } from './app-controller';
import { DocumentSession } from './document-session';
import { DEFAULT_EXPORT_OPTIONS } from './file-types';
import { MemoryFileStore } from './memory-file-store';

function setup() {
  const editor = new Editor(createBlankDocument({ width: 4, height: 3, background: 'white' }));
  const store = new MemoryFileStore();
  const session = new DocumentSession({
    editor,
    store,
    png: {
      encode: (pixels) => Promise.resolve(encodePng(pixels)),
      decode: (bytes) => Promise.resolve(decodePng(bytes)),
    },
    decodeImage: async (file) => decodePng(new Uint8Array(await file.arrayBuffer())),
    encodeImage: () => Promise.resolve(new Blob(['image'])),
  });
  const clock = new FakeClock();
  const controller = new AppController(session, clock);
  const makeDirty = () => {
    const layer = editor.document.layers[0];
    if (layer) editor.history.execute(new SetLayerVisibilityCommand(layer.id, !layer.visible));
  };
  return { editor, store, session, controller, clock, makeDirty };
}

/** Lets pending promise callbacks (the controller's async tasks) run. */
function settle(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

describe('AppController', () => {
  it('opens the New dialog directly when nothing is unsaved', () => {
    const { controller, editor } = setup();
    controller.run('new');
    return settle().then(() => {
      expect(controller.modal).toEqual({ kind: 'new-document' });
      controller.createDocument({ width: 9, height: 8, background: 'white' });
      expect(controller.modal).toBeNull();
      expect(editor.document.width).toBe(9);
    });
  });

  it('asks before discarding unsaved changes, and keeps them on Cancel', async () => {
    const { controller, session, editor, makeDirty } = setup();
    makeDirty();
    const before = editor.document;

    for (const command of ['new', 'open', 'close', 'demo'] as const) {
      controller.run(command);
      await settle();
      expect(controller.modal).toEqual({ kind: 'confirm-discard', documentName: 'Untitled-1' });
      expect(controller.blocked).toBe(true);
      controller.dismiss();
      await settle();
      expect(controller.modal).toBeNull();
      expect(controller.busy).toBe(false);
      expect(editor.document).toBe(before);
      expect(session.isDirty).toBe(true);
    }
  });

  it('carries on once the user agrees to discard', async () => {
    const { controller, session, editor, makeDirty } = setup();
    makeDirty();
    controller.run('close');
    await settle();
    controller.answerDiscard(true);
    await settle();
    expect(controller.modal).toBeNull();
    expect(session.name).toBe('Untitled-2');
    expect(editor.document.width).toBe(1920);

    makeDirty();
    controller.run('new');
    await settle();
    controller.answerDiscard(true);
    await settle();
    expect(controller.modal).toEqual({ kind: 'new-document' });
  });

  it('asks before the open picker when there are unsaved changes', async () => {
    const { controller, store, makeDirty } = setup();
    makeDirty();
    controller.run('open');
    await settle();
    expect(store.openPickers).toHaveLength(0);
    controller.answerDiscard(true);
    await settle();
    expect(store.openPickers).toHaveLength(1);
  });

  it('ignores commands while a dialog is open or an operation is running', async () => {
    const { controller, store } = setup();
    controller.run('export');
    expect(controller.modal).toEqual({ kind: 'export' });
    controller.run('save');
    controller.run('new');
    await settle();
    expect(store.savePickers).toHaveLength(0);
    expect(controller.modal).toEqual({ kind: 'export' });

    controller.dismiss();
    controller.run('save');
    expect(controller.busy).toBe(true);
    controller.run('save-as');
    await settle();
    expect(controller.busy).toBe(false);
    expect(store.savePickers).toHaveLength(1);
  });

  it('exports with the chosen options from the Export dialog', async () => {
    const { controller, store } = setup();
    controller.exportImage({ format: 'png', quality: 1 });
    expect(store.savePickers).toHaveLength(0);

    controller.run('export');
    store.saveName = 'out.webp';
    controller.exportImage({ format: 'webp', quality: 0.8 });
    expect(controller.modal).toBeNull();
    await settle();
    expect(store.savePickers.at(-1)?.suggestedName).toBe('Untitled-1.webp');
    expect(store.files.has('out.webp')).toBe(true);
  });

  it('offers the last used New and Export settings again', async () => {
    const { controller } = setup();
    expect(controller.newDocumentOptions).toEqual(DEFAULT_NEW_DOCUMENT);
    expect(controller.exportOptions).toEqual(DEFAULT_EXPORT_OPTIONS);

    controller.run('new');
    await settle();
    const size = { width: 640, height: 480, background: 'transparent' } as const;
    controller.createDocument(size);
    controller.run('export');
    controller.exportImage({ format: 'jpeg', quality: 0.5 });
    await settle();

    expect(controller.newDocumentOptions).toEqual(size);
    expect(controller.exportOptions).toEqual({ format: 'jpeg', quality: 0.5 });
  });

  it('keeps the previous New settings when creating fails', async () => {
    const { controller } = setup();
    const originalError = console.error;
    console.error = () => undefined;
    try {
      controller.run('new');
      await settle();
      controller.createDocument({ width: 0, height: 10, background: 'white' });
    } finally {
      console.error = originalError;
    }
    expect(controller.modal).toMatchObject({ kind: 'error' });
    expect(controller.newDocumentOptions).toEqual(DEFAULT_NEW_DOCUMENT);
  });

  it('shows failures in an error dialog', async () => {
    const { controller, store } = setup();
    const originalError = console.error;
    console.error = () => undefined;
    try {
      store.pick = new File(['nope'], 'bad.png');
      controller.run('import');
      await settle();
    } finally {
      console.error = originalError;
    }
    expect(controller.modal).toMatchObject({
      kind: 'error',
      title: "Couldn't import “bad.png”",
      message: 'Not a PNG image.',
    });
    expect(controller.busy).toBe(false);
    controller.dismiss();
    expect(controller.modal).toBeNull();
  });

  it('notifies subscribers of state changes', () => {
    const { controller } = setup();
    let calls = 0;
    controller.subscribe(() => calls++);
    controller.run('export');
    controller.dismiss();
    expect(calls).toBe(2);
  });
});

/** A drop's `DataTransfer`: a dragged link's text, then the files. */
function drop(...files: File[]): DroppedData {
  return {
    items: [
      { kind: 'string', getAsFile: () => null },
      ...files.map((file) => ({ kind: 'file', getAsFile: () => file })),
    ],
  };
}

describe('AppController: dropped files', () => {
  it('opens a dropped .soup document, which Save writes back to', async () => {
    const { controller, session, store, editor, makeDirty } = setup();
    store.saveName = 'art.soup';
    await session.saveAs();
    session.close();

    expect(controller.openDropped(drop(store.file('art.soup'), new File(['x'], 'b.png')))).toBe(
      true,
    );
    expect(controller.busy).toBe(true);
    await settle();
    expect(controller.busy).toBe(false);
    expect(controller.modal).toBeNull();
    expect(session.name).toBe('art');
    expect(editor.document.width).toBe(4);
    expect(store.openPickers).toHaveLength(0);

    makeDirty();
    await session.save();
    expect(store.savePickers).toHaveLength(1);
  });

  it('opens a dropped image as a new document that Save does not overwrite', async () => {
    const { controller, session, store, editor } = setup();
    controller.openDropped(drop(new File([encodePng(createPixelBuffer(5, 2))], 'cat.png')));
    await settle();
    expect(session.name).toBe('cat');
    expect(editor.document).toMatchObject({ width: 5, height: 2 });
    expect(session.savesInPlace).toBe(false);
    await session.save();
    expect(store.savePickers.map((r) => r.suggestedName)).toEqual(['cat.soup']);
  });

  it('asks before discarding unsaved changes, and keeps them on Cancel', async () => {
    const { controller, session, editor, makeDirty } = setup();
    makeDirty();
    const before = editor.document;
    const png = new File([encodePng(createPixelBuffer(5, 2))], 'cat.png');

    controller.openDropped(drop(png));
    await settle();
    expect(controller.modal).toEqual({ kind: 'confirm-discard', documentName: 'Untitled-1' });
    controller.dismiss();
    await settle();
    expect(editor.document).toBe(before);
    expect(session.isDirty).toBe(true);

    controller.openDropped(drop(png));
    await settle();
    controller.answerDiscard(true);
    await settle();
    expect(session.name).toBe('cat');
  });

  it('ignores drops without files, and drops while a dialog is open', async () => {
    const { controller, editor } = setup();
    const before = editor.document;
    expect(controller.openDropped(drop())).toBe(false);
    expect(controller.busy).toBe(false);

    controller.run('export');
    const png = new File([encodePng(createPixelBuffer(5, 2))], 'cat.png');
    expect(controller.openDropped(drop(png))).toBe(false);
    await settle();
    expect(controller.modal).toEqual({ kind: 'export' });
    expect(editor.document).toBe(before);
  });

  it("shows a file it can't open in an error dialog", async () => {
    const { controller, session } = setup();
    const originalError = console.error;
    console.error = () => undefined;
    try {
      controller.openDropped(drop(new File(['hello'], 'notes.txt')));
      await settle();
    } finally {
      console.error = originalError;
    }
    expect(controller.modal).toMatchObject({ kind: 'error', title: "Couldn't open “notes.txt”" });
    expect(session.name).toBe('Untitled-1');
  });
});

/** Gives the 4×3 background layer pixels that all differ, so a transform shows. */
function pattern(editor: Editor) {
  const layer = editor.document.layers[0];
  if (!layer) throw new Error('No layer');
  layer.pixels.data.forEach((_, i, data) => (data[i] = (i * 37 + 11) % 256));
  return layer;
}

/** The layer's placement and a copy of its pixels, to check undo against. */
function snapshot(editor: Editor) {
  const layer = editor.document.layers[0];
  if (!layer) throw new Error('No layer');
  const { x, y, pixels } = layer;
  return { x, y, width: pixels.width, height: pixels.height, data: [...pixels.data] };
}

function select(editor: Editor, area: Rect): void {
  const { width, height } = editor.document;
  editor.history.execute(new SetSelectionCommand(Selection.fromRect(width, height, area)));
}

describe('AppController image dialogs', () => {
  it('resizes the image and remembers the settings', () => {
    const { controller, editor } = setup();
    controller.openDialog('image-size');
    expect(controller.modal).toEqual({ kind: 'image-size' });
    expect(controller.blocked).toBe(true);
    controller.resizeImage({
      width: 8,
      height: 6,
      unit: 'percent',
      keepAspect: false,
      interpolation: 'nearest',
    });
    expect(controller.modal).toBeNull();
    expect([editor.document.width, editor.document.height]).toEqual([8, 6]);
    expect(editor.history.undoLabel).toBe('Image Size');
    expect(controller.imageSizeSettings).toEqual({
      unit: 'percent',
      keepAspect: false,
      interpolation: 'nearest',
    });
  });

  it('resizes the canvas about the anchor and remembers Relative', () => {
    const { controller, editor } = setup();
    controller.openDialog('canvas-size');
    expect(controller.modal).toEqual({ kind: 'canvas-size' });
    controller.resizeCanvas({
      width: 6,
      height: 5,
      horizontal: 'end',
      vertical: 'end',
      relative: true,
    });
    expect([editor.document.width, editor.document.height]).toEqual([6, 5]);
    expect(editor.document.layers[0]).toMatchObject({ x: 2, y: 2 });
    expect(editor.history.undoLabel).toBe('Canvas Size');
    expect(controller.canvasSizeSettings).toEqual({ relative: true });
  });

  it('adds no step for a size that would change nothing', () => {
    const { controller, editor } = setup();
    controller.openDialog('image-size');
    controller.resizeImage({ width: 4, height: 3, ...controller.imageSizeSettings });
    controller.openDialog('canvas-size');
    controller.resizeCanvas({
      width: 4,
      height: 3,
      horizontal: 'start',
      vertical: 'end',
      relative: false,
    });
    expect(controller.modal).toBeNull();
    expect(editor.history.canUndo).toBe(false);
  });

  it('commits a floating selection before resizing', () => {
    const { controller, editor } = setup();
    select(editor, { x: 0, y: 0, width: 2, height: 2 });
    const lift = liftSelectionCommand(editor.document, 'layer-1');
    if (lift) editor.history.execute(lift);
    expect(editor.floating).not.toBeNull();
    controller.openDialog('canvas-size');
    controller.resizeCanvas({
      width: 5,
      height: 3,
      horizontal: 'start',
      vertical: 'start',
      relative: false,
    });
    expect(editor.floating).toBeNull();
    expect(editor.document.width).toBe(5);
    editor.history.undo();
    expect(editor.history.undoLabel).toBe('Commit Floating Selection');
  });

  it('ignores Image menu dialogs while another dialog is open', () => {
    const { controller } = setup();
    controller.run('export');
    for (const dialog of ['image-size', 'canvas-size', 'rotate-layer'] as const) {
      controller.openDialog(dialog);
      expect(controller.modal).toEqual({ kind: 'export' });
    }
  });

  it('previews Rotate Layer once a frame, from the original pixels each time', () => {
    const { controller, editor, clock } = setup();
    pattern(editor);
    const before = snapshot(editor);
    controller.openDialog('rotate-layer');
    expect(controller.modal).toEqual({ kind: 'rotate-layer', target: 'layer' });

    controller.previewRotation(10);
    controller.previewRotation(90);
    expect(clock.pendingFrames).toBe(1);
    expect(editor.history.canUndo).toBe(false);
    clock.runFrame();
    expect(snapshot(editor)).toMatchObject({ width: 3, height: 4 });

    controller.previewRotation(180);
    clock.runFrame();
    expect(snapshot(editor)).toMatchObject({ width: 4, height: 3 });
    expect(editor.history.undoLabel).toBe('Rotate Layer');
    controller.previewRotation(0);
    clock.runFrame();
    expect(snapshot(editor)).toEqual(before);
    expect(editor.history.canUndo).toBe(false);
  });

  it('keeps the rotation on Rotate, as one step', () => {
    const { controller, editor, clock } = setup();
    pattern(editor);
    const before = snapshot(editor);
    controller.openDialog('rotate-layer');
    controller.previewRotation(30);
    clock.runFrame();
    controller.rotateLayer(90);
    expect(controller.modal).toBeNull();
    expect(clock.pendingFrames).toBe(0);
    expect(snapshot(editor)).toMatchObject({ width: 3, height: 4 });
    editor.history.undo();
    expect(snapshot(editor)).toEqual(before);
    expect(editor.history.canUndo).toBe(false);
  });

  it('rotates on Rotate even before a preview frame', () => {
    const { controller, editor } = setup();
    pattern(editor);
    controller.openDialog('rotate-layer');
    controller.rotateLayer(-90);
    expect(snapshot(editor)).toMatchObject({ width: 3, height: 4 });
    expect(editor.history.undoLabel).toBe('Rotate Layer');
  });

  it('puts the layer back exactly on Cancel', () => {
    const { controller, editor, clock } = setup();
    pattern(editor);
    const before = snapshot(editor);
    controller.openDialog('rotate-layer');
    controller.previewRotation(15);
    clock.runFrame();
    expect(snapshot(editor)).not.toEqual(before);
    controller.previewRotation(20);
    controller.dismiss();
    expect(controller.modal).toBeNull();
    expect(clock.pendingFrames).toBe(0);
    expect(snapshot(editor)).toEqual(before);
    expect(editor.history.canUndo).toBe(false);
  });

  it('lifts selected pixels into a floating selection and turns them', () => {
    const { controller, editor, clock } = setup();
    pattern(editor);
    const before = snapshot(editor);
    select(editor, { x: 0, y: 0, width: 2, height: 3 });
    controller.openDialog('rotate-layer');
    expect(controller.modal).toEqual({ kind: 'rotate-layer', target: 'selection' });
    controller.previewRotation(90);
    clock.runFrame();
    expect(editor.floating).not.toBeNull();
    // A 2×3 block turned about its centre (1, 1.5) spans x −0.5…2.5, y 0.5…2.5, then shifts
    // half a pixel each way onto pixel corners.
    expect(editor.document.selection?.bounds()).toEqual({ x: 0, y: 1, width: 3, height: 2 });
    controller.previewRotation(-90);
    clock.runFrame();
    expect(editor.document.layers).toHaveLength(2);
    controller.rotateLayer(-90);
    expect(editor.history.undoLabel).toBe('Rotate Selection');
    editor.history.undo();
    expect(editor.history.undoLabel).toBe('Lift Selection');
    editor.history.undo();
    expect(editor.floating).toBeNull();
    expect(snapshot(editor)).toEqual(before);
  });

  it('leaves no lift behind on Cancel, or on Rotate at 0°', () => {
    for (const close of ['cancel', 'zero'] as const) {
      const { controller, editor, clock } = setup();
      pattern(editor);
      const before = snapshot(editor);
      select(editor, { x: 0, y: 0, width: 2, height: 3 });
      const state = editor.history.stateId;
      controller.openDialog('rotate-layer');
      controller.previewRotation(45);
      clock.runFrame();
      expect(editor.floating).not.toBeNull();
      if (close === 'cancel') controller.dismiss();
      else controller.rotateLayer(0);
      expect(editor.floating).toBeNull();
      expect(editor.history.stateId).toBe(state);
      expect(editor.document.layers).toHaveLength(1);
      expect(snapshot(editor)).toEqual(before);
    }
  });

  it("doesn't open Rotate Layer with nothing to turn", () => {
    const { controller, editor } = setup();
    editor.history.execute(new SetLayerVisibilityCommand('layer-1', false));
    controller.openDialog('rotate-layer');
    expect(controller.modal).toBeNull();
  });
});

describe('AppController Fill dialog', () => {
  const HALF_RED: FillSettings = {
    contents: 'custom',
    custom: [255, 0, 0],
    opacity: 50,
    preserveTransparency: false,
  };

  it('fills the active layer as chosen, and remembers the settings', () => {
    const { controller, editor } = setup();
    expect(controller.fillSettings).toEqual(DEFAULT_FILL_SETTINGS);
    select(editor, { x: 1, y: 1, width: 1, height: 1 });
    controller.openFill();
    expect(controller.modal).toEqual({ kind: 'fill' });
    expect(controller.blocked).toBe(true);
    controller.fill(HALF_RED, [255, 0, 0]);
    expect(controller.modal).toBeNull();
    expect(editor.history.undoLabel).toBe('Fill');
    // Half red over white: green and blue 255 × 0.5 = 127.5, rounded to 128.
    const data = editor.document.layers[0]?.pixels.data ?? [];
    expect([...data.slice(20, 24)]).toEqual([255, 128, 128, 255]);
    expect([...data.slice(16, 20)]).toEqual([255, 255, 255, 255]);
    expect(controller.fillSettings).toEqual(HALF_RED);
  });

  it('preserves transparency when asked', () => {
    const { controller, editor } = setup();
    const layer = pattern(editor);
    layer.pixels.data[3] = 0;
    const before = snapshot(editor);
    controller.openFill();
    controller.fill({ ...HALF_RED, opacity: 100, preserveTransparency: true }, [255, 0, 0]);
    const after = snapshot(editor).data;
    expect(after.slice(0, 4)).toEqual(before.data.slice(0, 4));
    expect(after.slice(4, 8)).toEqual([255, 0, 0, before.data[7]]);
  });

  it('keeps the previous settings and the pixels on Cancel', () => {
    const { controller, editor } = setup();
    controller.openFill();
    controller.dismiss();
    expect(controller.modal).toBeNull();
    expect(controller.fillSettings).toEqual(DEFAULT_FILL_SETTINGS);
    expect(editor.history.canUndo).toBe(false);
    controller.fill(HALF_RED, [255, 0, 0]);
    expect(editor.history.canUndo).toBe(false);
  });

  it("doesn't open over another dialog, or with the active layer hidden", () => {
    const { controller, editor } = setup();
    controller.run('export');
    controller.openFill();
    expect(controller.modal).toEqual({ kind: 'export' });
    controller.dismiss();
    editor.history.execute(new SetLayerVisibilityCommand('layer-1', false));
    controller.openFill();
    expect(controller.modal).toBeNull();
  });
});

describe('AppController: Duplicate Layer…', () => {
  const layerNames = (editor: Editor) => editor.document.layers.map((layer) => layer.name);

  it('asks for a name, offering “<name> copy”', () => {
    const { controller } = setup();
    controller.openDuplicateLayer();
    expect(controller.modal).toEqual({ kind: 'duplicate-layer', layerName: 'Background' });
    expect(duplicateName('Background')).toBe('Background copy');
  });

  it('duplicates the active layer under the name given, directly above, in one step', () => {
    const { controller, editor } = setup();
    runLayerAction(editor, 'new');
    editor.setActiveLayer('layer-1');
    controller.openDuplicateLayer();
    controller.duplicateLayer('  Sky  ');
    expect(controller.modal).toBeNull();
    expect(layerNames(editor)).toEqual(['Background', 'Sky', 'Layer 1']);
    expect(editor.activeLayer?.name).toBe('Sky');
    expect(Array.from(editor.activeLayer?.pixels.data ?? [])).toEqual(
      Array.from(editor.document.layers[0]?.pixels.data ?? []),
    );
    expect(editor.history.undoLabel).toBe('Duplicate Layer');
    editor.history.undo();
    expect(layerNames(editor)).toEqual(['Background', 'Layer 1']);
  });

  it('refuses a blank name and keeps the dialog open', () => {
    const { controller, editor } = setup();
    controller.openDuplicateLayer();
    controller.duplicateLayer('   ');
    expect(controller.modal).toEqual({ kind: 'duplicate-layer', layerName: 'Background' });
    expect(editor.history.canUndo).toBe(false);
  });

  it('changes nothing on Cancel', () => {
    const { controller, editor } = setup();
    controller.openDuplicateLayer();
    controller.dismiss();
    expect(controller.modal).toBeNull();
    controller.duplicateLayer('Sky');
    expect(layerNames(editor)).toEqual(['Background']);
    expect(editor.history.canUndo).toBe(false);
  });
});

describe('AppController: Delete Layer', () => {
  function twoLayers() {
    const context = setup();
    runLayerAction(context.editor, 'new');
    return context;
  }

  it('asks for confirmation, naming the layer', () => {
    const { controller } = twoLayers();
    controller.openDeleteLayer();
    expect(controller.modal).toEqual({ kind: 'delete-layer', layerName: 'Layer 1' });
  });

  it('keeps the layer on Cancel', () => {
    const { controller, editor } = twoLayers();
    controller.openDeleteLayer();
    controller.dismiss();
    expect(controller.modal).toBeNull();
    controller.deleteLayer();
    expect(editor.document.layers).toHaveLength(2);
    expect(editor.history.undoLabel).toBe('New Layer');
  });

  it('deletes the active layer on Delete, undoably', () => {
    const { controller, editor } = twoLayers();
    controller.openDeleteLayer();
    controller.deleteLayer();
    expect(controller.modal).toBeNull();
    expect(editor.document.layers.map((layer) => layer.name)).toEqual(['Background']);
    expect(editor.history.undoLabel).toBe('Delete Layer');
    editor.history.undo();
    expect(editor.document.layers.map((layer) => layer.name)).toEqual(['Background', 'Layer 1']);
  });

  it("doesn't ask for the only layer, or over another dialog", () => {
    const { controller, editor } = setup();
    controller.openDeleteLayer();
    expect(controller.modal).toBeNull();
    runLayerAction(editor, 'new');
    controller.run('export');
    controller.openDeleteLayer();
    controller.openDuplicateLayer();
    expect(controller.modal).toEqual({ kind: 'export' });
  });
});
