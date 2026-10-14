import type { Editor, Rect } from '../../core';
import { assertNever } from '../../core';
import type { ClipboardCommand, PixelClipboard } from '../clipboard/pixel-clipboard';
import { canClear, canFill, runClear } from '../edit-actions';
import type { AppController } from '../session/app-controller';
import { IS_APPLE } from '../use-file-shortcuts';
import { useEditorRevision } from '../use-editor-revision';
import { useRevision } from '../use-revision';
import type { MenuEntry } from './MenuButton';
import { MenuButton } from './MenuButton';

type EditCommand = 'undo' | 'redo' | ClipboardCommand | 'fill' | 'clear';

interface EditMenuProps {
  editor: Editor;
  controller: AppController;
  clipboard: PixelClipboard;
  /** The canvas area in view, in document coordinates, to centre pastes in. */
  viewArea: () => Rect | null;
  /** True while a dialog is open or a file operation is running. */
  blocked: boolean;
}

/**
 * The Edit menu. Fill and Clear also have plain shortcuts (see `useEditShortcuts`); the
 * menu shows the Mac's delete key, which types Backspace, as the key that clears. Paste
 * pastes Pixelsoup's own clipboard: only Ctrl/Cmd+V can paste an image from another app.
 */
export function EditMenu({ editor, controller, clipboard, viewArea, blocked }: EditMenuProps) {
  useEditorRevision(editor);
  useRevision(clipboard);
  const { history } = editor;
  const clip = (command: ClipboardCommand, label: string, shortcut: string) => ({
    command,
    label,
    shortcut,
    disabled: blocked || !clipboard.canRun(command),
  });
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
    [
      clip('cut', 'Cut', 'X'),
      clip('copy', 'Copy', 'C'),
      clip('copy-merged', 'Copy Merged', 'Shift+C'),
      clip('paste', 'Paste', 'V'),
    ],
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
          case 'cut':
          case 'copy':
          case 'copy-merged':
          case 'paste':
            clipboard.run(command, viewArea());
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
