import type { ReactNode } from 'react';
import type { ToolManager } from '../tools/tool-manager';
import { useActiveTool } from '../tools/use-active-tool';

const ICON_PROPS = {
  width: 16,
  height: 16,
  viewBox: '0 0 16 16',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.2,
  strokeDasharray: '2 1.6',
  'aria-hidden': true,
} as const;

const ICONS: Readonly<Record<string, ReactNode>> = {
  'rect-marquee': (
    <svg {...ICON_PROPS}>
      <rect x="2.5" y="3.5" width="11" height="9" />
    </svg>
  ),
  'ellipse-marquee': (
    <svg {...ICON_PROPS}>
      <ellipse cx="8" cy="8" rx="5.6" ry="4.6" />
    </svg>
  ),
};

/** One button per tool, showing its shortcut key; the active tool is pressed. */
export function ToolPicker({ tools }: { tools: ToolManager }) {
  const active = useActiveTool(tools);
  return (
    <div className="toolbar-group" role="group" aria-label="Tools">
      {tools.tools.map((tool) => (
        <button
          key={tool.id}
          type="button"
          className="tool-button"
          aria-pressed={tool === active}
          aria-label={tool.name}
          title={`${tool.name} (${tool.shortcut})`}
          onClick={() => tools.activate(tool.id)}
        >
          {ICONS[tool.id] ?? tool.name.charAt(0)}
          <span className="tool-key" aria-hidden="true">
            {tool.shortcut}
          </span>
        </button>
      ))}
    </div>
  );
}
