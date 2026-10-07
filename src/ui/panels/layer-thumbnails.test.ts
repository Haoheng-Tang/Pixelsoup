import { describe, expect, it } from 'vitest';
import {
  Editor,
  SetLayerOpacityCommand,
  createDocument,
  createLayerId,
  createRasterLayer,
  mergeDownCommand,
} from '../../core';
import type { ThumbnailEnvironment } from './layer-thumbnails';
import { LayerThumbnails } from './layer-thumbnails';

function canvas(name: string): HTMLCanvasElement {
  return { id: name } as unknown as HTMLCanvasElement;
}

/** An editor with layers A and B (layer-1, layer-2), thumbnails, and manual frames. */
function setup() {
  const doc = createDocument(8, 8);
  for (const name of ['A', 'B']) {
    doc.layers.push(createRasterLayer({ id: createLayerId(doc), name, width: 4, height: 4 }));
  }
  const editor = new Editor(doc);
  const frames = new Map<number, () => void>();
  let nextFrame = 1;
  let ratio = 1;
  let ratioChanged = () => {};
  const drawn: string[] = [];
  const env: ThumbnailEnvironment = {
    requestFrame: (callback) => {
      frames.set(nextFrame, callback);
      return nextFrame++;
    },
    cancelFrame: (handle) => frames.delete(handle),
    pixelRatio: () => ratio,
    watchPixelRatio: (onChange) => {
      ratioChanged = onChange;
      return () => {};
    },
    draw: (target) => drawn.push(target.id),
  };
  const thumbnails = new LayerThumbnails(editor, env);
  const stop = thumbnails.start();
  /** Runs the pending frames; returns what they drew. */
  const runFrames = () => {
    const pending = [...frames.values()];
    frames.clear();
    for (const callback of pending) callback();
    return drawn.splice(0);
  };
  const setRatio = (value: number) => {
    ratio = value;
    ratioChanged();
  };
  return { editor, thumbnails, frames, runFrames, setRatio, stop };
}

describe('LayerThumbnails', () => {
  it('draws newly attached canvases in the next frame', () => {
    const { thumbnails, frames, runFrames } = setup();
    thumbnails.attach('layer-1', canvas('A'));
    thumbnails.attach('layer-2', canvas('B'));
    expect(frames.size).toBe(1);
    expect(runFrames()).toEqual(['A', 'B']);
    expect(runFrames()).toEqual([]);
  });

  it('redraws only layers whose pixels changed, once per frame', () => {
    const { editor, thumbnails, frames, runFrames } = setup();
    thumbnails.attach('layer-1', canvas('A'));
    thumbnails.attach('layer-2', canvas('B'));
    runFrames();

    editor.history.execute(new SetLayerOpacityCommand('layer-2', 0.5));
    expect(runFrames()).toEqual([]);

    // Merging B into A gives layer-1 new pixels; the two changes share one frame.
    editor.history.execute(new SetLayerOpacityCommand('layer-2', 0.25));
    editor.history.execute(mergeDownCommand(editor.document, 'layer-2')!);
    expect(frames.size).toBe(1);
    expect(runFrames()).toEqual(['A']);

    // Undo brings back B's own buffer, which its canvas still shows.
    editor.history.undo();
    expect(runFrames()).toEqual(['A']);
  });

  it('redraws everything for a new document or pixel ratio', () => {
    const { editor, thumbnails, runFrames, setRatio } = setup();
    const a = canvas('A');
    thumbnails.attach('layer-1', a);
    runFrames();

    // Re-attaching a canvas that is up to date draws nothing.
    thumbnails.attach('layer-1', a);
    expect(runFrames()).toEqual([]);

    setRatio(2);
    expect(runFrames()).toEqual(['A']);

    const doc = createDocument(8, 8);
    doc.layers.push(createRasterLayer({ id: createLayerId(doc), name: 'C', width: 2, height: 2 }));
    editor.replaceDocument(doc);
    expect(runFrames()).toEqual(['A']);
  });

  it('forgets detached canvases and stops with its frame', () => {
    const { editor, thumbnails, frames, runFrames, stop } = setup();
    const detach = thumbnails.attach('layer-1', canvas('A'));
    runFrames();
    detach();
    editor.history.execute(mergeDownCommand(editor.document, 'layer-2')!);
    expect(runFrames()).toEqual([]);

    thumbnails.attach('layer-1', canvas('A2'));
    stop();
    expect(frames.size).toBe(0);
  });
});
