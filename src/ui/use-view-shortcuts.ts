import { useEffect } from 'react';
import { isTextEntry } from './dom';
import type { ShortcutKeys } from './use-layer-shortcuts';
import type { ViewCommand, ViewOptions } from './viewport/view-options';
import { runViewCommand } from './viewport/view-options';

/** The View command for a key press, if any: Ctrl/Cmd+H shows or hides Extras. */
export function viewCommandFor(e: ShortcutKeys): ViewCommand | null {
  if (!(e.ctrlKey || e.metaKey) || e.altKey || e.shiftKey) return null;
  return e.key.toLowerCase() === 'h' ? 'extras' : null;
}

/**
 * View shortcuts: Ctrl/Cmd+H shows or hides the marching ants (View → Extras). It
 * suppresses the browser's own action (history) but leaves text fields alone. Inactive while
 * `gate.blocked`.
 */
export function useViewShortcuts(view: ViewOptions, gate: { readonly blocked: boolean }): void {
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (isTextEntry(e.target)) return;
      const command = viewCommandFor(e);
      if (!command) return;
      e.preventDefault();
      if (!e.repeat && !gate.blocked) runViewCommand(view, command);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [view, gate]);
}
