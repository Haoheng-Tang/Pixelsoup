import { useEffect } from 'react';
import type { Editor } from '../core';
import { isTextEntry } from './dom';
import type { SelectCommand } from './select-commands';
import { runSelectCommand } from './select-commands';

function commandFor(key: string, shift: boolean): SelectCommand | null {
  switch (key) {
    case 'a':
      return shift ? null : 'select-all';
    case 'd':
      return shift ? null : 'deselect';
    case 'i':
      return shift ? 'inverse' : null;
    default:
      return null;
  }
}

/**
 * Selection shortcuts: Ctrl/Cmd+A select all, +D deselect, +Shift+I inverse. They always
 * suppress the browser's own action (select page text, bookmark, developer tools) except
 * in text fields, where the keys keep their usual meaning. Inactive while `gate.blocked`.
 */
export function useSelectionShortcuts(editor: Editor, gate: { readonly blocked: boolean }): void {
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || e.altKey || isTextEntry(e.target)) return;
      const command = commandFor(e.key.toLowerCase(), e.shiftKey);
      if (!command) return;
      e.preventDefault();
      if (!e.repeat && !gate.blocked) runSelectCommand(editor, command);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [editor, gate]);
}
