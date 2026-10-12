import type { Editor } from '../../core';
import { ColorSwatches } from '../color/ColorSwatches';
import type { Colors } from '../color/colors';
import type { AppController } from '../session/app-controller';
import type { ToolManager } from '../tools/tool-manager';
import { useRevision } from '../use-revision';
import { useEditorRevision } from '../use-editor-revision';
import type { ViewportController } from '../viewport/viewport-controller';
import { ZoomIndicator } from '../viewport/ZoomIndicator';
import { EditMenu } from './EditMenu';
import { FileMenu } from './FileMenu';
import { ImageMenu } from './ImageMenu';
import { LayerMenu } from './LayerMenu';
import { SelectMenu } from './SelectMenu';
import { ToolPicker } from './ToolPicker';

interface ToolbarProps {
  editor: Editor;
  controller: AppController;
  tools: ToolManager;
  colors: Colors;
  viewport: ViewportController | null;
}

export function Toolbar({ editor, controller, tools, colors, viewport }: ToolbarProps) {
  useEditorRevision(editor);
  useRevision(controller);
  useRevision(controller.session);
  const { history } = editor;
  const { session, blocked } = controller;
  const noViewport = viewport === null;

  return (
    <header className="toolbar">
      <span className="app-title">Pixelsoup</span>
      <FileMenu controller={controller} />
      <EditMenu editor={editor} controller={controller} blocked={blocked} />
      <SelectMenu editor={editor} blocked={blocked} />
      <ImageMenu editor={editor} controller={controller} blocked={blocked} />
      <LayerMenu editor={editor} blocked={blocked} />
      <ToolPicker tools={tools} />
      <ColorSwatches colors={colors} />
      <div className="toolbar-group" role="group" aria-label="History">
        <button
          type="button"
          disabled={blocked || !history.canUndo}
          onClick={() => history.undo()}
          title={history.undoLabel ? `Undo ${history.undoLabel} (Ctrl+Z)` : 'Undo (Ctrl+Z)'}
        >
          Undo
        </button>
        <button
          type="button"
          disabled={blocked || !history.canRedo}
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
      <div className="document-name" title={session.name}>
        <span className="document-name-text">{session.name}</span>
        {session.isDirty && (
          <span
            className="dirty-marker"
            role="img"
            aria-label="Unsaved changes"
            title="Unsaved changes"
          >
            ●
          </span>
        )}
      </div>
    </header>
  );
}
