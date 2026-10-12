import type { ComponentType } from 'react';
import type { Rect } from '../../core';
import { assertNever, cropCommand, isValidImageSize, MAX_IMAGE_SIZE } from '../../core';
import type { CropHandle } from './crop-geometry';
import { drawBox, hitCursor, hitTest, moveBox, reshapeBox, resizeBox } from './crop-geometry';
import type { CropOptions, CropSettings } from './crop-options';
import { cropRatio, orientedRatio } from './crop-options';
import type { CropOverlay, Tool, ToolContext, ToolKeyEvent, ToolPointerEvent } from './tool';
import { CLICK_TOLERANCE, TOOL_KEYS } from './tool';

/** How far from the box's edge, in CSS pixels, a press still grabs it. */
export const HANDLE_REACH = 6;

/** What a drag does: draw a new box, or move or resize the box as it was at the press. */
type CropAction =
  | { readonly kind: 'draw' }
  | { readonly kind: 'move'; readonly box: Rect }
  | { readonly kind: 'resize'; readonly box: Rect; readonly handle: CropHandle };

interface CropGesture {
  readonly action: CropAction;
  /** The box before the press, which cancelling puts back. */
  readonly before: Rect | null;
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
 * Crops the canvas to a box. Dragging draws the box, which then has eight handles: drag
 * one to resize it, or inside to move it. The box keeps the options bar's ratio; in Free,
 * Shift keeps it square while drawing and its shape while resizing. Alt draws or resizes
 * from the centre. Enter, a double-click inside or the options bar's ✓ crops; Escape or
 * ✗ removes the box. A box past the canvas's edges enlarges it with transparent space.
 *
 * The box is session state: it starts as the selection's bounds when the tool becomes
 * active, and goes away when the tool does or the canvas changes size.
 */
export class CropTool implements Tool {
  readonly id = 'crop';
  readonly name = 'Crop';
  readonly shortcut = TOOL_KEYS.crop;
  private context: ToolContext | null = null;
  private unsubscribe: (() => void)[] = [];
  private currentBox: Rect | null = null;
  private gesture: CropGesture | null = null;
  private preview: CropOverlay | null = null;
  private currentCursor = 'crosshair';
  /** The settings when last seen, to tell when the ratio changes. */
  private settings: CropSettings;
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

  /** The crop box in document coordinates, whole pixels; null when there is none. */
  get box(): Rect | null {
    return this.currentBox;
  }

  get hasBox(): boolean {
    return this.currentBox !== null;
  }

  /** Calls `listener` when the box appears or goes away. */
  readonly subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  activate(context: ToolContext): void {
    this.context = context;
    this.settings = this.options.settings;
    this.unsubscribe = [
      this.options.subscribe(this.handleOptions),
      context.editor.subscribe((change) => {
        // The box means nothing on another canvas, or this one at another size.
        if (change.documentReplaced || change.resized) {
          this.gesture = null;
          this.setBox(null);
        }
      }),
    ];
    const bounds = context.editor.document.selection?.bounds() ?? null;
    if (bounds) this.setBox(bounds);
  }

  deactivate(): void {
    for (const unsubscribe of this.unsubscribe.splice(0)) unsubscribe();
    this.setBox(null);
    this.context = null;
  }

  pointerDown(e: ToolPointerEvent): void {
    if (!this.context) return;
    const box = this.currentBox;
    const hit = box ? hitTest(box, e.x, e.y, HANDLE_REACH / e.zoom) : 'outside';
    const action: CropAction =
      !box || hit === 'outside'
        ? { kind: 'draw' }
        : hit === 'inside'
          ? { kind: 'move', box }
          : { kind: 'resize', box, handle: hit };
    this.gesture = {
      action,
      before: box,
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
    const gesture = this.gesture;
    if (!gesture) {
      this.hover(e);
      return;
    }
    this.track(gesture, e);
    this.update(gesture);
  }

  pointerUp(e: ToolPointerEvent): void {
    const gesture = this.gesture;
    if (!gesture) return;
    this.track(gesture, e);
    this.update(gesture);
    this.gesture = null;
    this.updateOverlay();
    this.hover(e);
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
    this.setBox(gesture.before);
    this.updateOverlay();
  }

  keyDown(e: ToolKeyEvent): boolean {
    if (e.key === 'Shift' || e.key === 'Alt') return this.modifierKey(e);
    if (e.ctrlKey || e.metaKey || e.altKey || !this.currentBox) return false;
    if (e.key === 'Enter') {
      if (!e.repeat) this.commit();
      return true;
    }
    if (e.key === 'Escape') {
      this.clearBox();
      return true;
    }
    return false;
  }

  keyUp(e: ToolKeyEvent): boolean {
    return e.key === 'Shift' || e.key === 'Alt' ? this.modifierKey(e) : false;
  }

  /**
   * Crops the canvas to the box, as one undo step after committing a floating selection.
   * Does nothing mid-drag, and keeps the box (with a message) if it's too large.
   */
  commit(): void {
    const context = this.context;
    const box = this.currentBox;
    if (!context || !box || this.gesture) return;
    if (!isValidImageSize(box.width, box.height)) {
      context.showMessage(`A crop can be at most ${MAX_IMAGE_SIZE} × ${MAX_IMAGE_SIZE} pixels`);
      return;
    }
    const { editor } = context;
    const options = { trim: this.options.settings.deleteCropped };
    this.setBox(null);
    if (!cropCommand(editor.document, box, options)) return;
    editor.commitFloating();
    const command = cropCommand(editor.document, box, options);
    if (command) editor.history.execute(command);
  }

  /** Removes the box without cropping. Does nothing mid-drag. */
  clearBox(): void {
    if (!this.gesture) this.setBox(null);
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
    if (gesture.dragged) this.setBox(this.dragBox(gesture));
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

  private hover(e: ToolPointerEvent): void {
    const box = this.currentBox;
    this.setCursor(box ? hitCursor(hitTest(box, e.x, e.y, HANDLE_REACH / e.zoom)) : 'crosshair');
  }

  /** A new ratio reshapes the box around its centre, keeping its area and orientation. */
  private readonly handleOptions = (): void => {
    const previous = this.settings;
    const settings = this.options.settings;
    this.settings = settings;
    const box = this.currentBox;
    const doc = this.context?.editor.document;
    if (!box || !doc || this.gesture || sameShape(previous, settings)) return;
    const rule = cropRatio(settings, doc.width, doc.height);
    if (rule) this.setBox(reshapeBox(box, orientedRatio(rule, box.width >= box.height)));
  };

  private setBox(box: Rect | null): void {
    const had = this.currentBox !== null;
    this.currentBox = box;
    if (!box) this.setCursor('crosshair');
    this.updateOverlay();
    if (had !== (box !== null)) for (const listener of [...this.listeners]) listener();
  }

  private setCursor(cursor: string): void {
    if (cursor === this.currentCursor) return;
    this.currentCursor = cursor;
    this.context?.overlayChanged();
  }

  private updateOverlay(): void {
    const box = this.currentBox;
    const grid = this.gesture?.dragged ?? false;
    const previous = this.preview;
    if (!box && !previous) return;
    if (box && previous && sameRect(box, previous.rect) && grid === previous.grid) return;
    this.preview = box && { shape: 'crop', rect: box, grid };
    this.context?.overlayChanged();
  }
}
