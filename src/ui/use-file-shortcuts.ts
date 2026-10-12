import { useEffect } from 'react';
import type { AppController, FileCommand } from './session/app-controller';

/** Ctrl on Windows/Linux, ⌘ on Apple platforms. */
export const IS_APPLE = /Mac|iPhone|iPad|iPod/.test(navigator.userAgent);

/** Keys as Apple keyboards label them. */
const APPLE_KEYS: Readonly<Record<string, string>> = { Backspace: '⌫', Delete: '⌦' };

export interface ShortcutFormat {
  /** The keys alone, without Ctrl/Cmd: "Delete" is just the Delete key. */
  readonly plain?: boolean;
  /** Apple's symbols rather than key names; the platform's way by default. */
  readonly apple?: boolean;
}

/**
 * Formats a shortcut such as "Shift+S" with the platform's modifier: Ctrl+Shift+S or ⇧⌘S.
 * A plain one has no modifier added: "Shift+Backspace" is Shift+Backspace or ⇧⌫.
 */
export function formatShortcut(
  keys: string,
  { plain = false, apple = IS_APPLE }: ShortcutFormat = {},
): string {
  const parts = keys.split('+');
  const key = parts.pop() ?? '';
  const shift = parts.includes('Shift');
  if (apple) return `${shift ? '⇧' : ''}${plain ? '' : '⌘'}${APPLE_KEYS[key] ?? key}`;
  return `${plain ? '' : 'Ctrl+'}${shift ? 'Shift+' : ''}${key}`;
}

function commandFor(key: string, shift: boolean): FileCommand | null {
  switch (key) {
    case 'n':
      return shift ? null : 'new';
    case 'o':
      return shift ? null : 'open';
    case 's':
      return shift ? 'save-as' : 'save';
    case 'e':
      return shift ? 'export' : null;
    default:
      return null;
  }
}

/**
 * File shortcuts: Ctrl/Cmd+N new, +O open, +S save, +Shift+S save as, +Shift+E export.
 * They work in text fields too, and always suppress the browser's own action (e.g. Save
 * Page), even while a dialog is open and the command itself is ignored.
 */
export function useFileShortcuts(controller: AppController): void {
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || e.altKey) return;
      const command = commandFor(e.key.toLowerCase(), e.shiftKey);
      if (!command) return;
      e.preventDefault();
      if (!e.repeat) controller.run(command);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [controller]);
}
