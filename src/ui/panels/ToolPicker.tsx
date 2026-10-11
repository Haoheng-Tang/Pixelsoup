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
  move: (
    <svg {...ICON_PROPS} strokeDasharray="none" strokeLinecap="round" strokeLinejoin="round">
      <path d="M8 1.5v13M1.5 8h13M6 3.5l2-2 2 2M6 12.5l2 2 2-2M3.5 6l-2 2 2 2M12.5 6l2 2-2 2" />
    </svg>
  ),
  brush: (
    <svg {...ICON_PROPS} strokeDasharray="none" strokeLinecap="round" strokeLinejoin="round">
      <path d="M14 2 10 6M8.6 5.6l1.8 1.8-2 2-1.8-1.8zM6.6 7.6c-2 .2-2.6 1.6-2.9 3.1-.2 1.2-.7 2.3-1.7 3.3 1.9.2 4.2-.3 5.3-1.6.9-1.1 1.1-2.2 1.1-3.1" />
    </svg>
  ),
  eraser: (
    <svg {...ICON_PROPS} strokeDasharray="none" strokeLinecap="round" strokeLinejoin="round">
      <path d="M2.2 10.2 10.2 2.2l3.6 3.6-8 8zM5.4 7l3.6 3.6M5.8 13.8H14" />
    </svg>
  ),
  eyedropper: (
    <svg {...ICON_PROPS} strokeDasharray="none" strokeLinecap="round" strokeLinejoin="round">
      <path d="M8.5 6.5 3 12l-1 2 2-1 5.5-5.5M7 5l4 4M10 6l2.3-2.3a1.6 1.6 0 0 1 2.3 2.3L12.3 8.3" />
    </svg>
  ),
  crop: (
    <svg {...ICON_PROPS} strokeDasharray="none" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4.5 1.5v10h10M1.5 4.5h10v10" />
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
