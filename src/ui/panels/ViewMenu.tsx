import { useRevision } from '../use-revision';
import type { ViewCommand, ViewOptions } from '../viewport/view-options';
import { runViewCommand } from '../viewport/view-options';
import type { MenuEntry } from './MenuButton';
import { MenuButton } from './MenuButton';

interface ViewMenuProps {
  view: ViewOptions;
  /** True while a dialog is open or a file operation is running. */
  blocked: boolean;
}

export function ViewMenu({ view, blocked }: ViewMenuProps) {
  useRevision(view);
  const sections: readonly (readonly MenuEntry<ViewCommand>[])[] = [
    // Quick Mask will go in a section of its own.
    [
      {
        command: 'extras',
        label: 'Extras',
        shortcut: 'H',
        checked: view.showExtras,
        disabled: blocked,
      },
    ],
  ];
  return (
    <MenuButton
      label="View"
      sections={sections}
      onChoose={(command) => runViewCommand(view, command)}
    />
  );
}
