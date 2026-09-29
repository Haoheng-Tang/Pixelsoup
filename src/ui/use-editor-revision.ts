import { useCallback, useSyncExternalStore } from 'react';
import type { Editor } from '../core';

/**
 * Re-renders the calling component whenever the editor reports a change and returns
 * the current revision. For panels only — the canvas viewport subscribes directly.
 */
export function useEditorRevision(editor: Editor): number {
  const subscribe = useCallback((notify: () => void) => editor.subscribe(notify), [editor]);
  return useSyncExternalStore(subscribe, () => editor.revision);
}
