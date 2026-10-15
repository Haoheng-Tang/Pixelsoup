import type { ComponentType } from 'react';
import type { Rect } from '../../core';
import {
  assertNever,
  cropCommand,
  documentBounds,
  isValidImageSize,
  MAX_IMAGE_SIZE,
} from '../../core';
import type { CropHandle, CropHit } from './crop-geometry';
import {
  drawBox,
  fitBox,
  HANDLE_REACH,
  hitCursor,
  hitTest,
  moveBox,
  reshapeBox,
  resizeBox,
} from './crop-geometry';
import type { CropOptions, CropSettings } from './crop-options';
import { cropRatio, orientedRatio } from './crop-options';
import type { CropOverlay, Tool, ToolContext, ToolKeyEvent, ToolPointerEvent } from './tool';
import { CLICK_TOLERANCE, TOOL_KEYS } from './tool';

/**
 * How the box came about: as the tool put it up (`initial`: the selection's bounds, or the
 * whole canvas), fitted to a ratio chosen since (`fitted`), or adjusted by hand
 * (`adjusted`). Only the initial box is unarmed: a drag inside it draws a new box rather
 * than moving it.
 */
type BoxState = 'initial' | 'fitted' | 'adjusted';

/** What a drag does: draw a new box, or move or resize the box as it was at the press. */
type CropAction =
  | { readonly kind: 'draw' }
  | { readonly kind: 'move'; readonly box: Rect }
  | { readonly kind: 'resize'; readonly box: Rect; readonly handle: CropHandle };

interface CropGesture {
  readonly action: CropAction;
  /** The box before the press and how it came about, which cancelling puts back. */
  readonly before: Rect | null;
  readonly beforeState: BoxState;
  /** The press, in document coordinates. */
  readonly startX: number;
  readonly startY: number;
  /** Latest pointer position, document coordinates. */
  x: number;
  y: number;
  /** The pointer has travelled past the click tolerance (and stays a drag from then on). */
  dragged: boolean;
  shiftKey: boolean;
  altKey: boolean;
}

function sameRect(a: Rect, b: Rect): boolean {
  return a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height;
}

function sameShape(a: CropSettings, b: CropSettings): boolean {
  return (
    a.aspect === b.aspect && a.customWidth === b.customWidth && a.customHeight === b.customHeight
  );
}

/**
 * Crops the canvas to a box. The box appears as the tool becomes active: the selection's
 * bounds, or else the whole canvas. Drag one of its eight handles to resize it, or
 * elsewhere to draw a new box; once the box is armed (adjusted, drawn afresh or fitted to
 * a ratio), a drag inside it moves it instead. The box keeps the options bar's ratio; in
 * Free, Shift keeps it square while drawing and its shape while resizing. Alt draws or
 * resizes from the centre. Enter, a double-click inside or the options bar's ✓ crops;
 * Escape or ✗ puts back the initial box. A box past the canvas's edges enlarges it with
 * transparent space.
 *
 * The box is session state. It goes away when the tool does, and starts again as the
 * whole canvas after a crop, or when the canvas changes size or the document is replaced.
 */
export class CropTool implements Tool {
  readonly id = 'crop';
  readonly name = 'Crop';
  readonly shortcut = TOOL_KEYS.crop;
  private context: ToolContext | null = null;
  private unsubscribe: (() => void)[] = [];
  private currentBox: Rect | null = null;
  private state: BoxState = 'initial';
  /** The box the tool put up, which Escape and ✗ put back. */
  private initialBox: Rect | null = null;
  private gesture: CropGesture | null = null;
  /** The latest pointer event, to update the cursor when the box changes under it. */
  private pointer: ToolPointerEvent | null = null;
  private preview: CropOverlay | null = null;
  private currentCursor = 'crosshair';
  /** The settings when last seen, to tell when the ratio changes. */
  private settings: CropSettings;
  /** What subscribers last heard (`hasBox`, `canCommit`, `canReset`), to tell only changes. */
  private published = '';
  private readonly listeners = new Set<() => void>();

  constructor(
    private readonly options: CropOptions,
    readonly OptionsPanel?: ComponentType,
  ) {
    this.settings = options.settings;
  }

  get cursor(): string {
    return this.currentCursor;
  }

  get overlay(): CropOverlay | null {
    return this.preview;
  }

  /** The crop box in document coordinates, whole pixels; null while the tool isn't active. */
  get box(): Rect | null {
    return this.currentBox;
  }

  get hasBox(): boolean {
    return this.currentBox !== null;
  }

  /**
   * Whether the box is armed: adjusted, drawn afresh or fitted to a ratio since the tool
   * put it up. A drag inside an armed box moves it; inside the initial box it draws.
   */
  get armed(): boolean {
    return this.currentBox !== null && this.state !== 'initial';
  }

  /** Whether Enter or ✓ would crop: not with the untouched whole-canvas box. */
  get canCommit(): boolean {
    const box = this.currentBox;
    const doc = this.context?.editor.document;
    if (!box || !doc) return false;
    return this.state !== 'initial' || !sameRect(box, documentBounds(doc));
  }

  /** Whether Escape or ✗ would put back the initial box: while the box is armed. */
  get canReset(): boolean {
    return this.armed;
  }

  /** Calls `listener` when `hasBox`, `canCommit` or `canReset` changes. */
  readonly subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  activate(context: ToolContext): void {
    this.context = context;
    this.settings = this.options.settings;
    const { editor } = context;
    this.unsubscribe = [
      this.options.subscribe(this.handleOptions),
      editor.subscribe((change) => {
        // The box means nothing on another canvas, or this one at another size.
        if (change.documentReplaced || change.resized) {
          this.gesture = null;
          this.start(documentBounds(editor.document));
        }
      }),
    ];
    const doc = editor.document;
    this.start(doc.selection?.bounds() ?? documentBounds(doc));
  }

  deactivate(): void {
    for (const unsubscribe of this.unsubscribe.splice(0)) unsubscribe();
    this.gesture = null;
    this.pointer = null;
    this.initialBox = null;
    this.show(null, 'initial');
    this.context = null;
  }

  pointerDown(e: ToolPointerEvent): void {
    if (!this.context) return;
    this.pointer = e;
    const box = this.currentBox;
    const hit = this.hitAt(e);
    const action: CropAction =
      !box || hit === 'outside'
        ? { kind: 'draw' }
        : hit === 'inside'
          ? { kind: 'move', box }
          : { kind: 'resize', box, handle: hit };
    this.gesture = {
      action,
      before: box,
      beforeState: this.state,
      startX: e.x,
      startY: e.y,
      x: e.x,
      y: e.y,
      dragged: false,
      shiftKey: e.shiftKey,
      altKey: e.altKey,
    };
    this.setCursor(hitCursor(hit));
  }

  pointerMove(e: ToolPointerEvent): void {
    this.pointer = e;
    const gesture = this.gesture;
    if (!gesture) {
      this.hover();
      return;
    }
    this.track(gesture, e);
    this.update(gesture);
  }

  pointerUp(e: ToolPointerEvent): void {
    this.pointer = e;
    const gesture = this.gesture;
    if (!gesture) return;
    this.track(gesture, e);
    this.update(gesture);
    this.gesture = null;
    this.updateOverlay();
    this.hover();
  }

  doubleClick(e: ToolPointerEvent): void {
    const box = this.currentBox;
    if (box && hitTest(box, e.x, e.y, HANDLE_REACH / e.zoom) === 'inside') this.commit();
  }

  /** Puts back the box from before the press. */
  cancel(): void {
    const gesture = this.gesture;
    if (!gesture) return;
    this.gesture = null;
    this.show(gesture.before, gesture.beforeState);
  }

  keyDown(e: ToolKeyEvent): boolean {
    if (e.key === 'Shift' || e.key === 'Alt') return this.modifierKey(e);
    if (e.ctrlKey || e.metaKey || e.altKey) return false;
    if (e.key === 'Enter' && this.canCommit) {
      if (!e.repeat) this.commit();
      return true;
    }
    if (e.key === 'Escape' && this.canReset) {
      this.resetBox();
      return true;
    }
    return false;
  }

  keyUp(e: ToolKeyEvent): boolean {
    return e.key === 'Shift' || e.key === 'Alt' ? this.modifierKey(e) : false;
  }

  /**
   * Crops the canvas to the box, as one undo step after committing a floating selection,
   * then puts up the whole canvas as the new initial box. Does nothing mid-drag or with the
   * untouched whole-canvas box, and keeps the box (with a message) if it's too large.
   */
  commit(): void {
    const context = this.context;
    const box = this.currentBox;
    if (!context || !box || this.gesture || !this.canCommit) return;
    if (!isValidImageSize(box.width, box.height)) {
      context.showMessage(`A crop can be at most ${MAX_IMAGE_SIZE} × ${MAX_IMAGE_SIZE} pixels`);
      return;
    }
    const { editor } = context;
    const options = { trim: this.options.settings.deleteCropped };
    if (cropCommand(editor.document, box, options)) {
      editor.commitFloating();
      const command = cropCommand(editor.document, box, options);
      if (command) editor.history.execute(command);
    }
    this.start(documentBounds(editor.document));
  }

  /** Puts back the initial box without cropping. Does nothing mid-drag. */
  resetBox(): void {
    if (!this.gesture && this.initialBox) this.show(this.initialBox, 'initial');
  }

  /** Shift and Alt change the box mid-drag; claim them so Alt doesn't open browser menus. */
  private modifierKey(e: ToolKeyEvent): boolean {
    const gesture = this.gesture;
    if (gesture) {
      gesture.shiftKey = e.shiftKey;
      gesture.altKey = e.altKey;
      this.update(gesture);
    }
    return true;
  }

  private track(gesture: CropGesture, e: ToolPointerEvent): void {
    gesture.x = e.x;
    gesture.y = e.y;
    if (!gesture.dragged) {
      const travel = Math.hypot(e.x - gesture.startX, e.y - gesture.startY) * e.zoom;
      gesture.dragged = travel >= CLICK_TOLERANCE;
    }
    gesture.shiftKey = e.shiftKey;
    gesture.altKey = e.altKey;
  }

  /** Nothing changes until the pointer has moved past the click tolerance. */
  private update(gesture: CropGesture): void {
    if (gesture.dragged) this.show(this.dragBox(gesture), 'adjusted');
  }

  /** The box a drag makes, on whole pixels. */
  private dragBox(gesture: CropGesture): Rect {
    const { action } = gesture;
    const dx = Math.round(gesture.x - gesture.startX);
    const dy = Math.round(gesture.y - gesture.startY);
    const doc = this.context?.editor.document;
    const rule = doc ? cropRatio(this.options.settings, doc.width, doc.height) : null;
    switch (action.kind) {
      case 'draw': {
        const anchorX = Math.round(gesture.startX);
        const anchorY = Math.round(gesture.startY);
        const pointX = Math.round(gesture.x);
        const pointY = Math.round(gesture.y);
        const landscape = Math.abs(pointX - anchorX) >= Math.abs(pointY - anchorY);
        const ratio = rule ? orientedRatio(rule, landscape) : gesture.shiftKey ? 1 : null;
        return drawBox(anchorX, anchorY, pointX, pointY, ratio, gesture.altKey);
      }
      case 'move':
        return moveBox(action.box, dx, dy);
      case 'resize': {
        const { box, handle } = action;
        const ratio = rule
          ? orientedRatio(rule, box.width >= box.height)
          : gesture.shiftKey
            ? box.width / box.height
            : null;
        return resizeBox(box, handle, dx, dy, ratio, gesture.altKey);
      }
      default:
        return assertNever(action);
    }
  }

  /** What a press at `e` grabs. Inside the initial box it draws a new box, as outside does. */
  private hitAt(e: ToolPointerEvent): CropHit {
    const box = this.currentBox;
    if (!box) return 'outside';
    const hit = hitTest(box, e.x, e.y, HANDLE_REACH / e.zoom);
    return hit === 'inside' && this.state === 'initial' ? 'outside' : hit;
  }

  /** Shows in the cursor what a press where the pointer is would do. */
  private hover(): void {
    if (this.gesture) return;
    this.setCursor(this.pointer ? hitCursor(this.hitAt(this.pointer)) : 'crosshair');
  }

  /**
   * A new ratio fits the largest box of that shape inside the initial box, centred, until
   * the box is adjusted by hand; from then on it reshapes the box around its centre,
   * keeping its area and orientation.
   */
  private readonly handleOptions = (): void => {
    const previous = this.settings;
    const settings = this.options.settings;
    this.settings = settings;
    const box = this.currentBox;
    const initial = this.initialBox;
    const doc = this.context?.editor.document;
    if (!box || !initial || !doc || this.gesture || sameShape(previous, settings)) return;
    const rule = cropRatio(settings, doc.width, doc.height);
    if (!rule) return;
    if (this.state === 'adjusted') {
      this.show(reshapeBox(box, orientedRatio(rule, box.width >= box.height)), 'adjusted');
      return;
    }
    const fitted = fitBox(initial, orientedRatio(rule, initial.width >= initial.height));
    this.show(fitted, sameRect(fitted, initial) ? 'initial' : 'fitted');
  };

  /** Puts up `box` as the initial box. */
  private start(box: Rect): void {
    this.initialBox = box;
    this.show(box, 'initial');
  }

  /** Shows `box`, which came about as `state` says. */
  private show(box: Rect | null, state: BoxState): void {
    this.currentBox = box;
    this.state = state;
    this.updateOverlay();
    this.hover();
    const published = `${this.hasBox} ${this.canCommit} ${this.canReset}`;
    if (published === this.published) return;
    this.published = published;
    for (const listener of [...this.listeners]) listener();
  }

  private setCursor(cursor: string): void {
    if (cursor === this.currentCursor) return;
    this.currentCursor = cursor;
    this.context?.overlayChanged();
  }

  private updateOverlay(): void {
    const box = this.currentBox;
    const grid = this.gesture?.dragged ?? false;
    const doc = this.context?.editor.document;
    const shade = box !== null && (!doc || !sameRect(box, documentBounds(doc)));
    const previous = this.preview;
    if (!box && !previous) return;
    if (
      box &&
      previous &&
      sameRect(box, previous.rect) &&
      grid === previous.grid &&
      shade === previous.shade
    ) {
      return;
    }
    this.preview = box && { shape: 'crop', rect: box, grid, shade };
    this.context?.overlayChanged();
  }
}
