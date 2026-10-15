import { describe, expect, it } from 'vitest';
import type { PixelBuffer, PngCodec } from '../../core';
import {
  Editor,
  MoveLayerCommand,
  Selection,
  SetLayerVisibilityCommand,
  SetSelectionCommand,
  createBlankDocument,
  createPixelBuffer,
  deserializeDocument,
  getPixel,
  liftSelectionCommand,
  newLayerCommand,
  setPixel,
} from '../../core';
import { decodePng, encodePng } from '../io/png';
import type { DocumentSessionDeps } from './document-session';
import { DocumentSession, FileOperationError, baseName } from './document-session';
import type { ExportOptions } from './file-types';
import { IMAGE_FILE_TYPE, OPEN_FILE_TYPES, PIXELSOUP_MIME_TYPE } from './file-types';
import { MemoryFileStore } from './memory-file-store';

const png: PngCodec = {
  encode: (pixels) => Promise.resolve(encodePng(pixels)),
  decode: (bytes) => Promise.resolve(decodePng(bytes)),
};

async function decodeImage(file: Blob): Promise<PixelBuffer> {
  return decodePng(new Uint8Array(await file.arrayBuffer()));
}

function pngFile(name: string, pixels: PixelBuffer): File {
  return new File([encodePng(pixels)], name, { type: 'image/png' });
}

function setup(store = new MemoryFileStore()) {
  const editor = new Editor(createBlankDocument({ width: 4, height: 3, background: 'white' }));
  const exported: { pixels: PixelBuffer; options: ExportOptions }[] = [];
  const deps: DocumentSessionDeps = {
    editor,
    store,
    png,
    decodeImage,
    encodeImage: (pixels, options) => {
      exported.push({ pixels: { ...pixels, data: pixels.data.slice() }, options });
      return Promise.resolve(new Blob([options.format]));
    },
  };
  return { editor, store, exported, session: new DocumentSession(deps) };
}

function hideBottomLayer(editor: Editor): void {
  const layer = editor.document.layers[0];
  if (!layer) throw new Error('no layer');
  editor.history.execute(new SetLayerVisibilityCommand(layer.id, !layer.visible));
}

/**
 * Paints the background's top-left pixel red, then lifts it into a floating selection
 * and moves that to (2, 1), as the Move tool would.
 */
function floatRedPixel(editor: Editor): void {
  const doc = editor.document;
  const layer = doc.layers[0];
  if (!layer) throw new Error('no layer');
  setPixel(layer.pixels, 0, 0, [255, 0, 0, 255]);
  const pixel = { x: 0, y: 0, width: 1, height: 1 };
  editor.history.execute(new SetSelectionCommand(Selection.fromRect(doc.width, doc.height, pixel)));
  const lift = liftSelectionCommand(doc, layer.id);
  if (!lift) throw new Error('Nothing to lift');
  editor.history.execute(lift);
  editor.history.execute(new MoveLayerCommand(lift.floatId, 2, 1));
}

describe('DocumentSession', () => {
  it('starts as a clean untitled document', () => {
    const { session } = setup();
    expect(session.name).toBe('Untitled-1');
    expect(session.isDirty).toBe(false);
    expect(session.savesInPlace).toBe(false);
  });

  it('creates new blank documents with fresh untitled names and history', () => {
    const { session, editor } = setup();
    hideBottomLayer(editor);
    session.newDocument({ width: 7, height: 5, background: 'transparent' });
    expect(session.name).toBe('Untitled-2');
    expect(editor.document.width).toBe(7);
    expect(editor.document.layers[0]?.pixels.data.every((v) => v === 0)).toBe(true);
    expect(session.isDirty).toBe(false);
    expect(editor.history.canUndo).toBe(false);

    session.close();
    expect(session.name).toBe('Untitled-3');
    expect(editor.document.width).toBe(1920);
    expect(editor.document.height).toBe(1080);

    session.openDemo();
    expect(session.name).toBe('Demo');
    expect(editor.document.layers).toHaveLength(2);
  });

  it('asks where to save the first time, then saves in place', async () => {
    const { session, store, editor } = setup();
    hideBottomLayer(editor);

    expect(await session.save()).toBe(true);
    expect(store.savePickers.map((r) => r.suggestedName)).toEqual(['Untitled-1.soup']);
    expect(session.name).toBe('picked');
    expect(session.isDirty).toBe(false);
    expect(session.savesInPlace).toBe(true);

    hideBottomLayer(editor);
    expect(session.isDirty).toBe(true);
    expect(await session.save()).toBe(true);
    expect(store.savePickers).toHaveLength(1);
    expect(session.isDirty).toBe(false);

    store.saveName = 'copy.soup';
    expect(await session.saveAs()).toBe(true);
    expect(store.savePickers).toHaveLength(2);
    expect(session.name).toBe('copy');
    expect([...store.files.keys()]).toEqual(['picked.soup', 'copy.soup']);
  });

  it('writes a file that loads back as the same document', async () => {
    const { session, store, editor } = setup();
    const layer = editor.document.layers[0];
    if (!layer) throw new Error('no layer');
    setPixel(layer.pixels, 1, 2, [12, 34, 56, 78]);
    await session.save();

    const bytes = new Uint8Array(await store.file('picked.soup').arrayBuffer());
    const loaded = await deserializeDocument(bytes, png);
    expect(loaded.width).toBe(4);
    expect(loaded.layers).toEqual(editor.document.layers);
  });

  it('keeps edits made while saving as unsaved', async () => {
    const { session, store, editor } = setup();
    store.afterData = () => hideBottomLayer(editor);
    await session.save();
    expect(session.isDirty).toBe(true);
    editor.history.undo();
    expect(session.isDirty).toBe(false);
  });

  it('changes nothing when the save picker is cancelled', async () => {
    const { session, store, editor } = setup();
    hideBottomLayer(editor);
    store.saveName = null;
    expect(await session.save()).toBe(false);
    expect(session.name).toBe('Untitled-1');
    expect(session.isDirty).toBe(true);
  });

  it('commits a floating selection when saving, so the file has no floating layer', async () => {
    const { session, store, editor } = setup();
    floatRedPixel(editor);
    store.saveName = null;
    await session.save();
    expect(editor.floating).not.toBeNull();

    store.saveName = 'picked.soup';
    expect(await session.save()).toBe(true);
    expect(editor.floating).toBeNull();
    expect(session.isDirty).toBe(false);
    const bytes = new Uint8Array(await store.file('picked.soup').arrayBuffer());
    const loaded = await deserializeDocument(bytes, png);
    expect(loaded.layers.map((layer) => layer.name)).toEqual(['Background']);
    const pixels = loaded.layers[0]?.pixels ?? createPixelBuffer(0, 0);
    expect(getPixel(pixels, 0, 0)).toEqual([0, 0, 0, 0]);
    expect(getPixel(pixels, 2, 1)).toEqual([255, 0, 0, 255]);

    // The commit is an undo step of its own, before the save point.
    expect(editor.history.undoLabel).toBe('Commit Floating Selection');
    editor.history.undo();
    expect(editor.floating).not.toBeNull();
    expect(session.isDirty).toBe(true);
  });

  it('downloads a new copy on every save when the store cannot save in place', async () => {
    const { session, store, editor } = setup(new MemoryFileStore(false));
    hideBottomLayer(editor);
    await session.save();
    await session.save();
    expect(store.savePickers.map((r) => r.target ?? null)).toEqual([null, null]);
    expect(session.savesInPlace).toBe(false);
    expect(session.isDirty).toBe(false);
  });

  it('opens a .soup file and saves back to it', async () => {
    const { session, store, editor } = setup();
    session.newDocument({ width: 2, height: 2, background: 'white' });
    hideBottomLayer(editor);
    store.saveName = 'art.soup';
    await session.saveAs();
    const saved = editor.document;

    session.close();
    store.pick = store.file('art.soup');
    expect(await session.open()).toBe(true);
    expect(store.openPickers.at(-1)).toBe(OPEN_FILE_TYPES);
    expect(session.name).toBe('art');
    expect(editor.document).not.toBe(saved);
    expect(editor.document.layers).toEqual(saved.layers);
    expect(session.isDirty).toBe(false);

    hideBottomLayer(editor);
    await session.save();
    expect(store.savePickers).toHaveLength(1);
  });

  it('saves .soup files, and opens .soup and older .pixelsoup ones', async () => {
    const { session, store } = setup();
    await session.save();
    expect(store.savePickers[0]?.type.accept).toEqual({ [PIXELSOUP_MIME_TYPE]: ['.soup'] });

    store.pick = store.file('picked.soup');
    await session.open();
    const [everything, documents] = store.openPickers.at(-1) ?? [];
    expect(everything?.accept[PIXELSOUP_MIME_TYPE]).toEqual(['.soup', '.pixelsoup']);
    expect(documents?.accept).toEqual({ [PIXELSOUP_MIME_TYPE]: ['.soup', '.pixelsoup'] });
  });

  it('saves an opened .pixelsoup file back in place, and suggests .soup for Save As', async () => {
    const { session, store, editor } = setup();
    await session.save();
    // The format hasn't changed: this is what an older version would have saved.
    store.pick = new File([store.file('picked.soup')], 'old.pixelsoup');
    expect(await session.open()).toBe(true);
    expect(session.name).toBe('old');
    expect(session.savesInPlace).toBe(true);

    hideBottomLayer(editor);
    expect(await session.save()).toBe(true);
    expect(store.savePickers).toHaveLength(1);
    expect(session.isDirty).toBe(false);
    const bytes = new Uint8Array(await store.file('old.pixelsoup').arrayBuffer());
    const loaded = await deserializeDocument(bytes, png);
    expect(loaded.layers[0]?.visible).toBe(false);

    store.saveName = null;
    expect(await session.saveAs()).toBe(false);
    expect(store.savePickers.at(-1)?.suggestedName).toBe('old.soup');
  });

  it('downloads an opened .pixelsoup file as .soup when the store cannot save in place', async () => {
    const { session, store } = setup(new MemoryFileStore(false));
    await session.save();
    store.pick = new File([store.file('Untitled-1.soup')], 'old.pixelsoup');
    await session.open();
    await session.save();
    expect(store.savePickers.map((r) => r.suggestedName)).toEqual(['Untitled-1.soup', 'old.soup']);
  });

  it('opens an image as a new single-layer document that Save does not overwrite', async () => {
    const { session, store, editor } = setup();
    const pixels = createPixelBuffer(5, 2);
    setPixel(pixels, 4, 1, [1, 2, 3, 4]);
    store.pick = pngFile('holiday.final.png', pixels);
    await session.open();

    expect(session.name).toBe('holiday.final');
    const [layer] = editor.document.layers;
    expect(editor.document.layers).toHaveLength(1);
    expect(layer).toMatchObject({ name: 'holiday.final', x: 0, y: 0 });
    expect(layer?.pixels).toEqual(pixels);
    expect(session.savesInPlace).toBe(false);

    await session.save();
    expect(store.savePickers.map((r) => r.suggestedName)).toEqual(['holiday.final.soup']);
  });

  it('recognises documents without the extension', async () => {
    const { session, store } = setup();
    store.saveName = 'art.soup';
    await session.save();
    store.pick = new File([store.file('art.soup')], 'renamed.zip');
    await session.open();
    expect(session.name).toBe('renamed');
  });

  it('reports files it cannot open and keeps the current document', async () => {
    const { session, store, editor } = setup();
    const before = editor.document;
    store.pick = new File(['{}'], 'broken.soup');
    const result = session.open();
    await expect(result).rejects.toBeInstanceOf(FileOperationError);
    await expect(result).rejects.toMatchObject({
      title: "Couldn't open “broken.soup”",
      message: expect.stringMatching(/zip archive/) as unknown,
    });
    expect(editor.document).toBe(before);
    expect(session.name).toBe('Untitled-1');

    // An older .pixelsoup file is read as a document too, not as an image.
    store.pick = new File(['{}'], 'broken.pixelsoup');
    await expect(session.open()).rejects.toMatchObject({
      message: expect.stringMatching(/zip archive/) as unknown,
    });
  });

  it('returns false when the open picker is cancelled', async () => {
    const { session } = setup();
    expect(await session.open()).toBe(false);
    expect(await session.importAsLayer()).toBe(false);
  });

  it('imports an image as a centred layer in one undoable step', async () => {
    const { session, store, editor } = setup();
    store.pick = pngFile('sticker.png', createPixelBuffer(3, 6));
    expect(await session.importAsLayer()).toBe(true);
    expect(store.openPickers.at(-1)).toEqual([IMAGE_FILE_TYPE]);

    const doc = editor.document;
    expect(doc.layers).toHaveLength(2);
    // Canvas 4×3: x = floor((4 - 3) / 2) = 0, y = floor((3 - 6) / 2) = -2.
    expect(doc.layers[1]).toMatchObject({ id: 'layer-2', name: 'sticker', x: 0, y: -2 });
    expect(editor.history.undoLabel).toBe('Import Image');
    expect(session.isDirty).toBe(true);

    editor.history.undo();
    expect(doc.layers).toHaveLength(1);
    store.pick = pngFile('again.png', createPixelBuffer(1, 1));
    await session.importAsLayer();
    expect(doc.layers[1]?.id).toBe('layer-3');
  });

  it('imports directly above the active layer and makes the import active', async () => {
    const { session, store, editor } = setup();
    const doc = editor.document;
    editor.history.execute(newLayerCommand(doc, null));
    editor.setActiveLayer('layer-1');
    store.pick = pngFile('sticker.png', createPixelBuffer(1, 1));
    await session.importAsLayer();
    expect(doc.layers.map((layer) => layer.name)).toEqual(['Background', 'sticker', 'Layer 1']);
    expect(editor.activeLayer?.name).toBe('sticker');
  });

  it('exports the flattened composite without touching the document state', async () => {
    const { session, store, editor, exported } = setup();
    session.newDocument({ width: 2, height: 1, background: 'transparent' });
    const layer = editor.document.layers[0];
    if (!layer) throw new Error('no layer');
    setPixel(layer.pixels, 0, 0, [200, 0, 100, 128]);

    store.saveName = 'out.png';
    expect(await session.exportImage({ format: 'png', quality: 0.9 })).toBe(true);
    expect(store.savePickers.at(-1)?.suggestedName).toBe('Untitled-2.png');
    expect(getPixel(exported[0]?.pixels ?? createPixelBuffer(0, 0), 0, 0)).toEqual([
      200, 0, 100, 128,
    ]);

    expect(await session.exportImage({ format: 'jpeg', quality: 0.5 })).toBe(true);
    expect(store.savePickers.at(-1)?.suggestedName).toBe('Untitled-2.jpg');
    const jpeg = exported[1];
    // JPEG has no alpha: flattened onto white (see flattenOnto), transparent → white.
    expect(getPixel(jpeg?.pixels ?? createPixelBuffer(0, 0), 0, 0)).toEqual([227, 127, 177, 255]);
    expect(getPixel(jpeg?.pixels ?? createPixelBuffer(0, 0), 1, 0)).toEqual([255, 255, 255, 255]);
    expect(jpeg?.options).toEqual({ format: 'jpeg', quality: 0.5 });

    expect(session.name).toBe('Untitled-2');
    expect(session.savesInPlace).toBe(false);
  });

  it('commits a floating selection when exporting', async () => {
    const { session, store, editor, exported } = setup();
    floatRedPixel(editor);
    store.saveName = 'out.png';
    expect(await session.exportImage({ format: 'png', quality: 0.9 })).toBe(true);
    expect(editor.floating).toBeNull();
    expect(editor.history.undoLabel).toBe('Commit Floating Selection');
    const pixels = exported[0]?.pixels ?? createPixelBuffer(0, 0);
    expect(getPixel(pixels, 0, 0)).toEqual([0, 0, 0, 0]);
    expect(getPixel(pixels, 2, 1)).toEqual([255, 0, 0, 255]);
  });

  it('notifies subscribers of name changes and editor changes', async () => {
    const { session, editor } = setup();
    let calls = 0;
    const unsubscribe = session.subscribe(() => calls++);
    const before = session.revision;
    hideBottomLayer(editor);
    expect(calls).toBe(1);
    await session.save();
    expect(calls).toBeGreaterThan(1);
    expect(session.revision).toBeGreaterThan(before);
    unsubscribe();
    hideBottomLayer(editor);
    const after = calls;
    session.openDemo();
    expect(calls).toBe(after);
  });
});

describe('baseName', () => {
  it('drops the last extension only', () => {
    expect(baseName('photo.final.png')).toBe('photo.final');
    expect(baseName('art.soup')).toBe('art');
    expect(baseName('README')).toBe('README');
    expect(baseName('.hidden')).toBe('.hidden');
  });
});
