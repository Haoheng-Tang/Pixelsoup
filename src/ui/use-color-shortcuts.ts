import { useEffect } from 'react';
import type { Colors } from './color/colors';
import { isTextEntry } from './dom';

/**
 * X swaps the foreground and background colours and D resets them to black and white.
 * Ignored with modifiers, while typing, and while a dialog is open.
 */
export function useColorShortcuts(colors: Colors, gate: { readonly blocked: boolean }): void {
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey || e.shiftKey || e.repeat) return;
      if (isTextEntry(e.target) || gate.blocked) return;
      const key = e.key.toLowerCase();
      if (key === 'x') colors.swap();
      else if (key === 'd') colors.reset();
      else return;
      e.preventDefault();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [colors, gate]);
}
