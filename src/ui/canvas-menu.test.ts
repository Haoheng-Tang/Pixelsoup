import { describe, expect, it } from 'vitest';
import type { ImageDocument } from '../core';
import {
  Editor,
  Selection,
  SetLayerVisibilityCommand,
  SetSelectionCommand,
  createDocument,
  createLayerId,
  createRasterLayer,
  liftSelectionCommand,
} from '../core';
import type { CanvasMenuController } from './canvas-menu';
import { canvasMenuSections, isContextClick, isOnCanvas } from './canvas-menu';
import type { LayerAction } from './layer-actions';
import { runLayerAction } from './layer-actions';
import type { ContextMenuItem, ContextMenuSections } from './panels/menu-logic';
import type { SelectCommand } from './select-commands';
import { runSelectCommand } from './select-commands';

/**
 * An editor on a 10×10 document with an opaque 6×6 layer per name, bottom first (IDs
 * layer-1…), each filled with its own grey.
 */
function setup(...names: string[]): Editor {
  const doc = createDocument(10, 10);
  names.forEach((name, i) => {
    const layer = createRasterLayer({ id: createLayerId(doc), name, width: 6, height: 6 });
    layer.pixels.data.fill(100 + 50 * i);
    doc.layers.push(layer);
  });
  return new Editor(doc);
}

function select(editor: Editor): void {
  const area = { x: 1, y: 1, width: 3, height: 3 };
  editor.history.execute(new SetSelectionCommand(Selection.fromRect(10, 10, area)));
}

function float(editor: Editor): void {
  select(editor);
  const lift = liftSelectionCommand(editor.document, editor.activeLayerId ?? '');
  if (!lift) throw new Error('Nothing to lift');
  editor.history.execute(lift);
}

class FakeController implements CanvasMenuController {
  blocked = false;
  readonly opened: string[] = [];
  openDuplicateLayer(): void {
    this.opened.push('duplicate');
  }
  openDeleteLayer(): void {
    this.opened.push('delete');
  }
}

function sections(editor: Editor, controller = new FakeController()): ContextMenuSections {
  return canvasMenuSections(editor, controller);
}

/** Labels, with a ✕ on disabled items, section by section. */
function shown(menu: ContextMenuSections): string[][] {
  return menu.map((section) =>
    section.map((item) => (item.disabled ? `${item.label} ✕` : item.label)),
  );
}

function item(menu: ContextMenuSections, label: string): ContextMenuItem {
  const found = menu.flat().find((entry) => entry.label === label);
  if (!found) throw new Error(`No item ${label}`);
  return found;
}

/** Everything about the document a menu item could change, as plain data. */
function state(editor: Editor) {
  const doc: ImageDocument = editor.document;
  return {
    layers: doc.layers.map((layer) => ({
      id: layer.id,
      name: layer.name,
      x: layer.x,
      y: layer.y,
      visible: layer.visible,
      pixels: Array.from(layer.pixels.data),
    })),
    active: editor.activeLayerId,
    floating: editor.floating?.layerId ?? null,
    selection: doc.selection ? Array.from(doc.selection.mask) : null,
  };
}

describe('canvasMenuSections', () => {
  it('offers Deselect and Select Inverse, then Layer via Copy and Cut, with a selection', () => {
    const editor = setup('Background', 'Top');
    select(editor);
    const menu = sections(editor);
    expect(shown(menu)).toEqual([
      ['Deselect', 'Select Inverse'],
      ['Layer via Copy', 'Layer via Cut'],
    ]);
    expect(menu.flat().map((entry) => entry.shortcut)).toEqual(['D', 'Shift+I', 'J', 'Shift+J']);
  });

  it('offers Duplicate Layer… and Delete Layer without a selection', () => {
    const menu = sections(setup('Background', 'Top'));
    expect(shown(menu)).toEqual([['Duplicate Layer…', 'Delete Layer']]);
    expect(menu.flat().map((entry) => entry.shortcut)).toEqual([undefined, undefined]);
  });

  it('disables Delete Layer for the only layer', () => {
    expect(shown(sections(setup('Background')))).toEqual([['Duplicate Layer…', 'Delete Layer ✕']]);
  });

  it('disables Layer via Copy and Cut when the selection misses the active layer', () => {
    const editor = setup('Background');
    const area = { x: 7, y: 7, width: 2, height: 2 };
    editor.history.execute(new SetSelectionCommand(Selection.fromRect(10, 10, area)));
    expect(shown(sections(editor))).toEqual([
      ['Deselect', 'Select Inverse'],
      ['Layer via Copy ✕', 'Layer via Cut ✕'],
    ]);
  });

  it('disables Layer via Copy and Cut on a hidden layer', () => {
    const editor = setup('Background');
    editor.history.execute(new SetLayerVisibilityCommand('layer-1', false));
    select(editor);
    expect(shown(sections(editor))[1]).toEqual(['Layer via Copy ✕', 'Layer via Cut ✕']);
  });

  it('disables everything while blocked (a dialog or a file operation)', () => {
    const controller = new FakeController();
    controller.blocked = true;
    const editor = setup('Background', 'Top');
    expect(shown(canvasMenuSections(editor, controller))).toEqual([
      ['Duplicate Layer… ✕', 'Delete Layer ✕'],
    ]);
    select(editor);
    expect(shown(canvasMenuSections(editor, controller))).toEqual([
      ['Deselect ✕', 'Select Inverse ✕'],
      ['Layer via Copy ✕', 'Layer via Cut ✕'],
    ]);
  });

  it('keeps the layer items enabled while a selection floats (they commit it first)', () => {
    const editor = setup('Background');
    float(editor);
    expect(shown(sections(editor))).toEqual([
      ['Deselect', 'Select Inverse'],
      ['Layer via Copy', 'Layer via Cut'],
    ]);
  });

  it("puts the active tool's sections first, dropping empty ones", () => {
    const editor = setup('Background', 'Top');
    const toolItem: ContextMenuItem = { command: 'tool', label: 'Tool Item', run: () => {} };
    const menu = canvasMenuSections(editor, new FakeController(), [[], [toolItem]]);
    expect(shown(menu)).toEqual([['Tool Item'], ['Duplicate Layer…', 'Delete Layer']]);
  });

  it('asks before duplicating or deleting, through the controller', () => {
    const editor = setup('Background', 'Top');
    const controller = new FakeController();
    const menu = canvasMenuSections(editor, controller);
    const before = state(editor);
    item(menu, 'Duplicate Layer…').run();
    item(menu, 'Delete Layer').run();
    expect(controller.opened).toEqual(['duplicate', 'delete']);
    expect(state(editor)).toEqual(before);
    expect(editor.history.canUndo).toBe(false);
  });

  const BAR: readonly (readonly [string, (editor: Editor) => void])[] = [
    ['Deselect', (editor) => runSelectCommand(editor, 'deselect' satisfies SelectCommand)],
    ['Select Inverse', (editor) => runSelectCommand(editor, 'inverse' satisfies SelectCommand)],
    ['Layer via Copy', (editor) => runLayerAction(editor, 'layer-via-copy' satisfies LayerAction)],
    ['Layer via Cut', (editor) => runLayerAction(editor, 'layer-via-cut' satisfies LayerAction)],
  ];

  it.each(BAR)('%s does what the menu bar does, in one undo step', (label, menuBar) => {
    const fromMenu = setup('Background', 'Top');
    const fromBar = setup('Background', 'Top');
    select(fromMenu);
    select(fromBar);
    const before = state(fromMenu);
    item(sections(fromMenu), label).run();
    menuBar(fromBar);
    expect(state(fromMenu)).toEqual(state(fromBar));
    expect(state(fromMenu)).not.toEqual(before);
    expect(fromMenu.history.undoLabel).toBe(fromBar.history.undoLabel);
    fromMenu.history.undo();
    expect(state(fromMenu)).toEqual(before);
  });

  it.each(BAR)('%s commits a floating selection first, as the menu bar does', (label, bar) => {
    const fromMenu = setup('Background');
    const fromBar = setup('Background');
    float(fromMenu);
    float(fromBar);
    item(sections(fromMenu), label).run();
    bar(fromBar);
    expect(fromMenu.floating).toBeNull();
    expect(state(fromMenu)).toEqual(state(fromBar));
    expect(fromMenu.history.undoLabel).toBe(fromBar.history.undoLabel);
    fromMenu.history.undo();
    fromBar.history.undo();
    expect(fromMenu.history.undoLabel).toBe('Commit Floating Selection');
    expect(state(fromMenu)).toEqual(state(fromBar));
  });
});

describe('isOnCanvas', () => {
  const doc = createDocument(10, 8);

  it('is true over the document, edges included', () => {
    expect(isOnCanvas(doc, 0, 0)).toBe(true);
    expect(isOnCanvas(doc, 9.99, 7.99)).toBe(true);
    expect(isOnCanvas(doc, 5, 4)).toBe(true);
  });

  it('is false over the void around it', () => {
    expect(isOnCanvas(doc, -0.01, 4)).toBe(false);
    expect(isOnCanvas(doc, 5, -1)).toBe(false);
    expect(isOnCanvas(doc, 10, 4)).toBe(false);
    expect(isOnCanvas(doc, 5, 8)).toBe(false);
  });
});

describe('isContextClick', () => {
  it('is the secondary button on every platform', () => {
    expect(isContextClick({ button: 2, ctrlKey: false }, false)).toBe(true);
    expect(isContextClick({ button: 2, ctrlKey: false }, true)).toBe(true);
  });

  it('is a Control-click on a Mac only', () => {
    expect(isContextClick({ button: 0, ctrlKey: true }, true)).toBe(true);
    expect(isContextClick({ button: 0, ctrlKey: true }, false)).toBe(false);
  });

  it('is not a plain primary or middle press', () => {
    expect(isContextClick({ button: 0, ctrlKey: false }, true)).toBe(false);
    expect(isContextClick({ button: 1, ctrlKey: false }, false)).toBe(false);
    expect(isContextClick({ button: 1, ctrlKey: true }, true)).toBe(false);
  });
});
