import { useState } from 'react';
import type { Editor } from '../core';
import type { Colors } from './color/colors';
import { ModalHost } from './dialogs/ModalHost';
import { LayerPanel } from './panels/LayerPanel';
import { ToolOptionsBar } from './panels/ToolOptionsBar';
import { Toolbar } from './panels/Toolbar';
import type { AppController } from './session/app-controller';
import type { ToolManager } from './tools/tool-manager';
import { useBrushShortcuts } from './use-brush-shortcuts';
import { useColorShortcuts } from './use-color-shortcuts';
import { useDocumentWindow } from './use-document-window';
import { useFileShortcuts } from './use-file-shortcuts';
import { useHistoryShortcuts } from './use-history-shortcuts';
import { useLayerShortcuts } from './use-layer-shortcuts';
import { useRevision } from './use-revision';
import { useSelectionShortcuts } from './use-selection-shortcuts';
import { useToolShortcuts } from './use-tool-shortcuts';
import { StatusBar } from './viewport/StatusBar';
import { Viewport } from './viewport/Viewport';
import type { ViewportController } from './viewport/viewport-controller';

interface AppProps {
  editor: Editor;
  controller: AppController;
  tools: ToolManager;
  colors: Colors;
}

export function App({ editor, controller, tools, colors }: AppProps) {
  const [viewport, setViewport] = useState<ViewportController | null>(null);
  useRevision(controller);
  useHistoryShortcuts(editor, controller);
  useSelectionShortcuts(editor, controller);
  useLayerShortcuts(editor, controller);
  useToolShortcuts(tools, controller);
  useColorShortcuts(colors, controller);
  useBrushShortcuts(tools, controller);
  useFileShortcuts(controller);
  useDocumentWindow(controller.session);

  return (
    <div className={controller.busy ? 'app busy' : 'app'} aria-busy={controller.busy}>
      <Toolbar
        editor={editor}
        controller={controller}
        tools={tools}
        colors={colors}
        viewport={viewport}
      />
      <ToolOptionsBar tools={tools} />
      <main className="workspace">
        <Viewport editor={editor} tools={tools} gate={controller} onReady={setViewport} />
        <aside className="sidebar">
          <LayerPanel editor={editor} blocked={controller.blocked} />
        </aside>
      </main>
      <StatusBar viewport={viewport} tools={tools} />
      <ModalHost controller={controller} />
    </div>
  );
}
