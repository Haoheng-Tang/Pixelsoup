import type { ViewportController } from '../viewport/viewport-controller';
import { ZoomIndicator } from '../viewport/ZoomIndicator';

interface ToolbarProps {
  viewport: ViewportController | null;
}

export function Toolbar({ viewport }: ToolbarProps) {
  const disabled = viewport === null;
  return (
    <header className="toolbar">
      <span className="app-title">Pixelsoup</span>
      <div className="toolbar-group" role="group" aria-label="Zoom">
        <button
          type="button"
          disabled={disabled}
          onClick={() => viewport?.zoomOut()}
          title="Zoom out"
        >
          −
        </button>
        <ZoomIndicator viewport={viewport} />
        <button
          type="button"
          disabled={disabled}
          onClick={() => viewport?.zoomIn()}
          title="Zoom in"
        >
          +
        </button>
        <button type="button" disabled={disabled} onClick={() => viewport?.fitToView()}>
          Fit
        </button>
        <button type="button" disabled={disabled} onClick={() => viewport?.actualSize()}>
          100%
        </button>
      </div>
    </header>
  );
}
