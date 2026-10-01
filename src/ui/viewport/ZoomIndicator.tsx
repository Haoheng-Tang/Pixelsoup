import { useEffect, useRef } from 'react';
import type { ViewportController } from './viewport-controller';

export function formatZoom(zoom: number): string {
  const percent = zoom * 100;
  return `${percent < 10 ? percent.toFixed(1) : Math.round(percent)}%`;
}

/** Shows the current zoom. Updates its text node directly so zooming never re-renders React. */
export function ZoomIndicator({ viewport }: { viewport: ViewportController | null }) {
  const ref = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    if (!viewport) return;
    return viewport.onZoomChange((zoom) => {
      if (ref.current) ref.current.textContent = formatZoom(zoom);
    });
  }, [viewport]);

  return (
    <span ref={ref} className="zoom-indicator" aria-live="polite" title="Zoom">
      –
    </span>
  );
}
