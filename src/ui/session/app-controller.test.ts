import { describe, expect, it } from 'vitest';
import { Editor, SetLayerVisibilityCommand, createBlankDocument } from '../../core';
import { decodePng, encodePng } from '../io/png';
import { AppController } from './app-controller';
import { DocumentSession } from './document-session';
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
  const controller = new AppController(session);
  const makeDirty = () => {
    const layer = editor.document.layers[0];
    if (layer) editor.history.execute(new SetLayerVisibilityCommand(layer.id, !layer.visible));
  };
  return { editor, store, session, controller, makeDirty };
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
