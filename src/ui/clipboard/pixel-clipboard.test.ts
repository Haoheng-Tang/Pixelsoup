import { describe, expect, it } from 'vitest';
import type { PixelBuffer, RasterLayer, Rgba } from '../../core';
import {
  Editor,
  Selection,
  SetSelectionCommand,
  clearCommand,
  copySelection,
  createDocument,
  createLayerId,
  createPixelBuffer,
  createRasterLayer,
  liftSelectionCommand,
} from '../../core';
import { decodePng, encodePng } from '../io/png';
import type { ClipboardContent, PastedData } from './pixel-clipboard';
import { PixelClipboard, imageFileOf, pastePosition, sameImage } from './pixel-clipboard';

const RED: Rgba = [255, 0, 0, 255];
const BLUE: Rgba = [0, 0, 255, 255];
const NONE = [0, 0, 0, 0];

function bufferOf(width: number, height: number, pixels: readonly Rgba[]): PixelBuffer {
  const buffer = createPixelBuffer(width, height);
  pixels.forEach((pixel, i) => buffer.data.set(pixel, i * 4));
  return buffer;
}

function pixelsOf(buffer: PixelBuffer): number[][] {
  const pixels: number[][] = [];
  for (let i = 0; i < buffer.data.length; i += 4) pixels.push([...buffer.data.subarray(i, i + 4)]);
  return pixels;
}

/**
 * An editor on a 4×1 canvas: "Red" (layer-1, opaque red) below "Photo" (layer-2, active),
 * whose pixels are given, and a clipboard whose system writes and errors are recorded.
 */
function setup(photo: readonly Rgba[] = [BLUE, [10, 20, 30, 200], BLUE, BLUE]) {
  const doc = createDocument(4, 1);
  doc.layers.push(
    createRasterLayer({
      id: createLayerId(doc),
      name: 'Red',
      pixels: bufferOf(4, 1, [RED, RED, RED, RED]),
    }),
  );
  doc.layers.push(
    createRasterLayer({ id: createLayerId(doc), name: 'Photo', pixels: bufferOf(4, 1, photo) }),
  );
  const editor = new Editor(doc);
  const written: PixelBuffer[] = [];
  const errors: unknown[] = [];
  let systemWorks = true;
  const clipboard = new PixelClipboard({
    editor,
    decodeImage: async (file) => decodePng(new Uint8Array(await file.arrayBuffer())),
    writeSystem: (pixels) => {
      written.push(pixels);
      return Promise.resolve(systemWorks);
    },
    onError: (error) => errors.push(error),
  });
  const failSystem = () => {
    systemWorks = false;
  };
  return { doc, editor, clipboard, written, errors, failSystem, photo: doc.layers[1] };
}

function select(editor: Editor, coverage: readonly number[]): void {
  const doc = editor.document;
  editor.history.execute(
    new SetSelectionCommand(Selection.fromMask(doc.width, doc.height, coverage)),
  );
}

function layer(editor: Editor, index: number): RasterLayer {
  return editor.document.layers[index];
}

/** A paste event's data carrying `files`, as browsers give it. */
function pasted(...files: File[]): PastedData {
  return {
    items: files.map((file) => ({ kind: 'file', type: file.type, getAsFile: () => file })),
  };
}

function pngFile(pixels: PixelBuffer): File {
  return new File([encodePng(pixels)], 'image.png', { type: 'image/png' });
}

describe('PixelClipboard copying', () => {
  it('copies the selected pixels of the active layer, weighted by coverage', () => {
    const { editor, clipboard, written } = setup();
    select(editor, [0, 255, 128, 0]);
    expect(clipboard.canRun('copy')).toBe(true);
    clipboard.run('copy', null);

    const content = clipboard.content!;
    expect(content).toMatchObject({ x: 1, y: 0, canvasWidth: 4, canvasHeight: 1 });
    // 200 at full coverage stays; 255 × 128/255 = 128.
    expect(pixelsOf(content.pixels)).toEqual([
      [10, 20, 30, 200],
      [0, 0, 255, 128],
    ]);
    expect(written).toEqual([content.pixels]);
    expect(editor.history.canUndo).toBe(true);
    expect(editor.history.undoLabel).toBe('Change Selection');
  });

  it('copies nothing at zero coverage, and transparent pixels where the layer is', () => {
    const { editor, clipboard } = setup([BLUE, [0, 0, 0, 0], BLUE, BLUE]);
    select(editor, [0, 255, 0, 3]);
    clipboard.run('copy', null);
    // 255 × 3/255 = 3.
    expect(pixelsOf(clipboard.content!.pixels)).toEqual([NONE, NONE, [0, 0, 255, 3]]);
  });

  it('cuts: copies, then clears the source as one undo step "Cut"', () => {
    const { editor, clipboard, photo } = setup();
    select(editor, [0, 255, 128, 0]);
    clipboard.run('cut', null);
    expect(pixelsOf(clipboard.content!.pixels)).toEqual([
      [10, 20, 30, 200],
      [0, 0, 255, 128],
    ]);
    // 255 − 128 = 127 left.
    expect(pixelsOf(photo.pixels)).toEqual([BLUE, NONE, [0, 0, 255, 127], BLUE]);
    expect(editor.history.undoLabel).toBe('Cut');
    editor.history.undo();
    expect(pixelsOf(photo.pixels)).toEqual([BLUE, [10, 20, 30, 200], BLUE, BLUE]);
    expect(clipboard.content).not.toBeNull();
  });

  it('cuts exactly what copy followed by Clear gives', () => {
    const photo: Rgba[] = [
      [200, 100, 50, 255],
      [10, 20, 30, 77],
      [90, 80, 70, 255],
      [40, 50, 60, 1],
    ];
    const coverage = [255, 200, 128, 100];
    const cut = setup(photo);
    select(cut.editor, coverage);
    cut.clipboard.run('cut', null);

    const reference = setup(photo);
    select(reference.editor, coverage);
    const copied = copySelection(reference.doc, { layerId: reference.photo.id });
    reference.editor.history.execute(clearCommand(reference.doc, reference.photo.id)!);

    expect(cut.clipboard.content?.pixels).toEqual(copied?.pixels);
    expect(cut.photo.pixels).toEqual(reference.photo.pixels);
  });

  it('copies the composite of the visible layers for Copy Merged', () => {
    const { editor, clipboard, photo } = setup([[0, 0, 255, 0], BLUE, BLUE, BLUE]);
    photo.opacity = 0.5;
    select(editor, [255, 255, 0, 0]);
    expect(clipboard.canRun('copy-merged')).toBe(true);
    clipboard.run('copy-merged', null);
    // Red under transparent is red; blue at half opacity over red is (127.5, 0, 127.5).
    expect(pixelsOf(clipboard.content!.pixels)).toEqual([RED, [128, 0, 128, 255]]);
  });

  it('needs a selection that reaches the visible active layer', () => {
    const { editor, clipboard, photo, written } = setup();
    for (const command of ['cut', 'copy', 'copy-merged', 'paste'] as const) {
      expect([command, clipboard.canRun(command)]).toEqual([command, false]);
      clipboard.run(command, null);
    }
    select(editor, [255, 0, 0, 0]);
    photo.visible = false;
    expect(clipboard.canRun('copy')).toBe(false);
    expect(clipboard.canRun('cut')).toBe(false);
    expect(clipboard.canRun('copy-merged')).toBe(true);
    photo.visible = true;
    photo.x = 1;
    expect(clipboard.canRun('copy')).toBe(false);
    expect(clipboard.content).toBeNull();
    expect(written).toEqual([]);
  });

  it('commits a floating selection first, and copies from its source', () => {
    const { editor, clipboard, photo } = setup();
    select(editor, [0, 255, 0, 0]);
    editor.history.execute(liftSelectionCommand(editor.document, photo.id)!);
    expect(editor.floating).not.toBeNull();
    clipboard.run('cut', null);
    expect(editor.floating).toBeNull();
    expect(editor.activeLayerId).toBe(photo.id);
    expect(pixelsOf(clipboard.content!.pixels)).toEqual([[10, 20, 30, 200]]);
    expect(pixelsOf(photo.pixels)).toEqual([BLUE, NONE, BLUE, BLUE]);
    editor.history.undo();
    expect(editor.history.undoLabel).toBe('Commit Floating Selection');
  });
});

describe('PixelClipboard pasting', () => {
  it('pastes a copy back where it came from, pixel for pixel, as a new active layer', () => {
    const { editor, clipboard } = setup();
    select(editor, [0, 255, 128, 0]);
    clipboard.run('copy', null);
    clipboard.run('paste', { x: 100, y: 100, width: 10, height: 10 });

    const doc = editor.document;
    expect(doc.layers.map((l) => l.name)).toEqual(['Red', 'Photo', 'Layer 1']);
    const pasted = layer(editor, 2);
    expect(editor.activeLayerId).toBe(pasted.id);
    expect(pasted).toMatchObject({ x: 1, y: 0, opacity: 1 });
    expect(pasted.pixels).toEqual(clipboard.content!.pixels);
    expect(pasted.pixels).not.toBe(clipboard.content!.pixels);
    expect(doc.selection).toBeNull();
    expect(editor.history.undoLabel).toBe('Paste');

    editor.history.undo();
    expect(doc.layers).toHaveLength(2);
    expect(doc.selection).not.toBeNull();
  });

  it('pastes above the active layer, and again each time', () => {
    const { editor, clipboard } = setup();
    select(editor, [255, 0, 0, 0]);
    clipboard.run('copy', null);
    editor.setActiveLayer('layer-1');
    clipboard.run('paste', null);
    clipboard.run('paste', null);
    expect(editor.document.layers.map((l) => l.name)).toEqual([
      'Red',
      'Layer 1',
      'Layer 2',
      'Photo',
    ]);
    expect(editor.activeLayer?.name).toBe('Layer 2');
  });

  it('commits a floating selection before pasting', () => {
    const { editor, clipboard, photo } = setup();
    select(editor, [255, 0, 0, 0]);
    clipboard.run('copy', null);
    select(editor, [0, 255, 0, 0]);
    editor.history.execute(liftSelectionCommand(editor.document, photo.id)!);
    clipboard.run('paste', null);
    expect(editor.floating).toBeNull();
    expect(editor.document.layers.map((l) => l.name)).toEqual(['Red', 'Photo', 'Layer 1']);
  });

  it("pastes an image from another app's paste event, centred in view", async () => {
    const { editor, clipboard } = setup();
    const image = bufferOf(2, 1, [RED, [1, 2, 3, 4]]);
    await clipboard.pasteData(pasted(pngFile(image)), { x: 2, y: 0, width: 10, height: 10 });
    const layer = editor.activeLayer!;
    expect(layer.name).toBe('Layer 1');
    // Centred in the visible part of the canvas, x 2–4, then kept on it.
    expect(layer).toMatchObject({ x: 2, y: 0 });
    expect(pixelsOf(layer.pixels)).toEqual([RED, [1, 2, 3, 4]]);
    expect(editor.history.undoLabel).toBe('Paste');
  });

  it('pastes its own copy rather than the paste event while that is the newest', async () => {
    const { editor, clipboard } = setup();
    select(editor, [255, 0, 0, 0]);
    clipboard.run('copy', null);
    const stale = pngFile(bufferOf(1, 1, [RED]));
    await clipboard.pasteData(pasted(stale), null);
    expect(pixelsOf(editor.activeLayer!.pixels)).toEqual([BLUE]);

    // Once the window has lost focus another app may have copied something.
    clipboard.windowBlurred();
    await clipboard.pasteData(pasted(stale), null);
    expect(pixelsOf(editor.activeLayer!.pixels)).toEqual([RED]);
  });

  it('recognises its own copy coming back from the system clipboard', async () => {
    const { editor, clipboard } = setup();
    select(editor, [0, 255, 128, 0]);
    clipboard.run('copy', null);
    clipboard.windowBlurred();
    // As a browser would re-encode it, through premultiplied alpha: 30 × 200/255 = 23.5
    // stored as 24 and read back as 24 × 255/200 = 30.6, so 31.
    const roundTrip = bufferOf(2, 1, [
      [10, 20, 31, 200],
      [0, 0, 255, 128],
    ]);
    await clipboard.pasteData(pasted(pngFile(roundTrip)), { x: 0, y: 0, width: 1, height: 1 });
    expect(editor.activeLayer).toMatchObject({ x: 1, y: 0 });
    expect(editor.activeLayer!.pixels).toEqual(clipboard.content!.pixels);
  });

  it('pastes its own clipboard when the event has no image', async () => {
    const { editor, clipboard } = setup();
    await clipboard.pasteData(null, null);
    expect(editor.history.canUndo).toBe(false);
    select(editor, [255, 0, 0, 0]);
    clipboard.run('copy', null);
    clipboard.windowBlurred();
    const text = new File(['hello'], 'text.txt', { type: 'text/plain' });
    await clipboard.pasteData(pasted(text), null);
    expect(editor.history.undoLabel).toBe('Paste');
    expect(pixelsOf(editor.activeLayer!.pixels)).toEqual([BLUE]);
  });

  it('reports an image it cannot decode, and pastes nothing', async () => {
    const { editor, clipboard, errors } = setup();
    const broken = new File([new Uint8Array([137, 80, 78, 71, 1, 2, 3])], 'x.png', {
      type: 'image/png',
    });
    await clipboard.pasteData(pasted(broken), null);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatchObject({ title: "Couldn't paste the image" });
    expect(editor.history.canUndo).toBe(false);
  });

  it('keeps working when the system clipboard refuses the copy', () => {
    const { editor, clipboard, failSystem } = setup();
    failSystem();
    select(editor, [255, 0, 0, 0]);
    clipboard.run('copy', null);
    clipboard.run('paste', null);
    expect(pixelsOf(editor.activeLayer!.pixels)).toEqual([BLUE]);
  });
});

describe('pastePosition', () => {
  const canvas = { width: 100, height: 50 };
  function content(width: number, height: number, from: Partial<ClipboardContent> = {}) {
    return {
      pixels: createPixelBuffer(width, height),
      x: 0,
      y: 0,
      canvasWidth: 0,
      canvasHeight: 0,
      ...from,
    };
  }

  it('goes back where it came from on a canvas of the same size', () => {
    const from = { x: 70, y: 5, canvasWidth: 100, canvasHeight: 50 };
    expect(pastePosition(canvas, content(30, 10, from), null)).toEqual({ x: 70, y: 5 });
  });

  it('is centred in the part of the canvas in view on a canvas of another size', () => {
    const from = { x: 70, y: 5, canvasWidth: 200, canvasHeight: 50 };
    // The view covers x 40–140 and y −10–30, of which x 40–100 and y 0–30 is canvas.
    const view = { x: 40, y: -10, width: 100, height: 40 };
    expect(pastePosition(canvas, content(30, 10, from), view)).toEqual({ x: 55, y: 10 });
  });

  it('stays on the canvas, and is centred on the canvas without a view', () => {
    // Centred in x 90–100 would put it at x 80, past the canvas's right edge.
    const view = { x: 90, y: 0, width: 50, height: 50 };
    expect(pastePosition(canvas, content(30, 10), view)).toEqual({ x: 70, y: 20 });
    expect(pastePosition(canvas, content(30, 10), null)).toEqual({ x: 35, y: 20 });
    // A view that misses the canvas counts as none.
    expect(pastePosition(canvas, content(30, 10), { x: -60, y: 0, width: 50, height: 9 })).toEqual({
      x: 35,
      y: 20,
    });
  });

  it('centres pixels larger than the canvas on it', () => {
    const view = { x: 0, y: 0, width: 10, height: 10 };
    expect(pastePosition(canvas, content(121, 60), view)).toEqual({ x: -11, y: -5 });
    const from = { x: -5, y: 0, canvasWidth: 100, canvasHeight: 50 };
    expect(pastePosition(canvas, content(20, 10, from), view)).toEqual({ x: 0, y: 0 });
  });
});

describe('imageFileOf', () => {
  it('takes a PNG first, else any image, and ignores other items', () => {
    const png = new File(['png'], 'a.png', { type: 'image/png' });
    const jpeg = new File(['jpeg'], 'a.jpg', { type: 'image/jpeg' });
    const text = new File(['text'], 'a.txt', { type: 'text/plain' });
    expect(imageFileOf(pasted(jpeg, png))).toBe(png);
    expect(imageFileOf(pasted(text, jpeg))).toBe(jpeg);
    expect(imageFileOf(pasted(text))).toBeNull();
    expect(
      imageFileOf({ items: [{ kind: 'string', type: 'image/png', getAsFile: () => null }] }),
    ).toBeNull();
    expect(imageFileOf(null)).toBeNull();
  });
});

describe('sameImage', () => {
  it('allows the rounding of a trip through premultiplied alpha', () => {
    const ours = bufferOf(3, 1, [RED, [100, 50, 25, 10], NONE]);
    // At alpha 10 the colour may be off by up to 1 + ceil(255 / 10) = 27.
    expect(sameImage(bufferOf(3, 1, [RED, [126, 24, 0, 10], [9, 9, 9, 1]]), ours)).toBe(true);
    expect(sameImage(bufferOf(3, 1, [RED, [128, 50, 25, 10], NONE]), ours)).toBe(false);
    expect(sameImage(bufferOf(3, 1, [[254, 0, 0, 255], [100, 50, 25, 12], NONE]), ours)).toBe(
      false,
    );
    expect(sameImage(bufferOf(1, 3, [RED, [100, 50, 25, 10], NONE]), ours)).toBe(false);
  });
});
