import { useEffect, useRef } from 'react';
import type { ToolManager } from '../tools/tool-manager';
import type { ViewportController, ViewportStatus } from './viewport-controller';

const NONE = '–';
/** How long a tool's message stays in the status bar, in milliseconds. */
const MESSAGE_MS = 1500;

export function formatPointer(pointer: ViewportStatus['pointer']): string {
  return pointer ? `${pointer.x}, ${pointer.y}` : NONE;
}

export function formatSize(size: ViewportStatus['selectionSize']): string {
  return size ? `${size.width} × ${size.height}` : NONE;
}

interface StatusBarProps {
  viewport: ViewportController | null;
  tools: ToolManager;
}

/**
 * Pointer position and selection size readout, plus brief messages from tools (such as a
 * brush size changed from the keyboard). Like the zoom indicator, it writes its text nodes
 * directly so pointer moves never re-render React.
 */
export function StatusBar({ viewport, tools }: StatusBarProps) {
  const pointerRef = useRef<HTMLSpanElement>(null);
  const sizeRef = useRef<HTMLSpanElement>(null);
  const messageRef = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    if (!viewport) return;
    return viewport.onStatusChange((status) => {
      if (pointerRef.current) pointerRef.current.textContent = formatPointer(status.pointer);
      if (sizeRef.current) sizeRef.current.textContent = formatSize(status.selectionSize);
    });
  }, [viewport]);

  useEffect(() => {
    let timer: number | undefined;
    const unsubscribe = tools.subscribeMessages((text) => {
      const message = messageRef.current;
      if (!message) return;
      message.textContent = text;
      window.clearTimeout(timer);
      timer = window.setTimeout(() => (message.textContent = ''), MESSAGE_MS);
    });
    return () => {
      unsubscribe();
      window.clearTimeout(timer);
    };
  }, [tools]);

  return (
    <footer className="status-bar">
      <span className="status-item" title="Pointer position (document pixels)">
        <span className="status-label">X, Y</span>
        <span ref={pointerRef} className="status-value">
          {NONE}
        </span>
      </span>
      <span className="status-item" title="Selection or crop size (pixels)">
        <span className="status-label">W × H</span>
        <span ref={sizeRef} className="status-value">
          {NONE}
        </span>
      </span>
      <span ref={messageRef} className="status-message" role="status" />
    </footer>
  );
}
