import { useEffect } from 'react';
import type { Editor } from '../core';
import { assertNever } from '../core';
import type { Colors } from './color/colors';
import { isTextEntry } from './dom';
import { runClear, runFill } from './edit-actions';
import type { AppController } from './session/app-controller';

/** What an editing shortcut does. */
export type EditShortcut =
  | {
      readonly kind: 'fill';
      readonly color: 'foreground' | 'background';
      readonly preserveTransparency: boolean;
    }
  | { readonly kind: 'fill-dialog' }
  | { readonly kind: 'clear' };

export type EditShortcutKeys = Pick<
  KeyboardEvent,
  'key' | 'ctrlKey' | 'metaKey' | 'altKey' | 'shiftKey'
>;

/**
 * The editing shortcut for a key press, if any. Backspace and Delete work alike, so the
 * Mac's delete key, which types Backspace, does everything: with Alt (Option) it fills
 * with the foreground colour, with Ctrl or Cmd the background colour, and adding Shift to
 * either keeps the layer's transparency. Shift alone opens the Fill dialog, and the key
 * alone clears. Ctrl+Alt (AltGr on Windows) and Cmd+Option never match.
 */
export function editShortcutFor(e: EditShortcutKeys): EditShortcut | null {
  if (e.key !== 'Backspace' && e.key !== 'Delete') return null;
  const mod = e.ctrlKey || e.metaKey;
  if (e.altKey && mod) return null;
  if (e.altKey || mod) {
    return {
      kind: 'fill',
      color: e.altKey ? 'foreground' : 'background',
      preserveTransparency: e.shiftKey,
    };
  }
  return e.shiftKey ? { kind: 'fill-dialog' } : { kind: 'clear' };
}

/**
 * Editing shortcuts (see `editShortcutFor`). They suppress the browser's own action but
 * leave text fields alone, and keys the active tool took: the viewport hands keys to the
 * tool from the document, before they reach this listener on the window, and the
 * Polygonal Lasso takes Backspace and Delete to remove a vertex. Held keys don't repeat.
 * Inactive while `controller.blocked`.
 */
export function useEditShortcuts(editor: Editor, colors: Colors, controller: AppController): void {
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (isTextEntry(e.target) || e.defaultPrevented) return;
      const shortcut = editShortcutFor(e);
      if (!shortcut) return;
      e.preventDefault();
      if (e.repeat || controller.blocked) return;
      switch (shortcut.kind) {
        case 'fill': {
          const mode = shortcut.preserveTransparency ? 'preserve-transparency' : 'normal';
          runFill(editor, colors[shortcut.color], 1, mode);
          break;
        }
        case 'fill-dialog':
          controller.openFill();
          break;
        case 'clear':
          runClear(editor);
          break;
        default:
          assertNever(shortcut);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [editor, colors, controller]);
}
