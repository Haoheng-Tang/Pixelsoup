import { useEffect } from 'react';
import { isTextEntry } from './dom';
import type { BrushProperty } from './tools/tool';
import type { ToolManager } from './tools/tool-manager';
import type { ShortcutKeys } from './use-layer-shortcuts';
import { bracketOf } from './use-layer-shortcuts';

export interface BrushStep {
  readonly property: BrushProperty;
  readonly direction: -1 | 1;
}

/**
 * The brush step for a key press, if any: [ and ] step the size down and up, and with
 * Shift the hardness. Ctrl, Cmd and Alt brackets belong to the layer shortcuts.
 */
export function brushStepFor(e: ShortcutKeys): BrushStep | null {
  if (e.ctrlKey || e.metaKey || e.altKey) return null;
  const bracket = bracketOf(e);
  if (bracket === null) return null;
  return { property: e.shiftKey ? 'hardness' : 'size', direction: bracket === '[' ? -1 : 1 };
}

/**
 * [ and ] change the active painting tool's brush size, Shift+[ and Shift+] its hardness,
 * wherever the pointer is. They repeat while held, and leave text fields alone. Inactive
 * while `gate.blocked`.
 */
export function useBrushShortcuts(tools: ToolManager, gate: { readonly blocked: boolean }): void {
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (isTextEntry(e.target) || gate.blocked) return;
      const step = brushStepFor(e);
      if (step && tools.stepBrush(step.property, step.direction)) e.preventDefault();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [tools, gate]);
}
