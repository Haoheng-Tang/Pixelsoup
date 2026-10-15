import type { Editor, ImageDocument } from '../core';
import { canRunLayerAction, runLayerAction } from './layer-actions';
import type { ContextMenuItem, ContextMenuSections } from './panels/menu-logic';
import { runSelectCommand } from './select-commands';

/** What the canvas menu needs from the app controller. */
export interface CanvasMenuController {
  /** True while a dialog is open or a file operation runs: every item is disabled. */
  readonly blocked: boolean;
  /** Asks for the copy's name, then duplicates the active layer. */
  openDuplicateLayer(): void;
  /** Asks for confirmation, then deletes the active layer. */
  openDeleteLayer(): void;
}

/** What the canvas menu needs to start Free Transform (`FreeTransform`). */
export interface CanvasMenuTransform {
  /** Whether there's a layer to transform. */
  canStart(): boolean;
  /** Starts Free Transform, or says in the status bar why it can't. */
  start(): boolean;
}

/**
 * Whether the canvas's context menu opens for a right-click at document point (x, y):
 * only over the document, not the void around it.
 */
export function isOnCanvas(doc: ImageDocument, x: number, y: number): boolean {
  return x >= 0 && y >= 0 && x < doc.width && y < doc.height;
}

/**
 * Whether a press asks for a context menu rather than starting a tool gesture: the
 * secondary button, or on a Mac a primary click with Control held.
 */
export function isContextClick(
  e: { readonly button: number; readonly ctrlKey: boolean },
  apple: boolean,
): boolean {
  return e.button === 2 || (apple && e.button === 0 && e.ctrlKey);
}

/**
 * The canvas's context menu. With a selection: Deselect and Select Inverse, then Layer
 * via Copy and Layer via Cut. Without one: Duplicate Layer… and Delete Layer, which ask
 * first (a name, a confirmation). Then Free Transform, either way. The items run the same
 * actions as the menu bar (`runSelectCommand`, `runLayerAction`, `transform.start`), so
 * they enable, commit a floating selection and name their undo steps alike.
 * `toolSections`, the active tool's own items (none yet; Fill… could go there), come
 * first. While a session such as Free Transform runs, its items are the whole menu
 * (`exclusive`).
 */
export function canvasMenuSections(
  editor: Editor,
  controller: CanvasMenuController,
  transform: CanvasMenuTransform,
  toolSections: ContextMenuSections = [],
  { exclusive = false }: { readonly exclusive?: boolean } = {},
): ContextMenuSections {
  const own = toolSections.filter((section) => section.length > 0);
  if (exclusive) return own;
  const { blocked } = controller;
  const layerItem = (
    action: 'layer-via-copy' | 'layer-via-cut',
    label: string,
    shortcut: string,
  ) => ({
    command: action,
    label,
    shortcut,
    disabled: blocked || !canRunLayerAction(editor, action),
    run: () => runLayerAction(editor, action),
  });
  const standard: ContextMenuSections = editor.document.selection
    ? [
        [
          {
            command: 'deselect',
            label: 'Deselect',
            shortcut: 'D',
            disabled: blocked,
            run: () => runSelectCommand(editor, 'deselect'),
          },
          {
            command: 'inverse',
            label: 'Select Inverse',
            shortcut: 'Shift+I',
            disabled: blocked,
            run: () => runSelectCommand(editor, 'inverse'),
          },
        ],
        [
          layerItem('layer-via-copy', 'Layer via Copy', 'J'),
          layerItem('layer-via-cut', 'Layer via Cut', 'Shift+J'),
        ],
      ]
    : [
        [
          {
            command: 'duplicate-layer',
            label: 'Duplicate Layer…',
            disabled: blocked || !canRunLayerAction(editor, 'duplicate'),
            run: () => controller.openDuplicateLayer(),
          },
          {
            command: 'delete-layer',
            label: 'Delete Layer',
            disabled: blocked || !canRunLayerAction(editor, 'delete'),
            run: () => controller.openDeleteLayer(),
          },
        ],
      ];
  const freeTransform: ContextMenuItem = {
    command: 'free-transform',
    label: 'Free Transform',
    shortcut: 'Alt+T',
    disabled: blocked || !transform.canStart(),
    run: () => {
      transform.start();
    },
  };
  return [...own, ...standard, [freeTransform]];
}
