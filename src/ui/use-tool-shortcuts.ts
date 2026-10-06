import { useEffect } from 'react';
import { isTextEntry } from './dom';
import type { ToolManager } from './tools/tool-manager';

/**
 * Tool shortcuts: a tool's key (e.g. M) selects it; Shift+key cycles through tools that
 * share the key. Ignored with Ctrl, Cmd or Alt, while typing, and while a dialog is open.
 */
export function useToolShortcuts(tools: ToolManager, gate: { readonly blocked: boolean }): void {
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey || e.repeat || isTextEntry(e.target)) return;
      if (gate.blocked) return;
      if (tools.handleShortcut(e.key, e.shiftKey)) e.preventDefault();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [tools, gate]);
}
