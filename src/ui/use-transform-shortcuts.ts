import { useEffect } from 'react';
import { isTextEntry } from './dom';
import type { FreeTransform } from './transform/free-transform';
import type { ShortcutKeys } from './use-layer-shortcuts';

/**
 * Whether a key press is Free Transform's shortcut: Ctrl/Cmd+Alt+T, without Shift.
 * Photoshop's Ctrl/Cmd+T never reaches a page in a browser tab (it opens a new tab), so
 * Pixelsoup uses Photopea's. Option changes the character on a Mac (Option+T types †), as
 * AltGr can on Windows, so where the key isn't a letter it's matched by position.
 */
export function isFreeTransformKey(e: ShortcutKeys): boolean {
  return (e.ctrlKey || e.metaKey) && e.altKey && !e.shiftKey && letterOf(e) === 't';
}

/** The letter key pressed: its character, or for a character that isn't a letter, its position. */
function letterOf(e: Pick<KeyboardEvent, 'key' | 'code'>): string | null {
  const key = e.key.toLowerCase();
  if (/^[a-z]$/.test(key)) return key;
  const position = /^Key([A-Z])$/.exec(e.code);
  return position ? (position[1] ?? '').toLowerCase() : null;
}

/**
 * Ctrl/Cmd+Alt+T starts Free Transform (Edit → Free Transform). The browser's action is
 * suppressed, but text fields are left alone, as are keys the active tool used. Inactive
 * while `gate.blocked`; held keys don't repeat.
 */
export function useTransformShortcuts(
  freeTransform: FreeTransform,
  gate: { readonly blocked: boolean },
): void {
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.defaultPrevented || isTextEntry(e.target) || !isFreeTransformKey(e)) return;
      e.preventDefault();
      if (!e.repeat && !gate.blocked) freeTransform.start('free');
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [freeTransform, gate]);
}
