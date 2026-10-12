import type { Editor } from '../../core';
import { assertNever } from '../../core';
import { canClear, canFill, runClear } from '../edit-actions';
import type { AppController } from '../session/app-controller';
import { IS_APPLE } from '../use-file-shortcuts';
import { useEditorRevision } from '../use-editor-revision';
import type { MenuEntry } from './MenuButton';
import { MenuButton } from './MenuButton';

type EditCommand = 'undo' | 'redo' | 'fill' | 'clear';

interface EditMenuProps {
  editor: Editor;
  controller: AppController;
  /** True while a dialog is open or a file operation is running. */
  blocked: boolean;
}

/**
 * The Edit menu. Fill and Clear also have plain shortcuts (see `useEditShortcuts`); the
 * menu shows the Mac's delete key, which types Backspace, as the key that clears.
 */
export function EditMenu({ editor, controller, blocked }: EditMenuProps) {
  useEditorRevision(editor);
  const { history } = editor;
  const sections: readonly (readonly MenuEntry<EditCommand>[])[] = [
    [
      {
        command: 'undo',
        label: history.undoLabel ? `Undo ${history.undoLabel}` : 'Undo',
        shortcut: 'Z',
        disabled: blocked || !history.canUndo,
      },
      {
        command: 'redo',
        label: history.redoLabel ? `Redo ${history.redoLabel}` : 'Redo',
        shortcut: 'Shift+Z',
        disabled: blocked || !history.canRedo,
      },
    ],
    // Cut, Copy and Paste will go here.
    [
      {
        command: 'fill',
        label: 'Fill…',
        shortcut: 'Shift+Backspace',
        plain: true,
        disabled: blocked || !canFill(editor),
      },
      {
        command: 'clear',
        label: 'Clear',
        shortcut: IS_APPLE ? 'Backspace' : 'Delete',
        plain: true,
        disabled: blocked || !canClear(editor),
      },
    ],
  ];
  return (
    <MenuButton
      label="Edit"
      sections={sections}
      onChoose={(command) => {
        switch (command) {
          case 'undo':
            history.undo();
            break;
          case 'redo':
            history.redo();
            break;
          case 'fill':
            controller.openFill();
            break;
          case 'clear':
            runClear(editor);
            break;
          default:
            assertNever(command);
        }
      }}
    />
  );
}
