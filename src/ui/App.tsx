import { useState } from 'react';
import type { Editor } from '../core';
import { LayerPanel } from './panels/LayerPanel';
import { Toolbar } from './panels/Toolbar';
import { useHistoryShortcuts } from './use-history-shortcuts';
import { Viewport } from './viewport/Viewport';
import type { ViewportController } from './viewport/viewport-controller';

export function App({ editor }: { editor: Editor }) {
  const [viewport, setViewport] = useState<ViewportController | null>(null);
  useHistoryShortcuts(editor);

  return (
    <div className="app">
      <Toolbar editor={editor} viewport={viewport} />
      <main className="workspace">
        <Viewport editor={editor} onReady={setViewport} />
        <aside className="sidebar">
          <LayerPanel editor={editor} />
        </aside>
      </main>
    </div>
  );
}
