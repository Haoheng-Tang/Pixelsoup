import { useEffect, useRef } from 'react';
import type { Editor } from '../../core';
import { ViewportController } from './viewport-controller';

interface ViewportProps {
  editor: Editor;
  onReady: (controller: ViewportController | null) => void;
}

/** Mounts the imperative ViewportController; React only manages its lifetime. */
export function Viewport({ editor, onReady }: ViewportProps) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const controller = new ViewportController(container, editor);
    onReady(controller);
    return () => {
      onReady(null);
      controller.dispose();
    };
  }, [editor, onReady]);

  return <div ref={containerRef} className="viewport" />;
}
