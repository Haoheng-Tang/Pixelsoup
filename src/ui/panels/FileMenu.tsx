import type { AppController, FileCommand } from '../session/app-controller';
import type { MenuEntry } from './MenuButton';
import { MenuButton } from './MenuButton';

const SECTIONS: readonly (readonly MenuEntry<FileCommand>[])[] = [
  [
    { command: 'new', label: 'New…', shortcut: 'N' },
    { command: 'open', label: 'Open…', shortcut: 'O' },
    { command: 'import', label: 'Import Image as Layer…' },
  ],
  [
    { command: 'save', label: 'Save', shortcut: 'S' },
    { command: 'save-as', label: 'Save As…', shortcut: 'Shift+S' },
    { command: 'export', label: 'Export…', shortcut: 'Shift+E' },
  ],
  [{ command: 'close', label: 'Close' }],
  [{ command: 'demo', label: 'Demo Document' }],
];

export function FileMenu({ controller }: { controller: AppController }) {
  return (
    <MenuButton label="File" sections={SECTIONS} onChoose={(command) => controller.run(command)} />
  );
}
