import { describe, expect, it } from 'vitest';
import type { ImageDocument } from '../core';
import {
  Editor,
  FLOATING_LAYER_NAME,
  Selection,
  SetSelectionCommand,
  createBlankDocument,
  createDocument,
  createLayerId,
  createRasterLayer,
  liftSelectionCommand,
} from '../core';
import type { LayerAction } from './layer-actions';
import { canRunLayerAction, runLayerAction } from './layer-actions';

const ACTIONS: readonly LayerAction[] = [
  'new',
  'duplicate',
  'delete',
  'merge-down',
  'flatten',
  'move-up',
  'move-down',
  'select-above',
  'select-below',
  'commit-floating',
];

/** An editor on a 10×10 document with a 4×4 layer per name, bottom first, IDs layer-1… */
function setup(...names: string[]): { editor: Editor; doc: ImageDocument } {
  const doc = createDocument(10, 10);
  for (const name of names) {
    doc.layers.push(createRasterLayer({ id: createLayerId(doc), name, width: 4, height: 4 }));
  }
  return { editor: new Editor(doc), doc };
}

/** Lifts the top-left 2×2 pixels of the active layer into a floating selection. */
function float(editor: Editor): void {
  const doc = editor.document;
  const area = { x: 0, y: 0, width: 2, height: 2 };
  editor.history.execute(new SetSelectionCommand(Selection.fromRect(doc.width, doc.height, area)));
  const lift = liftSelectionCommand(doc, editor.activeLayerId ?? '');
  if (!lift) throw new Error('Nothing to lift');
  editor.history.execute(lift);
}

function names(doc: ImageDocument): string[] {
  return doc.layers.map((layer) => layer.name);
}

function activeName(editor: Editor): string | undefined {
  return editor.activeLayer?.name;
}

describe('runLayerAction', () => {
  it('adds a new layer above the active one and makes it active', () => {
    const { editor, doc } = setup('A', 'B');
    editor.setActiveLayer('layer-1');
    runLayerAction(editor, 'new');
    expect(names(doc)).toEqual(['A', 'Layer 1', 'B']);
    expect(activeName(editor)).toBe('Layer 1');
    expect(editor.history.undoLabel).toBe('New Layer');
  });

  it('duplicates the active layer and makes the copy active', () => {
    const { editor, doc } = setup('A', 'B');
    editor.setActiveLayer('layer-1');
    runLayerAction(editor, 'duplicate');
    expect(names(doc)).toEqual(['A', 'A copy', 'B']);
    expect(activeName(editor)).toBe('A copy');
  });

  it('deletes the active layer, and the one below becomes active', () => {
    const { editor, doc } = setup('A', 'B', 'C');
    editor.setActiveLayer('layer-2');
    runLayerAction(editor, 'delete');
    expect(names(doc)).toEqual(['A', 'C']);
    expect(activeName(editor)).toBe('A');
  });

  it('merges the active layer down, and flattens', () => {
    const { editor, doc } = setup('A', 'B', 'C');
    runLayerAction(editor, 'merge-down');
    expect(names(doc)).toEqual(['A', 'B']);
    expect(activeName(editor)).toBe('B');
    runLayerAction(editor, 'flatten');
    expect(names(doc)).toEqual(['A']);
    expect(activeName(editor)).toBe('A');
  });

  it('moves the active layer up and down the stack', () => {
    const { editor, doc } = setup('A', 'B', 'C');
    editor.setActiveLayer('layer-1');
    runLayerAction(editor, 'move-up');
    expect(names(doc)).toEqual(['B', 'A', 'C']);
    runLayerAction(editor, 'move-up');
    expect(names(doc)).toEqual(['B', 'C', 'A']);
    runLayerAction(editor, 'move-down');
    expect(names(doc)).toEqual(['B', 'A', 'C']);
    expect(activeName(editor)).toBe('A');
  });

  it('selects the layer above or below without touching history', () => {
    const { editor } = setup('A', 'B', 'C');
    runLayerAction(editor, 'select-below');
    expect(activeName(editor)).toBe('B');
    runLayerAction(editor, 'select-below');
    runLayerAction(editor, 'select-below');
    expect(activeName(editor)).toBe('A');
    runLayerAction(editor, 'select-above');
    expect(activeName(editor)).toBe('B');
    expect(editor.history.canUndo).toBe(false);
  });
});

describe('runLayerAction with a floating selection', () => {
  it('commits it with Commit Floating Selection or Merge Down', () => {
    const { editor, doc } = setup('A', 'B');
    float(editor);
    expect(names(doc)).toEqual(['A', 'B', FLOATING_LAYER_NAME]);
    runLayerAction(editor, 'commit-floating');
    expect(names(doc)).toEqual(['A', 'B']);
    expect(editor.floating).toBeNull();
    expect(editor.history.undoLabel).toBe('Commit Floating Selection');

    float(editor);
    runLayerAction(editor, 'merge-down');
    expect(names(doc)).toEqual(['A', 'B']);
    expect(activeName(editor)).toBe('B');
    expect(editor.history.undoLabel).toBe('Commit Floating Selection');
  });

  it('commits it before adding a layer or flattening', () => {
    const { editor, doc } = setup('A', 'B');
    float(editor);
    runLayerAction(editor, 'new');
    expect(doc.layers).toHaveLength(3);
    expect(editor.floating).toBeNull();
    expect(editor.activeLayerId).toBe(doc.layers[2].id);
    editor.history.undo();
    editor.history.undo();
    expect(names(doc)).toEqual(['A', 'B', FLOATING_LAYER_NAME]);

    runLayerAction(editor, 'flatten');
    expect(names(doc)).toEqual(['A']);
    expect(editor.history.undoLabel).toBe('Flatten Image');
    editor.history.undo();
    expect(editor.history.undoLabel).toBe('Commit Floating Selection');
  });

  it('commits it when another layer is selected', () => {
    const { editor, doc } = setup('A', 'B');
    float(editor);
    runLayerAction(editor, 'select-below');
    expect(editor.floating).toBeNull();
    expect(names(doc)).toEqual(['A', 'B']);
    expect(activeName(editor)).toBe('B');
  });

  it('refuses to duplicate, delete or reorder it', () => {
    const { editor, doc } = setup('A', 'B');
    float(editor);
    for (const action of ['duplicate', 'delete', 'move-up', 'move-down'] as const) {
      runLayerAction(editor, action);
    }
    expect(names(doc)).toEqual(['A', 'B', FLOATING_LAYER_NAME]);
    expect(editor.floating).not.toBeNull();
  });
});

describe('canRunLayerAction', () => {
  it('rules out what a single plain layer cannot do', () => {
    const editor = new Editor(createBlankDocument({ width: 8, height: 8, background: 'white' }));
    const runnable = ACTIONS.filter((action) => canRunLayerAction(editor, action));
    expect(runnable).toEqual(['new', 'duplicate']);
  });

  it('follows the active layer through the stack', () => {
    const { editor } = setup('A', 'B', 'C');
    editor.setActiveLayer('layer-2');
    const blocked = ACTIONS.filter((action) => !canRunLayerAction(editor, action));
    expect(blocked).toEqual(['commit-floating']);
    editor.setActiveLayer('layer-1');
    expect(canRunLayerAction(editor, 'merge-down')).toBe(false);
    expect(canRunLayerAction(editor, 'move-down')).toBe(false);
    expect(canRunLayerAction(editor, 'select-below')).toBe(false);
    editor.setActiveLayer('layer-3');
    expect(canRunLayerAction(editor, 'move-up')).toBe(false);
    expect(canRunLayerAction(editor, 'select-above')).toBe(false);
  });

  it('does not take layer IDs', () => {
    const { editor, doc } = setup('A', 'B');
    const next = doc.nextLayerNumber;
    for (const action of ACTIONS) canRunLayerAction(editor, action);
    expect(doc.nextLayerNumber).toBe(next);
  });

  it('agrees with what runLayerAction does', () => {
    for (const active of ['layer-1', 'layer-2']) {
      for (const action of ACTIONS) {
        const { editor, doc } = setup('A', 'B');
        doc.layers[0].visible = false;
        editor.setActiveLayer(active);
        const revision = editor.revision;
        const expected = canRunLayerAction(editor, action);
        runLayerAction(editor, action);
        expect([action, editor.revision !== revision]).toEqual([action, expected]);
      }
    }
  });

  it('agrees with what runLayerAction does with a floating selection', () => {
    const runnable: LayerAction[] = [];
    for (const action of ACTIONS) {
      const { editor } = setup('A', 'B');
      float(editor);
      const revision = editor.revision;
      const expected = canRunLayerAction(editor, action);
      runLayerAction(editor, action);
      expect([action, editor.revision !== revision]).toEqual([action, expected]);
      if (expected) runnable.push(action);
    }
    expect(runnable).toEqual(['new', 'merge-down', 'flatten', 'select-below', 'commit-floating']);
  });
});
