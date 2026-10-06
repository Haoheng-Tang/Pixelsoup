import type { Editor } from '../../core';
import type { SelectCommand } from '../select-commands';
import { runSelectCommand } from '../select-commands';
import { useEditorRevision } from '../use-editor-revision';
import type { MenuEntry } from './MenuButton';
import { MenuButton } from './MenuButton';

interface SelectMenuProps {
  editor: Editor;
  /** True while a dialog is open or a file operation is running. */
  blocked: boolean;
}

export function SelectMenu({ editor, blocked }: SelectMenuProps) {
  useEditorRevision(editor);
  const noSelection = editor.document.selection === null;
  const sections: readonly (readonly MenuEntry<SelectCommand>[])[] = [
    [
      { command: 'select-all', label: 'Select All', shortcut: 'A', disabled: blocked },
      { command: 'deselect', label: 'Deselect', shortcut: 'D', disabled: blocked || noSelection },
      {
        command: 'inverse',
        label: 'Inverse',
        shortcut: 'Shift+I',
        disabled: blocked || noSelection,
      },
    ],
  ];
  return (
    <MenuButton
      label="Select"
      sections={sections}
      onChoose={(command) => runSelectCommand(editor, command)}
    />
  );
}
