import { useCallback, useSyncExternalStore } from 'react';
import type { Tool, ToolSession } from './tool';
import type { ToolManager } from './tool-manager';

/** The active tool; re-renders the calling component when it changes. */
export function useActiveTool(tools: ToolManager): Tool {
  const subscribe = useCallback((notify: () => void) => tools.subscribe(notify), [tools]);
  return useSyncExternalStore(subscribe, () => tools.activeTool);
}

/**
 * Whose options the options bar shows: a session that has taken over the input (such as
 * Free Transform), else the active tool. Re-renders the calling component when it changes.
 */
export function useToolOptions(tools: ToolManager): Tool | ToolSession {
  const subscribe = useCallback((notify: () => void) => tools.subscribe(notify), [tools]);
  return useSyncExternalStore(subscribe, () => tools.options);
}
