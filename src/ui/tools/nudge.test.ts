import { describe, expect, it } from 'vitest';
import {
  createDocument,
  createLayerId,
  createRasterLayer,
  Editor,
  MoveLayerCommand,
} from '../../core';
import { NUDGE_MERGE_MS, NudgeGrouper, nudgeOffset } from './nudge';

describe('nudgeOffset', () => {
  it('moves 1 px per arrow key, 10 with Shift', () => {
    expect(nudgeOffset('ArrowLeft', false)).toEqual({ dx: -1, dy: 0 });
    expect(nudgeOffset('ArrowRight', false)).toEqual({ dx: 1, dy: 0 });
    expect(nudgeOffset('ArrowUp', true)).toEqual({ dx: 0, dy: -10 });
    expect(nudgeOffset('ArrowDown', true)).toEqual({ dx: 0, dy: 10 });
    expect(nudgeOffset('a', false)).toBeNull();
  });
});

describe('NudgeGrouper', () => {
  it('gives nudges less than a second apart the same key', () => {
    const grouper = new NudgeGrouper();
    const first = grouper.keyAt(0);
    expect(grouper.keyAt(400)).toBe(first);
    // The window slides: each nudge extends the run.
    expect(grouper.keyAt(1300)).toBe(first);
    expect(grouper.keyAt(1300 + NUDGE_MERGE_MS)).not.toBe(first);
  });

  it('starts a new run after a reset', () => {
    const grouper = new NudgeGrouper();
    const first = grouper.keyAt(0);
    grouper.reset();
    expect(grouper.keyAt(10)).not.toBe(first);
  });

  it('never repeats a key, even across groupers', () => {
    const a = new NudgeGrouper();
    const b = new NudgeGrouper();
    expect(a.keyAt(0)).not.toBe(b.keyAt(0));
  });

  it('merges a quick run of nudges into one undo step', () => {
    const doc = createDocument(10, 10);
    const layer = createRasterLayer({ id: createLayerId(doc), name: 'L', width: 2, height: 2 });
    doc.layers.push(layer);
    const editor = new Editor(doc);
    const grouper = new NudgeGrouper();
    const nudge = (now: number, dx: number) => {
      const mergeKey = grouper.keyAt(now);
      editor.history.execute(new MoveLayerCommand(layer.id, layer.x + dx, layer.y, { mergeKey }));
    };

    nudge(0, 1);
    nudge(200, 1);
    nudge(500, 10);
    nudge(2000, 1);
    expect(layer.x).toBe(13);
    editor.history.undo();
    expect(layer.x).toBe(12);
    editor.history.undo();
    expect(layer.x).toBe(0);
    expect(editor.history.canUndo).toBe(false);
  });
});
