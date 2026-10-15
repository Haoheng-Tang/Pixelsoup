import type { Editor, ImageDocument, Orientation, ResizeCanvasCommand } from '../core';
import { OrientCanvasCommand, cropCommand } from '../core';

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
