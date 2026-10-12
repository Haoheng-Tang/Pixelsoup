import type { Editor, Selection, SelectionMode } from '../../core';
import { combineSelections, SetSelectionCommand } from '../../core';
import type { SelectionOptions } from './selection-options';
import type { ToolModifiers } from './tool';

/** The mode chosen by modifiers held at the press: Shift adds, Alt subtracts, both intersect. */
export function modifierMode(e: ToolModifiers): SelectionMode | null {
  if (e.shiftKey && e.altKey) return 'intersect';
  if (e.shiftKey) return 'add';
  if (e.altKey) return 'subtract';
  return null;
}

/**
 * The mode for a selection tool's press: the options bar's, unless there's a selection
 * and Shift or Alt is held, which pick one (`picked`). Without a selection there is
 * nothing to add to, so the modifiers are left for the tool to use otherwise.
 */
export function pressMode(
  editor: Editor,
  e: ToolModifiers,
  options: SelectionOptions,
): { readonly mode: SelectionMode; readonly picked: boolean } {
  const picked = editor.document.selection ? modifierMode(e) : null;
  return { mode: picked ?? options.mode, picked: picked !== null };
}

/**
 * Combines `shape` with the selection in `mode` and makes the result the selection, as
 * one undo step named `label`, after committing a floating selection. A null or empty
 * shape (a click, or a shape wholly off the canvas) deselects in New mode and does
 * nothing in the others. Nothing happens if the selection wouldn't change.
 */
export function applySelection(
  editor: Editor,
  shape: Selection | null,
  mode: SelectionMode,
  label: string,
): void {
  const current = editor.document.selection;
  if (!shape || shape.isEmpty) {
    if (mode === 'replace' && current) {
      editor.commitFloating();
      editor.history.execute(new SetSelectionCommand(null, 'Deselect'));
    }
    return;
  }
  const next = combineSelections(current, shape, mode);
  if (next === null ? current === null : current?.equals(next)) return;
  // A floating selection is dropped back into its layer before the selection changes.
  editor.commitFloating();
  editor.history.execute(new SetSelectionCommand(next, label));
}
