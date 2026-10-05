import { useEffect } from 'react';
import type { Editor } from '../core';
import { isTextEntry } from './dom';

/**
 * Global undo/redo shortcuts: Ctrl/Cmd+Z, Ctrl/Cmd+Shift+Z and Ctrl+Y. Inactive while
 * `gate.blocked` (a dialog is open or a file operation is running).
 */
export function useHistoryShortcuts(editor: Editor, gate: { readonly blocked: boolean }): void {
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || e.altKey || isTextEntry(e.target) || gate.blocked) return;
      const key = e.key.toLowerCase();
      if (key === 'z') {
        e.preventDefault();
        if (e.shiftKey) editor.history.redo();
        else editor.history.undo();
      } else if (key === 'y' && !e.shiftKey) {
        e.preventDefault();
        editor.history.redo();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [editor, gate]);
}
