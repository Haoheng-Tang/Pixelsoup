import { useCallback, useEffect, useState } from 'react';
import type { Editor, Rect } from '../core';
import type { PixelClipboard } from './clipboard/pixel-clipboard';
import { useClipboardShortcuts } from './clipboard/use-clipboard-shortcuts';
import type { Colors } from './color/colors';
import { ModalHost } from './dialogs/ModalHost';
import { CanvasMenu } from './panels/CanvasMenu';
import { LayerPanel } from './panels/LayerPanel';
import { ToolOptionsBar } from './panels/ToolOptionsBar';
import { Toolbar } from './panels/Toolbar';
import type { AppController } from './session/app-controller';
import type { ToolManager } from './tools/tool-manager';
import type { FreeTransform } from './transform/free-transform';
import { useBrushShortcuts } from './use-brush-shortcuts';
import { useColorShortcuts } from './use-color-shortcuts';
import { useDocumentWindow } from './use-document-window';
import { useEditShortcuts } from './use-edit-shortcuts';
import { useFileDrop } from './use-file-drop';
import { useFileShortcuts } from './use-file-shortcuts';
import { useHistoryShortcuts } from './use-history-shortcuts';
import { useLayerShortcuts } from './use-layer-shortcuts';
import { useRevision } from './use-revision';
import { useSelectionShortcuts } from './use-selection-shortcuts';
import { useToolShortcuts } from './use-tool-shortcuts';
import { useTransformShortcuts } from './use-transform-shortcuts';
import { useViewShortcuts } from './use-view-shortcuts';
import { StatusBar } from './viewport/StatusBar';
import { Viewport } from './viewport/Viewport';
import type { ViewportController } from './viewport/viewport-controller';
import type { ViewOptions } from './viewport/view-options';

interface AppProps {
  editor: Editor;
  controller: AppController;
  clipboard: PixelClipboard;
  tools: ToolManager;
  freeTransform: FreeTransform;
  colors: Colors;
  view: ViewOptions;
}

export function App(props: AppProps) {
  const { editor, controller, clipboard, tools, freeTransform, colors, view } = props;
  const [viewport, setViewport] = useState<ViewportController | null>(null);
  const viewArea = useCallback((): Rect | null => viewport?.visibleArea() ?? null, [viewport]);
  const [menuAt, setMenuAt] = useState<{ x: number; y: number } | null>(null);
  useEffect(() => viewport?.onContextMenu(setMenuAt), [viewport]);
  const closeMenu = useCallback(() => {
    setMenuAt(null);
    viewport?.focus();
  }, [viewport]);
  useRevision(controller);
  useHistoryShortcuts(editor, controller);
  useEditShortcuts(editor, colors, controller);
  useClipboardShortcuts(clipboard, controller, viewArea);
  useSelectionShortcuts(editor, controller);
  useLayerShortcuts(editor, controller);
  useViewShortcuts(view, controller);
  useToolShortcuts(tools, controller);
  useTransformShortcuts(freeTransform, controller);
  useColorShortcuts(colors, controller);
  useBrushShortcuts(tools, controller);
  useFileShortcuts(controller);
  const dropping = useFileDrop(controller);
  useDocumentWindow(controller.session);

  return (
    <div className={controller.busy ? 'app busy' : 'app'} aria-busy={controller.busy}>
      <Toolbar
        editor={editor}
        controller={controller}
        tools={tools}
        freeTransform={freeTransform}
        colors={colors}
        view={view}
        viewport={viewport}
        clipboard={clipboard}
        viewArea={viewArea}
      />
      <ToolOptionsBar tools={tools} />
      <main className="workspace">
        <Viewport
          editor={editor}
          tools={tools}
          view={view}
          gate={controller}
          onReady={setViewport}
        />
        <aside className="sidebar">
          <LayerPanel editor={editor} blocked={controller.blocked} />
        </aside>
      </main>
      <StatusBar viewport={viewport} tools={tools} />
      {menuAt && viewport && (
        <CanvasMenu
          at={menuAt}
          editor={editor}
          controller={controller}
          tools={tools}
          freeTransform={freeTransform}
          viewport={viewport}
          onClose={closeMenu}
        />
      )}
      <ModalHost controller={controller} colors={colors} />
      {dropping && (
        <div className="drop-hint" aria-hidden="true">
          <div className="drop-hint-label">Drop to open</div>
        </div>
      )}
    </div>
  );
}
