import { useEffect } from 'react';
import type { Editor } from '../core';
import { isTextEntry } from './dom';

/** Global undo/redo shortcuts: Ctrl/Cmd+Z, Ctrl/Cmd+Shift+Z and Ctrl+Y. */
export function useHistoryShortcuts(editor: Editor): void {
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || e.altKey || isTextEntry(e.target)) return;
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
  }, [editor]);
}
