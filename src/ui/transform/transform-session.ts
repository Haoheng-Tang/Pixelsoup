import type { ComponentType } from 'react';
import type {
  Affine,
  Editor,
  EditorChange,
  LayerId,
  Orientation,
  PendingEdit,
  PixelBuffer,
  Point,
  Projective,
  Rect,
} from '../../core';
import {
  MAX_IMAGE_SIZE,
  ORIENTATION_LABELS,
  findLayer,
  mapCorners,
  mapPoint,
  mappedBounds,
  transformLayerCommand,
} from '../../core';
import type { ContextMenuItem, ContextMenuSections } from '../panels/menu-logic';
import { nudgeOffset } from '../tools/nudge';
import type {
  ToolContext,
  ToolKeyEvent,
  ToolPointerEvent,
  ToolSession,
  TransformOverlay,
} from '../tools/tool';
import { CLICK_TOLERANCE } from '../tools/tool';
import type { ToolManager } from '../tools/tool-manager';
import type {
  TransformField,
  TransformHit,
  TransformMode,
  TransformParams,
  TransformState,
} from './transform-math';
import {
  hitTransform,
  identityState,
  isIdentity,
  moveState,
  orientState,
  rotateState,
  sameState,
  scaleState,
  sourceCentre,
  stateMatrix,
  stateParams,
  transformCursor,
  translateState,
  withField,
} from './transform-math';
import type { TransformOptions } from './transform-options';

/** What a session transforms: its layer's pixels and placement as they were when it began. */
export interface TransformSource {
  readonly layerId: LayerId;
  readonly pixels: PixelBuffer;
  /** Where the pixels are on the canvas: the layer's bounds. */
  readonly rect: Rect;
  readonly opacity: number;
}

/** The session's name, its undo label, by what started it. */
const MODE_NAMES: Readonly<Record<TransformMode, string>> = {
  free: 'Free Transform',
  scale: 'Scale',
  rotate: 'Rotate',
};

export interface TransformSessionInit {
  readonly editor: Editor;
  readonly tools: ToolManager;
  readonly options: TransformOptions;
  readonly source: TransformSource;
  readonly mode: TransformMode;
  /**
   * The history state just after the lift the session began with, when it lifted the
   * selected pixels itself: cancelling undoes it, as does applying no change.
   */
  readonly liftState: number | null;
  readonly OptionsPanel?: ComponentType | undefined;
  /** Called once when the session ends, however it ends. */
  readonly onEnd?: () => void;
}

interface TransformDrag {
  readonly hit: TransformHit;
  readonly press: Point;
  readonly start: TransformState;
  point: Point;
  shiftKey: boolean;
  altKey: boolean;
  zoom: number;
  /** Past the click tolerance: the box follows the pointer. */
  active: boolean;
}

/**
 * A Free Transform session (or Edit → Transform → Scale or Rotate): it takes over the
 * canvas's input from the active tool and previews its layer moved, scaled and turned on
 * the overlay, leaving the document alone, until it's applied as one
 * `TransformLayerCommand` or cancelled.
 *
 * It's the editor's pending edit meanwhile, so anything else that would change the
 * document applies it first, and undo cancels it. It ends by itself, adding nothing to
 * history, if the document changes under it all the same (when it's replaced, say).
 */
export class TransformSession implements ToolSession {
  readonly OptionsPanel: ComponentType | undefined;
  readonly source: TransformSource;
  /** What the editor holds while the session runs: applying or cancelling it ends the session. */
  readonly edit: PendingEdit;
  private readonly editor: Editor;
  private readonly tools: ToolManager;
  private readonly options: TransformOptions;
  private readonly liftState: number | null;
  private readonly onEnd: (() => void) | undefined;
  private context: ToolContext | null = null;
  private currentMode: TransformMode;
  private currentState: TransformState;
  private currentMatrix: Affine | Projective;
  private currentParams: TransformParams | null;
  private currentOverlay: TransformOverlay;
  private currentCursor = 'default';
  private drag: TransformDrag | null = null;
  private ended = false;
  private readonly subscriptions: (() => void)[] = [];
  private readonly listeners = new Set<() => void>();

  constructor(init: TransformSessionInit) {
    this.editor = init.editor;
    this.tools = init.tools;
    this.options = init.options;
    this.source = init.source;
    this.liftState = init.liftState;
    this.OptionsPanel = init.OptionsPanel;
    this.onEnd = init.onEnd;
    this.currentMode = init.mode;
    this.currentState = identityState(init.source.rect);
    this.currentMatrix = stateMatrix(init.source.rect, this.currentState);
    this.currentParams = stateParams(init.source.rect, this.currentState);
    this.currentOverlay = this.buildOverlay();
    const name = () => this.name;
    this.edit = {
      get label() {
        return name();
      },
      apply: () => this.finish(),
      cancel: () => this.revert(),
    };
  }

  /** "Free Transform", "Scale" or "Rotate": the options bar's title and the undo label. */
  get name(): string {
    return MODE_NAMES[this.currentMode];
  }

  get mode(): TransformMode {
    return this.currentMode;
  }

  /** Where the box's corners and pivot are: what every change works on. */
  get state(): TransformState {
    return this.currentState;
  }

  /** The state as the options bar reads it, or null while the box isn't a parallelogram. */
  get params(): TransformParams | null {
    return this.currentParams;
  }

  /** The transform as `TransformLayerCommand` takes it, canvas to canvas. */
  get matrix(): Affine | Projective {
    return this.currentMatrix;
  }

  /** False once it has been applied, cancelled or abandoned. */
  get active(): boolean {
    return !this.ended;
  }

  get cursor(): string {
    return this.currentCursor;
  }

  get overlay(): TransformOverlay {
    return this.currentOverlay;
  }

  activate(context: ToolContext): void {
    this.context = context;
    this.subscriptions.push(
      this.editor.subscribe((change) => this.editorChanged(change)),
      this.options.subscribe(() => this.update()),
    );
  }

  deactivate(): void {
    for (const unsubscribe of this.subscriptions.splice(0)) unsubscribe();
    this.context = null;
    // The tool manager let go of it (it shouldn't, but nothing must be left pending).
    if (!this.ended) this.abandon();
  }

  /** Switches between Free Transform, Scale and Rotate, keeping the transform so far. */
  setMode(mode: TransformMode): void {
    if (this.ended || mode === this.currentMode) return;
    this.cancel();
    this.currentMode = mode;
    this.setCursor('default');
    this.changed();
  }

  /** Flips or turns the transformed layer about its pivot, as the canvas sees it. */
  orient(orientation: Orientation): void {
    if (this.ended) return;
    this.cancel();
    this.setState(orientState(this.currentState, orientation));
  }

  /**
   * Sets one of the options bar's fields, scaling about the pivot. Returns false, changing
   * nothing, for a value the field refuses (see `withField`).
   */
  setField(field: TransformField, value: number): boolean {
    if (this.ended) return false;
    const { unit, lockAspect } = this.options.settings;
    const state = withField(this.source.rect, this.currentState, field, value, unit, lockAspect);
    if (!state) return false;
    this.cancel();
    this.setState(state);
    return true;
  }

  /**
   * Applies the transform as one undo step (none if it changes nothing) and ends the
   * session. Refused, with a message, if the result would be too big: the session goes
   * on. Returns true if the session ended.
   */
  apply(): boolean {
    if (this.ended) return true;
    if (this.drag?.active) return false;
    if (this.tooBig()) {
      this.tools.showMessage(
        `A transformed layer can be at most ${MAX_IMAGE_SIZE} × ${MAX_IMAGE_SIZE} pixels`,
      );
      return false;
    }
    if (this.editor.pending === this.edit) this.editor.applyPending();
    else this.finish();
    return true;
  }

  /** Ends the session leaving the document as it was before it began. */
  discard(): void {
    if (this.ended) return;
    if (this.editor.pending === this.edit) this.editor.cancelPending();
    else this.revert();
  }

  /** The canvas's context menu while the session runs: its turns and flips, Apply, Cancel. */
  contextMenu(): ContextMenuSections {
    const orient = (orientation: Orientation): ContextMenuItem => ({
      command: `transform-${orientation}`,
      label: ORIENTATION_LABELS[orientation],
      run: () => this.orient(orientation),
    });
    return [
      [orient('flip-horizontal'), orient('flip-vertical')],
      [orient('rotate-180'), orient('rotate-cw'), orient('rotate-ccw')],
      [
        {
          command: 'transform-apply',
          label: 'Apply',
          shortcut: 'Enter',
          plain: true,
          run: () => {
            this.apply();
          },
        },
        {
          command: 'transform-cancel',
          label: 'Cancel',
          shortcut: 'Escape',
          plain: true,
          run: () => this.discard(),
        },
      ],
    ];
  }

  pointerDown(e: ToolPointerEvent): void {
    if (this.ended || this.drag) return;
    const { corners } = this.currentOverlay;
    const hit = hitTransform(corners, e, e.zoom, this.currentMode);
    if (!hit) return;
    this.drag = {
      hit,
      press: { x: e.x, y: e.y },
      start: this.currentState,
      point: { x: e.x, y: e.y },
      shiftKey: e.shiftKey,
      altKey: e.altKey,
      zoom: e.zoom,
      active: false,
    };
    this.setCursor(transformCursor(corners, hit));
  }

  pointerMove(e: ToolPointerEvent): void {
    const drag = this.drag;
    if (!drag) {
      this.hover(e);
      return;
    }
    drag.point = { x: e.x, y: e.y };
    drag.shiftKey = e.shiftKey;
    drag.altKey = e.altKey;
    drag.zoom = e.zoom;
    this.follow(drag);
  }

  pointerUp(e: ToolPointerEvent): void {
    if (!this.drag) return;
    this.pointerMove(e);
    this.drag = null;
    this.hover(e);
  }

  doubleClick(e: ToolPointerEvent): void {
    if (this.ended) return;
    const hit = hitTransform(this.currentOverlay.corners, e, e.zoom, this.currentMode);
    if (hit?.kind === 'move') this.apply();
  }

  /** Abandons the drag in progress, putting the box back where it was at the press. */
  cancel(): void {
    const drag = this.drag;
    if (!drag) return;
    this.drag = null;
    if (drag.active) this.setState(drag.start);
  }

  keyDown(e: ToolKeyEvent): boolean {
    if (this.ended) return false;
    if (e.key === 'Shift' || e.key === 'Alt') return this.modifierChanged(e);
    if (e.ctrlKey || e.metaKey) return false;
    switch (e.key) {
      case 'Enter':
        if (!e.repeat) this.apply();
        return true;
      case 'Escape':
        if (!e.repeat) this.discard();
        return true;
      default: {
        const offset = nudgeOffset(e.key, e.shiftKey);
        if (!offset) return false;
        if (!this.drag) this.setState(translateState(this.currentState, offset.dx, offset.dy));
        return true;
      }
    }
  }

  keyUp(e: ToolKeyEvent): boolean {
    return e.key === 'Shift' || e.key === 'Alt' ? this.modifierChanged(e) : false;
  }

  /** Calls `listener` when the transform, its mode or its settings change, or it ends. */
  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /** Shift and Alt change a drag straight away. Alt is claimed so it doesn't open browser menus. */
  private modifierChanged(e: ToolKeyEvent): boolean {
    const drag = this.drag;
    if (drag) {
      drag.shiftKey = e.shiftKey;
      drag.altKey = e.altKey;
      this.follow(drag);
    }
    return true;
  }

  private hover(e: ToolPointerEvent): void {
    if (this.ended) return;
    const { corners } = this.currentOverlay;
    this.setCursor(transformCursor(corners, hitTransform(corners, e, e.zoom, this.currentMode)));
  }

  /** Moves, scales or turns the box to follow the drag, once it has taken hold. */
  private follow(drag: TransformDrag): void {
    if (!drag.active) {
      const travel = Math.hypot(drag.point.x - drag.press.x, drag.point.y - drag.press.y);
      if (travel * drag.zoom < CLICK_TOLERANCE) return;
      drag.active = true;
    }
    const { hit, start, press, point } = drag;
    let state: TransformState;
    switch (hit.kind) {
      case 'move':
        state = moveState(start, press, point, drag.shiftKey);
        break;
      case 'rotate':
        state = rotateState(start, press, point, drag.shiftKey);
        break;
      case 'scale': {
        const corner = hit.handle.length === 2;
        const { lockAspect } = this.options.settings;
        state = scaleState(this.source.rect, start, hit.handle, press, point, {
          proportional: corner ? lockAspect !== drag.shiftKey : lockAspect,
          fromPivot: drag.altKey,
        });
        break;
      }
    }
    this.setState(state);
    this.setCursor(transformCursor(this.currentOverlay.corners, hit));
  }

  private setState(state: TransformState): void {
    if (sameState(state, this.currentState)) return;
    const { rect } = this.source;
    this.currentState = state;
    this.currentMatrix = stateMatrix(rect, state);
    this.currentParams = stateParams(rect, state);
    this.update();
  }

  private update(): void {
    if (this.ended) return;
    this.currentOverlay = this.buildOverlay();
    this.changed();
  }

  private changed(): void {
    this.context?.overlayChanged();
    for (const listener of [...this.listeners]) listener();
  }

  private setCursor(cursor: string): void {
    if (cursor === this.currentCursor) return;
    this.currentCursor = cursor;
    this.context?.overlayChanged();
  }

  private buildOverlay(): TransformOverlay {
    const { source } = this;
    const m = this.currentMatrix;
    const centre = sourceCentre(source.rect);
    const [pivotX, pivotY] = mapPoint(m, centre.x, centre.y);
    return {
      shape: 'transform',
      layerId: source.layerId,
      pixels: source.pixels,
      x: source.rect.x,
      y: source.rect.y,
      matrix: m,
      interpolation: this.options.settings.interpolation,
      opacity: source.opacity,
      corners: mapCorners(m, source.rect),
      pivot: { x: pivotX, y: pivotY },
    };
  }

  /** True if the transformed layer would be bigger than a layer may be. */
  private tooBig(): boolean {
    if (isIdentity(this.currentMatrix)) return false;
    const bounds = mappedBounds(this.currentMatrix, this.source.rect);
    return !bounds || bounds.width > MAX_IMAGE_SIZE || bounds.height > MAX_IMAGE_SIZE;
  }

  /** Ends the session if the document changed under it. */
  private editorChanged(change: EditorChange): void {
    if (this.ended) return;
    const { layerId, pixels, rect } = this.source;
    const layer = findLayer(this.editor.document, layerId);
    if (
      change.documentReplaced ||
      change.resized ||
      !layer ||
      !layer.visible ||
      layer.pixels !== pixels ||
      layer.x !== rect.x ||
      layer.y !== rect.y ||
      change.layerPixels?.some((entry) => entry.layerId === layerId)
    ) {
      this.abandon();
    }
  }

  /** PendingEdit.apply: one `TransformLayerCommand`, unless nothing changes. */
  private finish(): void {
    if (this.ended) return;
    const tooBig = this.tooBig();
    this.end();
    const { editor } = this;
    const doc = editor.document;
    const command = isIdentity(this.currentMatrix)
      ? null
      : transformLayerCommand(
          doc,
          this.source.layerId,
          this.currentMatrix,
          this.options.settings.interpolation,
          { label: this.name, floating: editor.floating },
        );
    if (!command) {
      this.undoLift();
      return;
    }
    // Applied by something else (a tool switch, a save): too big is cut to the canvas.
    if (tooBig) this.tools.showMessage('The transformed layer was cut to the canvas');
    editor.history.execute(command);
  }

  /** PendingEdit.cancel: ends the session, undoing the lift it began with. */
  private revert(): void {
    if (this.ended) return;
    this.end();
    this.undoLift();
  }

  /** Ends the session without touching history: the document changed under it. */
  private abandon(): void {
    if (this.ended) return;
    this.end();
    this.editor.endPending(this.edit);
  }

  private end(): void {
    this.ended = true;
    this.drag = null;
    this.tools.endSession(this);
    for (const unsubscribe of this.subscriptions.splice(0)) unsubscribe();
    this.onEnd?.();
    for (const listener of [...this.listeners]) listener();
    this.listeners.clear();
  }

  private undoLift(): void {
    const { history } = this.editor;
    if (this.liftState !== null && history.stateId === this.liftState) history.undo();
  }
}
