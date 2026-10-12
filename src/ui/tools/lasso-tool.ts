import type { ComponentType } from 'react';
import type { Editor, ImageDocument, Point, Rect, SelectionMode } from '../../core';
import { Selection } from '../../core';
import type { SelectionOptions } from './selection-options';
import { applySelection, pressMode } from './selection-tool';
import type {
  LassoOverlay,
  Tool,
  ToolContext,
  ToolKeyEvent,
  ToolModifiers,
  ToolPointerEvent,
} from './tool';
import { CLICK_TOLERANCE, TOOL_KEYS } from './tool';

/** How near the first vertex, in CSS pixels, a click closes a polygon. */
export const CLOSE_REACH = 6;

/** Freehand points closer together than this, in CSS pixels, are dropped. */
const FREEHAND_SPACING = 1;

/** The directions Shift constrains a segment to, every 45° clockwise from 0° (y is down). */
const DIRECTIONS: readonly (readonly [number, number])[] = [
  [1, 0],
  [Math.SQRT1_2, Math.SQRT1_2],
  [0, 1],
  [-Math.SQRT1_2, Math.SQRT1_2],
  [-1, 0],
  [-Math.SQRT1_2, -Math.SQRT1_2],
  [0, -1],
  [Math.SQRT1_2, -Math.SQRT1_2],
];

/**
 * `point` moved onto the nearest of the eight directions from `from` (multiples of 45°),
 * keeping its distance along that direction.
 */
export function snapToAngle(from: Point, point: Point): Point {
  const dx = point.x - from.x;
  const dy = point.y - from.y;
  const octant = (Math.round(Math.atan2(dy, dx) / (Math.PI / 4)) + 8) % 8;
  const [ux, uy] = DIRECTIONS[octant] ?? [1, 0];
  const length = dx * ux + dy * uy;
  return { x: from.x + length * ux, y: from.y + length * uy };
}

/** The whole-pixel bounds of a lasso's points and rubber band. */
export function lassoBounds({ points, next }: LassoOverlay): Rect | null {
  let left = Infinity;
  let top = Infinity;
  let right = -Infinity;
  let bottom = -Infinity;
  const extend = ({ x, y }: Point) => {
    left = Math.min(left, x);
    top = Math.min(top, y);
    right = Math.max(right, x);
    bottom = Math.max(bottom, y);
  };
  for (const point of points) extend(point);
  if (next) extend(next);
  if (left > right) return null;
  const x = Math.floor(left);
  const y = Math.floor(top);
  return { x, y, width: Math.ceil(right) - x, height: Math.ceil(bottom) - y };
}

/** A lasso being drawn. */
interface LassoPath {
  readonly document: ImageDocument;
  readonly mode: SelectionMode;
  /** Vertices, and the points freehand stretches pass through, in document coordinates. */
  readonly points: Point[];
  /** The pointer's latest position, and the zoom then. */
  pointer: Point;
  zoom: number;
  shiftKey: boolean;
  /**
   * A modifier held at the first press that picked the mode (Shift adds, Alt subtracts)
   * does nothing else until it has been released.
   */
  shiftPickedMode: boolean;
  altPickedMode: boolean;
}

/** Whether `a` and `b` are less than `reach` CSS pixels apart at `zoom`. */
function within(a: Point, b: Point, reach: number, zoom: number): boolean {
  return Math.hypot(a.x - b.x, a.y - b.y) * zoom < reach;
}

function lastPoint(path: LassoPath): Point {
  return path.points[path.points.length - 1] ?? path.pointer;
}

/** Adds `point` to the lasso, unless it's within `reach` CSS pixels of the last point. */
function addPoint(path: LassoPath, point: Point, reach: number): void {
  if (!within(point, lastPoint(path), reach, path.zoom)) {
    path.points.push({ x: point.x, y: point.y });
  }
}

/**
 * The Lasso and the Polygonal Lasso, which share a key (L): they draw a closed outline and
 * combine it with the selection on closing, as the marquees do (`applySelection`), with
 * the mode picked by the options bar or by Shift and Alt at the first press. Escape
 * abandons the outline. While drawing in New mode, the current selection's outline is
 * hidden.
 */
abstract class LassoToolBase implements Tool {
  abstract readonly id: string;
  abstract readonly name: string;
  readonly shortcut = TOOL_KEYS.lasso;
  readonly cursor = 'crosshair';
  protected context: ToolContext | null = null;
  protected path: LassoPath | null = null;
  private preview: LassoOverlay | null = null;

  constructor(
    private readonly options: SelectionOptions,
    readonly OptionsPanel?: ComponentType,
  ) {}

  get overlay(): LassoOverlay | null {
    return this.preview;
  }

  activate(context: ToolContext): void {
    this.context = context;
  }

  deactivate(): void {
    this.context = null;
  }

  cancel(): void {
    if (!this.path) return;
    this.path = null;
    this.reset();
    this.updatePreview();
  }

  /** Where the rubber band from the last point ends, if one shows. */
  protected abstract rubberBand(path: LassoPath): Point | null;

  /** Whether a click now would close the outline on its first point. */
  protected abstract closing(path: LassoPath): boolean;

  /** Clears the subclass's own state when the outline is closed or abandoned. */
  protected reset(): void {}

  protected start(editor: Editor, e: ToolPointerEvent): LassoPath {
    const { mode, picked } = pressMode(editor, e, this.options);
    const point = { x: e.x, y: e.y };
    this.path = {
      document: editor.document,
      mode,
      points: [point],
      pointer: point,
      zoom: e.zoom,
      shiftKey: e.shiftKey,
      shiftPickedMode: picked && e.shiftKey,
      altPickedMode: picked && e.altKey,
    };
    return this.path;
  }

  /** Follows the pointer and the modifiers it reports. */
  protected track(path: LassoPath, e: ToolPointerEvent): void {
    path.pointer = { x: e.x, y: e.y };
    path.zoom = e.zoom;
    this.trackModifiers(path, e);
  }

  protected trackModifiers(path: LassoPath, e: ToolModifiers): void {
    path.shiftKey = e.shiftKey;
    if (!e.shiftKey) path.shiftPickedMode = false;
    if (!e.altKey) path.altPickedMode = false;
  }

  /**
   * Closes the outline and combines it with the selection, as one undo step. One that
   * never left its first point (a click) deselects in New mode, like a click with a marquee.
   */
  protected close(): void {
    const path = this.path;
    const editor = this.context?.editor;
    this.path = null;
    this.reset();
    this.updatePreview();
    if (!path || !editor || editor.document !== path.document) return;
    const doc = editor.document;
    const first = path.points[0] ?? path.pointer;
    const click = path.points.every((point) => within(point, first, CLICK_TOLERANCE, path.zoom));
    const shape = click ? null : Selection.fromPolygon(doc.width, doc.height, path.points);
    applySelection(editor, shape, path.mode, this.name);
  }

  /** Takes back the last point; with none left, abandons the outline. */
  protected removeLastPoint(path: LassoPath): void {
    path.points.pop();
    if (path.points.length === 0) this.cancel();
    else this.updatePreview();
  }

  protected updatePreview(): void {
    const path = this.path;
    const next: LassoOverlay | null = path && {
      shape: 'lasso',
      points: path.points,
      next: this.rubberBand(path),
      closing: this.closing(path),
      hidesSelection: path.mode === 'replace',
    };
    if (next === null && this.preview === null) return;
    this.preview = next;
    this.context?.overlayChanged();
  }
}

/**
 * The Polygonal Lasso: each click adds a vertex, and a rubber band follows the pointer
 * from the last one; Shift constrains it to multiples of 45°. A click on the first vertex,
 * a double-click or Enter closes the polygon, Backspace or Delete takes back the last
 * vertex, and Escape abandons it.
 */
export class PolygonLassoTool extends LassoToolBase {
  readonly id = 'polygon-lasso';
  readonly name = 'Polygonal Lasso';

  pointerDown(e: ToolPointerEvent): void {
    const editor = this.context?.editor;
    if (!editor) return;
    const path = this.path;
    if (!path) {
      this.start(editor, e);
      this.updatePreview();
      return;
    }
    this.track(path, e);
    if (this.closing(path)) {
      this.close();
      return;
    }
    // The second press of a double-click adds nothing.
    addPoint(path, this.rubberBand(path), CLICK_TOLERANCE);
    this.updatePreview();
  }

  pointerMove(e: ToolPointerEvent): void {
    const path = this.path;
    if (!path) return;
    this.track(path, e);
    this.updatePreview();
  }

  doubleClick(): void {
    if (this.path) this.close();
  }

  keyDown(e: ToolKeyEvent): boolean {
    if (this.modifierKey(e)) return true;
    const path = this.path;
    if (!path || e.ctrlKey || e.metaKey || e.altKey) return false;
    switch (e.key) {
      case 'Escape':
        this.cancel();
        return true;
      case 'Enter':
        this.close();
        return true;
      case 'Backspace':
      case 'Delete':
        this.removeLastPoint(path);
        return true;
      default:
        return false;
    }
  }

  keyUp(e: ToolKeyEvent): boolean {
    return this.modifierKey(e);
  }

  protected rubberBand(path: LassoPath): Point {
    const constrain = path.shiftKey && !path.shiftPickedMode;
    return constrain ? snapToAngle(lastPoint(path), path.pointer) : path.pointer;
  }

  protected closing(path: LassoPath): boolean {
    const first = path.points[0];
    return (
      first !== undefined &&
      path.points.length >= 3 &&
      within(path.pointer, first, CLOSE_REACH, path.zoom)
    );
  }

  /** Shift constrains the rubber band; Alt is claimed so it doesn't open browser menus. */
  private modifierKey(e: ToolKeyEvent): boolean {
    if (e.key !== 'Shift' && e.key !== 'Alt') return false;
    if (this.path) {
      this.trackModifiers(this.path, e);
      this.updatePreview();
    }
    return true;
  }
}

/**
 * The Lasso: dragging draws a freehand outline, and releasing closes it. Releasing the
 * button with Alt held switches to straight segments instead, as in Photoshop: each click
 * adds a vertex (dragging from it draws freehand again), Backspace or Delete takes back
 * the last point, and releasing Alt, Enter, a double-click or a click on the first point
 * closes the outline.
 */
export class LassoTool extends LassoToolBase {
  readonly id = 'lasso';
  readonly name = 'Lasso';
  /** The button is down: the pointer draws freehand. */
  private drawing = false;
  /** Alt was held as the button came up: clicks add straight segments. */
  private polygonal = false;

  pointerDown(e: ToolPointerEvent): void {
    const editor = this.context?.editor;
    if (!editor) return;
    const path = this.path;
    this.drawing = true;
    if (!path) {
      this.start(editor, e);
      this.updatePreview();
      return;
    }
    this.track(path, e);
    if (this.closing(path)) {
      this.close();
      return;
    }
    addPoint(path, path.pointer, CLICK_TOLERANCE);
    this.updatePreview();
  }

  pointerMove(e: ToolPointerEvent): void {
    const path = this.path;
    if (!path) return;
    this.track(path, e);
    if (this.drawing) {
      for (const sample of e.samples ?? [e]) addPoint(path, sample, FREEHAND_SPACING);
    } else if (!e.altKey) {
      // Alt came up unseen (say, while the window was in the background).
      this.close();
      return;
    }
    this.updatePreview();
  }

  pointerUp(e: ToolPointerEvent): void {
    const path = this.path;
    if (!path || !this.drawing) return;
    this.drawing = false;
    this.track(path, e);
    addPoint(path, path.pointer, FREEHAND_SPACING);
    if (e.altKey && !path.altPickedMode) {
      this.polygonal = true;
      this.updatePreview();
      return;
    }
    this.close();
  }

  doubleClick(): void {
    if (this.path && this.polygonal) this.close();
  }

  keyDown(e: ToolKeyEvent): boolean {
    if (e.key === 'Shift' || e.key === 'Alt') return true;
    const path = this.path;
    if (!path || e.ctrlKey || e.metaKey) return false;
    if (e.key === 'Escape') {
      this.cancel();
      return true;
    }
    if (!this.polygonal || this.drawing) return false;
    switch (e.key) {
      case 'Enter':
        this.close();
        return true;
      case 'Backspace':
      case 'Delete':
        this.removeLastPoint(path);
        return true;
      default:
        return false;
    }
  }

  keyUp(e: ToolKeyEvent): boolean {
    if (e.key === 'Shift') return true;
    if (e.key !== 'Alt') return false;
    const path = this.path;
    if (path) {
      this.trackModifiers(path, e);
      if (this.polygonal && !this.drawing) this.close();
    }
    return true;
  }

  protected rubberBand(path: LassoPath): Point | null {
    return this.polygonal && !this.drawing ? path.pointer : null;
  }

  protected closing(path: LassoPath): boolean {
    const first = path.points[0];
    return (
      this.polygonal &&
      first !== undefined &&
      path.points.length >= 3 &&
      within(path.pointer, first, CLOSE_REACH, path.zoom)
    );
  }

  protected override reset(): void {
    this.drawing = false;
    this.polygonal = false;
  }
}
