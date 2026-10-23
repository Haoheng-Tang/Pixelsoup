import type { ComponentType } from 'react';
import type { Editor, Layer, Orientation } from '../../core';
import { assertNever, liftSelectionCommand, orientLayerCommand, rasterBounds } from '../../core';
import type { ToolManager } from '../tools/tool-manager';
import type { TransformMode } from './transform-math';
import { TransformOptions } from './transform-options';
import type { TransformSource } from './transform-session';
import { TransformSession } from './transform-session';

export interface FreeTransformInit {
  /** The settings sessions share; kept for the app session. */
  readonly options?: TransformOptions;
  /** Makes the options-bar panel sessions show, given the controller. */
  readonly panel?: (freeTransform: FreeTransform) => ComponentType;
}

/**
 * Starts Free Transform (Edit → Free Transform, Ctrl/Cmd+Alt+T, or the canvas's context
 * menu) and Edit → Transform → Scale, Rotate, Skew, Distort and Perspective on the active
 * layer, and tracks the session they run. One session at a time: starting another while
 * one runs just switches its mode. Edit → Transform's turns and flips come here too
 * (`orient`).
 */
export class FreeTransform {
  readonly options: TransformOptions;
  private readonly OptionsPanel: ComponentType | undefined;
  private current: TransformSession | null = null;
  private readonly listeners = new Set<() => void>();

  constructor(
    private readonly editor: Editor,
    private readonly tools: ToolManager,
    init: FreeTransformInit = {},
  ) {
    this.options = init.options ?? new TransformOptions();
    this.OptionsPanel = init.panel?.(this);
  }

  /** The session running now, if any. */
  get session(): TransformSession | null {
    return this.current;
  }

  /** Whether `start` could do anything: a session runs, or there's an active layer. */
  canStart(): boolean {
    return this.current !== null || this.editor.activeLayer !== null;
  }

  /**
   * Starts a session in `mode` on the active layer, or switches the running one to it.
   * With a selection, the selected pixels are lifted into a floating selection first, as
   * the Move tool lifts them, and that's transformed; a floating selection is transformed
   * as it is, outline and all. Shows why in the status bar, and returns false, if the
   * layer is hidden or the selection misses it.
   */
  start(mode: TransformMode = 'free'): boolean {
    const running = this.current;
    if (running) {
      running.setMode(mode);
      return true;
    }
    const { editor, tools } = this;
    if (tools.isPointerDown || tools.session) return false;
    const layer = editor.activeLayer;
    if (!layer) return false;
    if (!layer.visible) {
      tools.showMessage('The active layer is hidden');
      return false;
    }
    let liftState: number | null = null;
    const doc = editor.document;
    if (doc.selection && !editor.floating) {
      const lift = liftSelectionCommand(doc, layer.id, false);
      if (!lift) {
        tools.showMessage('The selection misses the active layer');
        return false;
      }
      editor.history.execute(lift);
      liftState = editor.history.stateId;
    }
    // After a lift, the floating selection's layer is the active one.
    const target = editor.activeLayer;
    if (!target) return false;
    const session: TransformSession = new TransformSession({
      editor,
      tools,
      options: this.options,
      source: sourceOf(target),
      mode,
      liftState,
      OptionsPanel: this.OptionsPanel,
      onEnd: () => {
        if (this.current !== session) return;
        this.current = null;
        this.notify();
      },
    });
    editor.beginPending(session.edit);
    if (!tools.startSession(session)) {
      editor.endPending(session.edit);
      if (liftState !== null && editor.history.stateId === liftState) editor.history.undo();
      return false;
    }
    if (session.active) {
      this.current = session;
      this.notify();
    }
    return true;
  }

  /**
   * Edit → Transform's turns and flips: composed into the running session, or else applied
   * to the active layer straight away, losslessly, as one undo step (a floating selection
   * turns with its outline). Shows why in the status bar, and returns false, if the layer
   * is hidden.
   */
  orient(orientation: Orientation): boolean {
    const running = this.current;
    if (running) {
      running.orient(orientation);
      return true;
    }
    const { editor, tools } = this;
    const layer = editor.activeLayer;
    if (!layer) return false;
    if (!layer.visible) {
      tools.showMessage('The active layer is hidden');
      return false;
    }
    const floating = editor.floating?.layerId === layer.id ? editor.floating : null;
    const command = orientLayerCommand(editor.document, layer.id, orientation, floating);
    if (!command) return false;
    editor.history.execute(command);
    return true;
  }

  /** Calls `listener` when a session starts or ends. */
  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private notify(): void {
    for (const listener of [...this.listeners]) listener();
  }
}

function sourceOf(layer: Layer): TransformSource {
  switch (layer.kind) {
    case 'raster':
      return {
        layerId: layer.id,
        pixels: layer.pixels,
        rect: rasterBounds(layer),
        opacity: layer.opacity,
      };
    default:
      return assertNever(layer.kind);
  }
}
