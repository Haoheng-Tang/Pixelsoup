import type { Editor } from '../../core';
import { useEditorRevision } from '../use-editor-revision';
import type { ViewportController } from '../viewport/viewport-controller';
import { ZoomIndicator } from '../viewport/ZoomIndicator';

interface ToolbarProps {
  editor: Editor;
  viewport: ViewportController | null;
}

export function Toolbar({ editor, viewport }: ToolbarProps) {
  useEditorRevision(editor);
  const { history } = editor;
  const noViewport = viewport === null;

  return (
    <header className="toolbar">
      <span className="app-title">Pixelsoup</span>
      <div className="toolbar-group" role="group" aria-label="History">
        <button
          type="button"
          disabled={!history.canUndo}
          onClick={() => history.undo()}
          title={history.undoLabel ? `Undo ${history.undoLabel} (Ctrl+Z)` : 'Undo (Ctrl+Z)'}
        >
          Undo
        </button>
        <button
          type="button"
          disabled={!history.canRedo}
          onClick={() => history.redo()}
          title={history.redoLabel ? `Redo ${history.redoLabel} (Ctrl+Y)` : 'Redo (Ctrl+Y)'}
        >
          Redo
        </button>
      </div>
      <div className="toolbar-group" role="group" aria-label="Zoom">
        <button
          type="button"
          disabled={noViewport}
          onClick={() => viewport?.zoomOut()}
          title="Zoom out"
          aria-label="Zoom out"
        >
          −
        </button>
        <ZoomIndicator viewport={viewport} />
        <button
          type="button"
          disabled={noViewport}
          onClick={() => viewport?.zoomIn()}
          title="Zoom in"
          aria-label="Zoom in"
        >
          +
        </button>
        <button type="button" disabled={noViewport} onClick={() => viewport?.fitToView()}>
          Fit
        </button>
        <button type="button" disabled={noViewport} onClick={() => viewport?.actualSize()}>
          100%
        </button>
      </div>
    </header>
  );
}
