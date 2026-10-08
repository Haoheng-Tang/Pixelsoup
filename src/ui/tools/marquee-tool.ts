import type { ComponentType } from 'react';
import type { ImageDocument, Rect, SelectionMode } from '../../core';
import { combineSelections, Selection, SetSelectionCommand } from '../../core';
import type { SelectionOptions } from './selection-options';
import type {
  Tool,
  ToolContext,
  ToolKeyEvent,
  ShapeOverlay,
  ToolModifiers,
  ToolPointerEvent,
} from './tool';
import { TOOL_KEYS } from './tool';

export type MarqueeShape = 'rect' | 'ellipse';

/** Pointer travel in CSS pixels below which a press is a click rather than a drag. */
export const CLICK_TOLERANCE = 3;

interface MarqueeDrag {
  readonly document: ImageDocument;
  readonly mode: SelectionMode;
  /** The press, in document coordinates. */
  readonly startX: number;
  readonly startY: number;
  /** The press snapped to the nearest pixel corner: a corner (or the centre) of the shape. */
  readonly anchorX: number;
  readonly anchorY: number;
  /** Latest pointer position, document coordinates. */
  x: number;
  y: number;
  /** The pointer has travelled past the click tolerance (and stays a drag from then on). */
  dragged: boolean;
  shiftKey: boolean;
  altKey: boolean;
  /**
   * A modifier held at the press that picked the mode (Shift adds, Alt subtracts) only
   * starts constraining the shape once it has been released and pressed again.
   */
  shiftPickedMode: boolean;
  altPickedMode: boolean;
}

/**
 * The shape from `anchor` towards `point`, both on the pixel-corner grid. `square` makes
 * the sides equal (the longer of the two wins); `fromCenter` grows the shape around the
 * anchor instead of from it.
 */
export function marqueeRect(
  anchorX: number,
  anchorY: number,
  pointX: number,
  pointY: number,
  square: boolean,
  fromCenter: boolean,
): Rect {
  let dx = pointX - anchorX;
  let dy = pointY - anchorY;
  if (square) {
    const side = Math.max(Math.abs(dx), Math.abs(dy));
    dx = dx < 0 ? -side : side;
    dy = dy < 0 ? -side : side;
  }
  const w = Math.abs(dx);
  const h = Math.abs(dy);
  if (fromCenter) return { x: anchorX - w, y: anchorY - h, width: 2 * w, height: 2 * h };
  return {
    x: Math.min(anchorX, anchorX + dx),
    y: Math.min(anchorY, anchorY + dy),
    width: w,
    height: h,
  };
}

/** The mode chosen by modifiers held at the press: Shift adds, Alt subtracts, both intersect. */
function modifierMode(e: ToolModifiers): SelectionMode | null {
  if (e.shiftKey && e.altKey) return 'intersect';
  if (e.shiftKey) return 'add';
  if (e.altKey) return 'subtract';
  return null;
}

/**
 * Rectangular or elliptical marquee. Dragging previews the shape and commits it on
 * release, combined with the current selection according to the mode: the options bar's
 * mode, overridden by Shift/Alt held at the press when there is a selection. During the
 * drag Shift constrains to a square or circle and Alt draws from the centre. A click
 * without a drag deselects.
 */
export class MarqueeTool implements Tool {
  readonly id: string;
  readonly name: string;
  readonly shortcut = TOOL_KEYS.marquee;
  readonly cursor = 'crosshair';
  private context: ToolContext | null = null;
  private drag: MarqueeDrag | null = null;
  private preview: ShapeOverlay | null = null;

  constructor(
    readonly shape: MarqueeShape,
    private readonly options: SelectionOptions,
    readonly OptionsPanel?: ComponentType,
  ) {
    this.id = shape === 'rect' ? 'rect-marquee' : 'ellipse-marquee';
    this.name = shape === 'rect' ? 'Rectangular Marquee' : 'Elliptical Marquee';
  }

  get overlay(): ShapeOverlay | null {
    return this.preview;
  }

  activate(context: ToolContext): void {
    this.context = context;
  }

  deactivate(): void {
    this.context = null;
  }

  pointerDown(e: ToolPointerEvent): void {
    if (!this.context) return;
    const doc = this.context.editor.document;
    // Without a selection there is nothing to add to, so Shift and Alt constrain at once.
    const picked = doc.selection ? modifierMode(e) : null;
    this.drag = {
      document: doc,
      mode: picked ?? this.options.mode,
      startX: e.x,
      startY: e.y,
      anchorX: Math.round(e.x),
      anchorY: Math.round(e.y),
      x: e.x,
      y: e.y,
      dragged: false,
      shiftKey: e.shiftKey,
      altKey: e.altKey,
      shiftPickedMode: picked !== null && e.shiftKey,
      altPickedMode: picked !== null && e.altKey,
    };
    this.updatePreview();
  }

  pointerMove(e: ToolPointerEvent): void {
    const drag = this.drag;
    if (!drag) return;
    this.track(drag, e);
    this.updatePreview();
  }

  pointerUp(e: ToolPointerEvent): void {
    const drag = this.drag;
    if (!drag || !this.context) return;
    this.track(drag, e);
    this.drag = null;
    this.updatePreview();

    const { editor } = this.context;
    const doc = editor.document;
    if (doc !== drag.document) return;
    const current = doc.selection;
    const shape = drag.dragged ? this.shapeSelection(doc, this.shapeRect(drag)) : null;
    if (!shape || shape.isEmpty) {
      // A click (or a shape off the canvas) deselects, unless it was meant to modify.
      if (drag.mode === 'replace' && current) {
        editor.commitFloating();
        editor.history.execute(new SetSelectionCommand(null, 'Deselect'));
      }
      return;
    }
    const next = combineSelections(current, shape, drag.mode);
    if (next === null ? current === null : current?.equals(next)) return;
    // A floating selection is dropped back into its layer before the selection changes.
    editor.commitFloating();
    editor.history.execute(new SetSelectionCommand(next, this.name));
  }

  cancel(): void {
    if (!this.drag) return;
    this.drag = null;
    this.updatePreview();
  }

  keyDown(e: ToolKeyEvent): boolean {
    return this.modifierKey(e);
  }

  keyUp(e: ToolKeyEvent): boolean {
    return this.modifierKey(e);
  }

  /** Shift and Alt change the shape mid-drag; claim them so Alt doesn't open browser menus. */
  private modifierKey(e: ToolKeyEvent): boolean {
    if (e.key !== 'Shift' && e.key !== 'Alt') return false;
    if (this.drag) {
      this.setModifiers(this.drag, e);
      this.updatePreview();
    }
    return true;
  }

  private track(drag: MarqueeDrag, e: ToolPointerEvent): void {
    drag.x = e.x;
    drag.y = e.y;
    if (!drag.dragged) {
      const travel = Math.hypot(e.x - drag.startX, e.y - drag.startY) * e.zoom;
      drag.dragged = travel >= CLICK_TOLERANCE;
    }
    this.setModifiers(drag, e);
  }

  private setModifiers(drag: MarqueeDrag, e: ToolModifiers): void {
    if (!e.shiftKey) drag.shiftPickedMode = false;
    if (!e.altKey) drag.altPickedMode = false;
    drag.shiftKey = e.shiftKey;
    drag.altKey = e.altKey;
  }

  private shapeRect(drag: MarqueeDrag): Rect {
    return marqueeRect(
      drag.anchorX,
      drag.anchorY,
      Math.round(drag.x),
      Math.round(drag.y),
      drag.shiftKey && !drag.shiftPickedMode,
      drag.altKey && !drag.altPickedMode,
    );
  }

  private shapeSelection(doc: ImageDocument, rect: Rect): Selection {
    return this.shape === 'rect'
      ? Selection.fromRect(doc.width, doc.height, rect)
      : Selection.fromEllipse(doc.width, doc.height, rect);
  }

  private updatePreview(): void {
    const drag = this.drag;
    const next: ShapeOverlay | null = drag?.dragged
      ? { shape: this.shape, rect: this.shapeRect(drag), hidesSelection: drag.mode === 'replace' }
      : null;
    if (next === null && this.preview === null) return;
    this.preview = next;
    this.context?.overlayChanged();
  }
}
