import type { Editor, ImageDocument, Orientation, ResizeCanvasCommand } from '../core';
import { OrientCanvasCommand, cropCommand, intersectRects, rasterBounds } from '../core';

/** Image menu items that act straight away, without a dialog. */
export type ImageAction = 'crop-to-selection' | Orientation;

/** Whether `action` would do anything now, for enabling menu items. */
export function canRunImageAction(editor: Editor, action: ImageAction): boolean {
  return action !== 'crop-to-selection' || cropToSelection(editor.document) !== null;
}

/**
 * Runs `action` if it would do anything, committing a floating selection first. Crop to
 * Selection crops the canvas to the selection's bounds and, like the Crop tool by default,
 * keeps the pixels past the new edges.
 */
export function runImageAction(editor: Editor, action: ImageAction): void {
  if (!canRunImageAction(editor, action)) return;
  editor.commitFloating();
  const doc = editor.document;
  const command =
    action === 'crop-to-selection' ? cropToSelection(doc) : new OrientCanvasCommand(action);
  if (command) editor.history.execute(command);
}

function cropToSelection(doc: ImageDocument): ResizeCanvasCommand | null {
  const bounds = doc.selection?.bounds();
  return bounds ? cropCommand(doc, bounds, { label: 'Crop to Selection' }) : null;
}

/** What Rotate Layer turns: the whole active layer, or just the selected pixels. */
export type RotateTarget = 'layer' | 'selection';

/**
 * What Rotate Layer would turn now: a floating selection, or the active layer's selected
 * pixels (lifted into a floating selection first), or with nothing selected the whole
 * active layer. Null when there's nothing to turn: no active layer, a hidden one, or a
 * selection that misses it, as for the Move tool.
 */
export function rotateLayerTarget(editor: Editor): RotateTarget | null {
  if (editor.floating) return 'selection';
  const layer = editor.activeLayer;
  if (!layer?.visible) return null;
  const selected = editor.document.selection?.bounds();
  if (!selected) return 'layer';
  return intersectRects(selected, rasterBounds(layer)) ? 'selection' : null;
}
