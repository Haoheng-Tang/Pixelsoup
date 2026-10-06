import { useState } from 'react';
import type { Editor } from '../core';
import { ModalHost } from './dialogs/ModalHost';
import { LayerPanel } from './panels/LayerPanel';
import { Toolbar } from './panels/Toolbar';
import type { AppController } from './session/app-controller';
import { useDocumentWindow } from './use-document-window';
import { useFileShortcuts } from './use-file-shortcuts';
import { useHistoryShortcuts } from './use-history-shortcuts';
import { useRevision } from './use-revision';
import { Viewport } from './viewport/Viewport';
import type { ViewportController } from './viewport/viewport-controller';

interface AppProps {
  editor: Editor;
  controller: AppController;
}

export function App({ editor, controller }: AppProps) {
  const [viewport, setViewport] = useState<ViewportController | null>(null);
  useRevision(controller);
  useHistoryShortcuts(editor, controller);
  useFileShortcuts(controller);
  useDocumentWindow(controller.session);

  return (
    <div className={controller.busy ? 'app busy' : 'app'} aria-busy={controller.busy}>
      <Toolbar editor={editor} controller={controller} viewport={viewport} />
      <main className="workspace">
        <Viewport editor={editor} onReady={setViewport} />
        <aside className="sidebar">
          <LayerPanel editor={editor} />
        </aside>
      </main>
      <ModalHost controller={controller} />
    </div>
  );
}
