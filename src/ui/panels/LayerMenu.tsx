import type { Editor } from '../../core';
import type { LayerAction } from '../layer-actions';
import { canRunLayerAction, runLayerAction } from '../layer-actions';
import { useEditorRevision } from '../use-editor-revision';
import type { MenuEntry } from './MenuButton';
import { MenuButton } from './MenuButton';

interface LayerMenuProps {
  editor: Editor;
  /** True while a dialog is open or a file operation is running. */
  blocked: boolean;
}

export function LayerMenu({ editor, blocked }: LayerMenuProps) {
  useEditorRevision(editor);
  const item = (
    command: LayerAction,
    label: string,
    shortcut?: string,
  ): MenuEntry<LayerAction> => ({
    command,
    label,
    ...(shortcut === undefined ? {} : { shortcut }),
    disabled: blocked || !canRunLayerAction(editor, command),
  });
  const sections: readonly (readonly MenuEntry<LayerAction>[])[] = [
    [
      item('new', 'New Layer', 'Shift+N'),
      item('duplicate', 'Duplicate Layer', 'J'),
      item('delete', 'Delete Layer'),
    ],
    [item('move-up', 'Move Layer Up', ']'), item('move-down', 'Move Layer Down', '[')],
    [item('merge-down', 'Merge Down', 'E'), item('flatten', 'Flatten Image')],
    [item('commit-floating', 'Commit Floating Selection', 'Enter')],
  ];
  return (
    <MenuButton
      label="Layer"
      sections={sections}
      onChoose={(command) => runLayerAction(editor, command)}
    />
  );
}
