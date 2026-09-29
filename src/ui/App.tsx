import { useState } from 'react';
import type { Editor } from '../core';
import { Toolbar } from './panels/Toolbar';
import { Viewport } from './viewport/Viewport';
import type { ViewportController } from './viewport/viewport-controller';

export function App({ editor }: { editor: Editor }) {
  const [viewport, setViewport] = useState<ViewportController | null>(null);

  return (
    <div className="app">
      <Toolbar viewport={viewport} />
      <main className="workspace">
        <Viewport editor={editor} onReady={setViewport} />
      </main>
    </div>
  );
}
