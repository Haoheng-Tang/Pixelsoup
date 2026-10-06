import { useEffect, useRef } from 'react';
import type { ViewportController, ViewportStatus } from './viewport-controller';

const NONE = '–';

export function formatPointer(pointer: ViewportStatus['pointer']): string {
  return pointer ? `${pointer.x}, ${pointer.y}` : NONE;
}

export function formatSize(size: ViewportStatus['selectionSize']): string {
  return size ? `${size.width} × ${size.height}` : NONE;
}

/**
 * Pointer position and selection size readout. Like the zoom indicator, it writes its
 * text nodes directly so pointer moves never re-render React.
 */
export function StatusBar({ viewport }: { viewport: ViewportController | null }) {
  const pointerRef = useRef<HTMLSpanElement>(null);
  const sizeRef = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    if (!viewport) return;
    return viewport.onStatusChange((status) => {
      if (pointerRef.current) pointerRef.current.textContent = formatPointer(status.pointer);
      if (sizeRef.current) sizeRef.current.textContent = formatSize(status.selectionSize);
    });
  }, [viewport]);

  return (
    <footer className="status-bar">
      <span className="status-item" title="Pointer position (document pixels)">
        <span className="status-label">X, Y</span>
        <span ref={pointerRef} className="status-value">
          {NONE}
        </span>
      </span>
      <span className="status-item" title="Selection size (pixels)">
        <span className="status-label">W × H</span>
        <span ref={sizeRef} className="status-value">
          {NONE}
        </span>
      </span>
    </footer>
  );
}
