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

/**
 * The name the options bar shows, following a session that switches between Free
 * Transform, Scale and Rotate as well.
 */
export function useToolOptionsName(tools: ToolManager): string {
  const subscribe = useCallback(
    (notify: () => void) => {
      const unsubscribeTools = tools.subscribe(notify);
      const unsubscribeOverlay = tools.subscribeOverlay(notify);
      return () => {
        unsubscribeTools();
        unsubscribeOverlay();
      };
    },
    [tools],
  );
  return useSyncExternalStore(subscribe, () => tools.options.name);
}
