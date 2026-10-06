import { useEffect } from 'react';
import type { Editor } from '../core';
import { isTextEntry } from './dom';
import type { LayerAction } from './layer-actions';
import { runLayerAction } from './layer-actions';

type ShortcutKeys = Pick<
  KeyboardEvent,
  'key' | 'code' | 'ctrlKey' | 'metaKey' | 'altKey' | 'shiftKey'
>;

/** Actions that may repeat while their keys are held down. */
const REPEATABLE: ReadonlySet<LayerAction> = new Set([
  'move-up',
  'move-down',
  'select-above',
  'select-below',
]);

/**
 * The layer action for a key press, if any. Brackets are matched by key position as well as
 * by character, because Option+[ types a quotation mark on a Mac. Ctrl+Alt (AltGr on
 * Windows) never matches, so characters typed with AltGr don't trigger anything.
 */
export function layerActionFor(e: ShortcutKeys): LayerAction | null {
  const bracket = bracketOf(e);
  const mod = e.ctrlKey || e.metaKey;
  if (e.altKey) {
    if (mod || e.shiftKey || bracket === null) return null;
    return bracket === '[' ? 'select-below' : 'select-above';
  }
  if (!mod) return null;
  if (bracket !== null) {
    if (e.shiftKey) return null;
    return bracket === '[' ? 'move-down' : 'move-up';
  }
  switch (e.key.toLowerCase()) {
    case 'n':
      return e.shiftKey ? 'new' : null;
    case 'j':
      return e.shiftKey ? null : 'duplicate';
    case 'e':
      return e.shiftKey ? null : 'merge-down';
    default:
      return null;
  }
}

function bracketOf(e: ShortcutKeys): '[' | ']' | null {
  if (e.code === 'BracketLeft' || e.key === '[') return '[';
  if (e.code === 'BracketRight' || e.key === ']') return ']';
  return null;
}

/**
 * Layer shortcuts: Ctrl/Cmd+Shift+N new layer, +J duplicate, +E merge down, +[ and +] move
 * the active layer down and up; Alt+[ and Alt+] select the layer below and above. They
 * suppress the browser's own action (downloads, search, back/forward) but leave text fields
 * alone. Inactive while `gate.blocked`.
 */
export function useLayerShortcuts(editor: Editor, gate: { readonly blocked: boolean }): void {
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (isTextEntry(e.target)) return;
      const action = layerActionFor(e);
      if (!action) return;
      e.preventDefault();
      if (gate.blocked || (e.repeat && !REPEATABLE.has(action))) return;
      runLayerAction(editor, action);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [editor, gate]);
}
