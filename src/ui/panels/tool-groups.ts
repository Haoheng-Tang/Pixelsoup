import type { ReactNode } from 'react';
import type { Tool, ToolKey } from '../tools/tool';
import { TOOL_KEYS } from '../tools/tool';
import type { ToolGroup, ToolManager } from '../tools/tool-manager';
import type { ContextMenuSections } from './menu-logic';

/** What a toolbar button shows. There's one per shortcut group (see `ToolManager.groups`). */
export interface ToolButtonView {
  /** The tool it shows (icon, name and key) and a click activates: the group's last used. */
  readonly tool: Tool;
  /** One of the group's tools is active. */
  readonly pressed: boolean;
  /** The group has more than one tool, chosen from a flyout. */
  readonly grouped: boolean;
  /** Its tooltip: the tool's name and key, e.g. "Lasso (L)". */
  readonly title: string;
}

export function toolButtonView(tools: ToolManager, group: ToolGroup): ToolButtonView {
  const tool = tools.lastUsed(group);
  return {
    tool,
    pressed: group.tools.includes(tools.activeTool),
    grouped: group.tools.length > 1,
    title: `${tool.name} (${tool.shortcut})`,
  };
}

/** A group's name, after its key's entry in `TOOL_KEYS`: "Marquee tools" for M. */
export function toolGroupLabel(key: ToolKey): string {
  const entry = Object.entries(TOOL_KEYS).find(([, value]) => value === key);
  const name = entry?.[0] ?? key;
  return `${name.charAt(0).toUpperCase()}${name.slice(1)} tools`;
}

/**
 * A group's flyout: its tools with their icons, names and keys, the last used ticked.
 * Choosing one activates it, which makes it the one the group's button and key stand for.
 */
export function toolFlyoutSections(
  tools: ToolManager,
  group: ToolGroup,
  iconFor: (tool: Tool) => ReactNode,
): ContextMenuSections {
  const current = tools.lastUsed(group);
  return [
    group.tools.map((tool) => ({
      command: tool.id,
      label: tool.name,
      icon: iconFor(tool),
      shortcut: tool.shortcut,
      plain: true,
      checked: tool === current,
      radio: true,
      run: () => {
        tools.activate(tool.id);
      },
    })),
  ];
}
