import { useEffect } from 'react';
import type { Editor } from '../../core';
import { canvasMenuSections } from '../canvas-menu';
import type { AppController } from '../session/app-controller';
import type { ToolManager } from '../tools/tool-manager';
import type { FreeTransform } from '../transform/free-transform';
import { useEditorRevision } from '../use-editor-revision';
import { useRevision } from '../use-revision';
import type { ViewportController } from '../viewport/viewport-controller';
import { ContextMenu } from './ContextMenu';

interface CanvasMenuProps {
  /** Where it opened, in client coordinates. */
  at: { readonly x: number; readonly y: number };
  editor: Editor;
  controller: AppController;
  tools: ToolManager;
  freeTransform: FreeTransform;
  viewport: ViewportController;
  onClose: () => void;
}

/**
 * The canvas's context menu (see `canvasMenuSections`), rebuilt as the document and the
 * app change. It closes when the view zooms, the document is replaced or resized, or a
 * dialog opens. A press on the canvas outside it only closes it.
 */
export function CanvasMenu({
  at,
  editor,
  controller,
  tools,
  freeTransform,
  viewport,
  onClose,
}: CanvasMenuProps) {
  useEditorRevision(editor);
  useRevision(controller);

  useEffect(() => {
    let first = true;
    const stopZoom = viewport.onZoomChange(() => {
      // Called straight away with the current zoom.
      if (!first) onClose();
      first = false;
    });
    const stopEditor = editor.subscribe((change) => {
      if (change.documentReplaced || change.resized) onClose();
    });
    return () => {
      stopZoom();
      stopEditor();
    };
  }, [viewport, editor, onClose]);

  const blocked = controller.blocked;
  useEffect(() => {
    if (blocked) onClose();
  }, [blocked, onClose]);

  return (
    <ContextMenu
      x={at.x}
      y={at.y}
      label="Canvas"
      sections={canvasMenuSections(editor, controller, freeTransform, tools.contextMenu(), {
        exclusive: tools.session !== null,
      })}
      onClose={onClose}
      swallowsPress={(target) => viewport.contains(target)}
    />
  );
}
