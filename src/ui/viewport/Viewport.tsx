import { useEffect, useRef } from 'react';
import type { Editor } from '../../core';
import type { ToolManager } from '../tools/tool-manager';
import type { KeyGate } from './viewport-controller';
import { ViewportController } from './viewport-controller';

interface ViewportProps {
  editor: Editor;
  tools: ToolManager;
  /** Keys are left alone while it's blocked (a dialog is open). */
  gate: KeyGate;
  onReady: (controller: ViewportController | null) => void;
}

/** Mounts the imperative ViewportController; React only manages its lifetime. */
export function Viewport({ editor, tools, gate, onReady }: ViewportProps) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const controller = new ViewportController(container, editor, tools, gate);
    onReady(controller);
    return () => {
      onReady(null);
      controller.dispose();
    };
  }, [editor, tools, gate, onReady]);

  return <div ref={containerRef} className="viewport" />;
}
