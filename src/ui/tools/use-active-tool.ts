import { useCallback, useSyncExternalStore } from 'react';
import type { Tool } from './tool';
import type { ToolManager } from './tool-manager';

/** The active tool; re-renders the calling component when it changes. */
export function useActiveTool(tools: ToolManager): Tool {
  const subscribe = useCallback((notify: () => void) => tools.subscribe(notify), [tools]);
  return useSyncExternalStore(subscribe, () => tools.activeTool);
}
