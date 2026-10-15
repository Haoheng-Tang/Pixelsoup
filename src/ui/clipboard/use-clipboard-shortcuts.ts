import { useEffect } from 'react';
import type { Rect } from '../../core';
import { isTextEntry } from '../dom';
import type { ClipboardCommand, PixelClipboard } from './pixel-clipboard';

export type ClipboardShortcutKeys = Pick<
  KeyboardEvent,
  'key' | 'ctrlKey' | 'metaKey' | 'altKey' | 'shiftKey'
>;

/**
 * The clipboard command for a key press, if any: Ctrl/Cmd+X cut, +C copy, +Shift+C copy
 * merged and +V paste. Alt (and so AltGr) never matches.
 */
export function clipboardShortcutFor(e: ClipboardShortcutKeys): ClipboardCommand | null {
  if (!(e.ctrlKey || e.metaKey) || e.altKey) return null;
  switch (e.key.toLowerCase()) {
    case 'x':
      return e.shiftKey ? null : 'cut';
    case 'c':
      return e.shiftKey ? 'copy-merged' : 'copy';
    case 'v':
      return e.shiftKey ? null : 'paste';
    default:
      return null;
  }
}

/**
 * Clipboard shortcuts (see `clipboardShortcutFor`), ignored in text fields, while
 * `gate.blocked` and for keys the active tool took. Cut and Copy suppress the browser's own
 * action. Ctrl/Cmd+V doesn't, so the browser fires its paste event, which carries images
 * copied in other apps without asking for permission (`PixelClipboard.pasteData`); if no
 * paste event follows (Safari only fires one in editable elements), the key pastes
 * Pixelsoup's own clipboard. `viewArea` gives the canvas area in view for centring pastes.
 */
export function useClipboardShortcuts(
  clipboard: PixelClipboard,
  gate: { readonly blocked: boolean },
  viewArea: () => Rect | null,
): void {
  useEffect(() => {
    let pendingPaste = 0;
    const onKeyDown = (e: KeyboardEvent) => {
      if (isTextEntry(e.target) || e.defaultPrevented) return;
      const command = clipboardShortcutFor(e);
      if (!command) return;
      if (command !== 'paste' || e.repeat) e.preventDefault();
      if (e.repeat || gate.blocked) return;
      if (command === 'paste') {
        window.clearTimeout(pendingPaste);
        pendingPaste = window.setTimeout(() => {
          pendingPaste = 0;
          clipboard.run('paste', viewArea());
        }, 0);
        return;
      }
      clipboard.run(command, viewArea());
    };
    const onPaste = (e: ClipboardEvent) => {
      if (isTextEntry(e.target)) return;
      window.clearTimeout(pendingPaste);
      pendingPaste = 0;
      if (gate.blocked) return;
      e.preventDefault();
      void clipboard.pasteData(e.clipboardData, viewArea());
    };
    const onBlur = () => clipboard.windowBlurred();
    window.addEventListener('keydown', onKeyDown);
    document.addEventListener('paste', onPaste);
    window.addEventListener('blur', onBlur);
    return () => {
      window.clearTimeout(pendingPaste);
      window.removeEventListener('keydown', onKeyDown);
      document.removeEventListener('paste', onPaste);
      window.removeEventListener('blur', onBlur);
    };
  }, [clipboard, gate, viewArea]);
}
