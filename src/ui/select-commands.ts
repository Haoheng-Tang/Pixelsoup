import type { Editor, SetSelectionCommand } from '../core';
import { assertNever, deselectCommand, invertSelectionCommand, selectAllCommand } from '../core';

/** Commands of the Select menu and their shortcuts. */
export type SelectCommand = 'select-all' | 'deselect' | 'inverse';

/** Runs a Select menu command; does nothing if it wouldn't change the selection. */
export function runSelectCommand(editor: Editor, command: SelectCommand): void {
  const doc = editor.document;
  let change: SetSelectionCommand | null;
  switch (command) {
    case 'select-all':
      change = selectAllCommand(doc);
      break;
    case 'deselect':
      change = deselectCommand(doc);
      break;
    case 'inverse':
      change = invertSelectionCommand(doc);
      break;
    default:
      return assertNever(command);
  }
  if (change) editor.history.execute(change);
}
