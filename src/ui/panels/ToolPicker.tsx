import type { MouseEvent as ReactMouseEvent, ReactNode } from 'react';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { Tool } from '../tools/tool';
import type { ToolGroup, ToolManager } from '../tools/tool-manager';
import { useActiveTool } from '../tools/use-active-tool';
import { ContextMenu } from './ContextMenu';
import { toolButtonView, toolFlyoutSections, toolGroupLabel } from './tool-groups';

/** How long a press on a grouped tool's button is held to open its flyout, in ms. */
const LONG_PRESS_MS = 400;

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
  lasso: (
    <svg {...ICON_PROPS} strokeLinecap="round">
      <path d="M4.2 10.4C2 9.4 1.6 6.6 3.6 4.8s6.6-2.4 9-.8 1 5.6-3 6.2c-1.6.3-3.2.2-4.6-.3" />
      <path d="M4.6 10.2c-1 1-.8 2.4.4 2.9s.8 1.6-.2 2.1" strokeDasharray="none" />
    </svg>
  ),
  'polygon-lasso': (
    <svg {...ICON_PROPS} strokeLinejoin="round">
      <path d="M2.5 12.5 3.8 3.5l5 2.6 4.7-3.1-1.2 9.2-4.6-2.4z" />
    </svg>
  ),
  'magic-wand': (
    <svg {...ICON_PROPS} strokeDasharray="none" strokeLinecap="round">
      <path d="M7.2 7.2 14.5 14.5M4.5 1.5v6M1.5 4.5h6M10.5 2.5v2M9.5 3.5h2M3.5 9.5v2M2.5 10.5h2" />
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
  'paint-bucket': (
    <svg {...ICON_PROPS} strokeDasharray="none" strokeLinecap="round" strokeLinejoin="round">
      <path d="M5 7.5 9.5 3l5 5L10 12.5zM5 7.5h8.5M5 7.5c-1.2 0-2 .6-2.2 1.6M2.8 10.4c-.8 1.2-1.2 2.1-1.2 2.7a1.2 1.2 0 0 0 2.4 0c0-.6-.4-1.5-1.2-2.7z" />
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

function iconFor(tool: Tool): ReactNode {
  return ICONS[tool.id] ?? tool.name.charAt(0);
}

/**
 * One button per shortcut group (`ToolManager.groups`), showing its last-used tool's icon
 * and key; the active tool's button is pressed. Buttons for groups of several tools have a
 * corner triangle and a flyout to choose among them.
 */
export function ToolPicker({ tools }: { tools: ToolManager }) {
  // Activating a tool is what changes a group's last-used one.
  useActiveTool(tools);
  return (
    <div className="toolbar-group" role="group" aria-label="Tools">
      {tools.groups.map((group) => (
        <ToolButton key={group.key} tools={tools} group={group} />
      ))}
    </div>
  );
}

/**
 * A group's button. A click activates the tool it shows. On a grouped button, a right-click,
 * a press held for `LONG_PRESS_MS`, a click on the corner triangle, Arrow Down or the
 * context menu key open the flyout below it.
 */
function ToolButton({ tools, group }: { tools: ToolManager; group: ToolGroup }) {
  const view = toolButtonView(tools, group);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const [flyoutAt, setFlyoutAt] = useState<{ x: number; y: number } | null>(null);
  /** The click ending this press does nothing: the press opened or closed the flyout. */
  const ignoreClick = useRef(false);

  const openFlyout = useCallback(() => {
    const rect = buttonRef.current?.getBoundingClientRect();
    if (rect) setFlyoutAt({ x: rect.left, y: rect.bottom + 4 });
  }, []);
  const closeFlyout = useCallback(() => {
    setFlyoutAt(null);
    buttonRef.current?.focus();
  }, []);
  const hold = useLongPress(() => {
    ignoreClick.current = true;
    openFlyout();
  });

  const onClick = (e: ReactMouseEvent) => {
    // A keyboard click (detail 0) always counts.
    if (e.detail > 0 && ignoreClick.current) {
      ignoreClick.current = false;
      return;
    }
    if (view.grouped && e.target instanceof Element && e.target.closest('.tool-group-mark')) {
      openFlyout();
      return;
    }
    tools.activate(view.tool.id);
  };

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        className="tool-button"
        aria-pressed={view.pressed}
        aria-label={view.tool.name}
        aria-haspopup={view.grouped ? 'menu' : undefined}
        aria-expanded={view.grouped ? flyoutAt !== null : undefined}
        title={view.title}
        onClick={onClick}
        onPointerDown={(e) => {
          ignoreClick.current = false;
          if (view.grouped && e.button === 0) hold.start();
        }}
        onPointerUp={hold.cancel}
        onPointerLeave={hold.cancel}
        onPointerCancel={hold.cancel}
        onContextMenu={(e) => {
          if (!view.grouped) return;
          e.preventDefault();
          hold.cancel();
          // A Control-click on a Mac may still click.
          ignoreClick.current = true;
          openFlyout();
        }}
        onKeyDown={(e) => {
          if (!view.grouped || e.key !== 'ArrowDown') return;
          if (e.shiftKey || e.altKey || e.ctrlKey || e.metaKey) return;
          e.preventDefault();
          openFlyout();
        }}
      >
        {iconFor(view.tool)}
        <span className="tool-key" aria-hidden="true">
          {view.tool.shortcut}
        </span>
        {view.grouped && <span className="tool-group-mark" aria-hidden="true" />}
      </button>
      {flyoutAt && (
        <ContextMenu
          x={flyoutAt.x}
          y={flyoutAt.y}
          label={toolGroupLabel(group.key)}
          sections={toolFlyoutSections(tools, group, iconFor)}
          onClose={closeFlyout}
          // A press on the button while its flyout is open only closes the flyout.
          swallowsPress={(target) => {
            const onButton = target instanceof Node && !!buttonRef.current?.contains(target);
            if (onButton) ignoreClick.current = true;
            return onButton;
          }}
        />
      )}
    </>
  );
}

/** Calls `onLongPress` once a press has been held for `LONG_PRESS_MS`, unless cancelled. */
function useLongPress(onLongPress: () => void): { start: () => void; cancel: () => void } {
  const timer = useRef<number | undefined>(undefined);
  const callback = useRef(onLongPress);
  useEffect(() => {
    callback.current = onLongPress;
  });
  const cancel = useCallback(() => {
    window.clearTimeout(timer.current);
    timer.current = undefined;
  }, []);
  const start = useCallback(() => {
    cancel();
    timer.current = window.setTimeout(() => {
      timer.current = undefined;
      callback.current();
    }, LONG_PRESS_MS);
  }, [cancel]);
  useEffect(() => cancel, [cancel]);
  return { start, cancel };
}
