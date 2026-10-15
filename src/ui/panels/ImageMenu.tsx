import type { Editor, Orientation } from '../../core';
import { ORIENTATION_LABELS } from '../../core';
import type { ImageAction } from '../image-actions';
import { canRunImageAction, runImageAction } from '../image-actions';
import type { AppController, ImageDialog } from '../session/app-controller';
import { useEditorRevision } from '../use-editor-revision';
import type { MenuEntry } from './MenuButton';
import { MenuButton } from './MenuButton';

type ImageCommand = ImageAction | ImageDialog;

interface ImageMenuProps {
  editor: Editor;
  controller: AppController;
  /** True while a dialog is open or a file operation is running. */
  blocked: boolean;
}

/**
 * The Image menu. It has no shortcuts: Photoshop's use Ctrl+Alt, which is AltGr on many
 * keyboards.
 */
export function ImageMenu({ editor, controller, blocked }: ImageMenuProps) {
  useEditorRevision(editor);
  const action = (command: ImageAction, label: string): MenuEntry<ImageCommand> => ({
    command,
    label,
    disabled: blocked || !canRunImageAction(editor, command),
  });
  const orient = (command: Orientation) => action(command, ORIENTATION_LABELS[command]);
  const sections: readonly (readonly MenuEntry<ImageCommand>[])[] = [
    [action('crop-to-selection', 'Crop to Selection')],
    [
      { command: 'image-size', label: 'Image Size…', disabled: blocked },
      { command: 'canvas-size', label: 'Canvas Size…', disabled: blocked },
    ],
    [orient('rotate-cw'), orient('rotate-ccw'), orient('rotate-180')],
    [orient('flip-horizontal'), orient('flip-vertical')],
  ];
  return (
    <MenuButton
      label="Image"
      sections={sections}
      onChoose={(command) => {
        if (command === 'image-size' || command === 'canvas-size') {
          controller.openDialog(command);
        } else {
          runImageAction(editor, command);
        }
      }}
    />
  );
}
