import type { ComponentType } from 'react';
import type { Editor, FloatingSelection, ImageDocument, LayerId } from '../../core';
import { findLayer, liftSelectionCommand, moveLayerCommand } from '../../core';
import type { FrameClock } from './frame-clock';
import { browserClock } from './frame-clock';
import { NudgeGrouper, nudgeOffset } from './nudge';
import type { Tool, ToolContext, ToolKeyEvent, ToolPointerEvent } from './tool';
import { CLICK_TOLERANCE, TOOL_KEYS } from './tool';

/** A layer a drag or nudge moves, and where it was when the gesture took hold of it. */
interface MoveTarget {
  readonly layerId: LayerId;
  readonly x: number;
  readonly y: number;
  /** Set when the layer is a floating selection, whose outline moves along with it. */
  readonly floating: FloatingSelection | null;
}

interface MoveDrag {
  readonly document: ImageDocument;
  /** The press, in document coordinates. */
  readonly startX: number;
  readonly startY: number;
  /** Alt held at the press: copy the selected pixels instead of cutting them out. */
  readonly copy: boolean;
  /** Every move of one drag shares this key, so that the drag is one undo step. */
  readonly mergeKey: string;
  /** Latest pointer position, document coordinates. */
  x: number;
  y: number;
  shiftKey: boolean;
  /** What the drag moves; null until the pointer has travelled past the click tolerance. */
  target: MoveTarget | null;
  /**
   * `history.stateId` after each undo step the drag added (a commit, a lift, then the
   * move), oldest first, so that cancelling can undo them.
   */
  readonly steps: number[];
  /** True once the last of `steps` is the drag's move, which later moves merge into. */
  moved: boolean;
}

// Shared by every Move tool, so that two drags never share a merge key.
let drags = 0;

/**
 * Moves the active layer, or the selected pixels.
 *
 * Without a selection, dragging moves the active layer. With one, the first drag or nudge
 * lifts the selected pixels out of the active layer into a floating selection (Alt copies
 * them instead), which later drags and nudges move along with its outline until it's
 * committed (see `Editor.floating`). Alt+dragging a floating selection commits it and
 * drags a copy.
 *
 * Shift keeps a drag to the axis it has moved furthest along. Arrow keys nudge by 1 px,
 * 10 with Shift. A drag is one undo step, and so is a quick run of nudges. While dragging,
 * at most one move per animation frame goes through history, so the viewport and the
 * thumbnails follow it through the usual change events.
 */
export class MoveTool implements Tool {
  readonly id = 'move';
  readonly name = 'Move';
  readonly shortcut = TOOL_KEYS.move;
  readonly cursor = 'move';
  private context: ToolContext | null = null;
  private drag: MoveDrag | null = null;
  private frame: number | null = null;
  private readonly nudges = new NudgeGrouper();

  constructor(
    readonly OptionsPanel?: ComponentType,
    private readonly clock: FrameClock = browserClock,
  ) {}

  activate(context: ToolContext): void {
    this.context = context;
    this.nudges.reset();
  }

  /** Switching to another tool commits a floating selection. */
  deactivate(): void {
    this.context?.editor.commitFloating();
    this.context = null;
  }

  pointerDown(e: ToolPointerEvent): void {
    if (!this.context) return;
    this.nudges.reset();
    this.drag = {
      document: this.context.editor.document,
      startX: e.x,
      startY: e.y,
      copy: e.altKey,
      mergeKey: `move:${++drags}`,
      x: e.x,
      y: e.y,
      shiftKey: e.shiftKey,
      target: null,
      steps: [],
      moved: false,
    };
  }

  pointerMove(e: ToolPointerEvent): void {
    const drag = this.drag;
    if (!drag) return;
    drag.x = e.x;
    drag.y = e.y;
    drag.shiftKey = e.shiftKey;
    if (!drag.target && !this.takeHold(drag, e.zoom)) return;
    this.frame ??= this.clock.requestFrame(this.onFrame);
  }

  pointerUp(e: ToolPointerEvent): void {
    this.pointerMove(e);
    this.cancelFrame();
    if (this.drag) this.moveDrag(this.drag);
    this.drag = null;
  }

  /** Puts back everything the drag did: the move, and any lift or commit it started with. */
  cancel(): void {
    const drag = this.drag;
    if (!drag) return;
    this.drag = null;
    this.cancelFrame();
    const editor = this.context?.editor;
    if (!editor || editor.document !== drag.document) return;
    for (const state of drag.steps.reverse()) {
      // Something else changed the document since: leave the rest alone.
      if (editor.history.stateId !== state) return;
      editor.history.undo();
    }
  }

  keyDown(e: ToolKeyEvent): boolean {
    if (e.key === 'Shift' || e.key === 'Alt') return this.modifierChanged(e);
    const offset = nudgeOffset(e.key, e.shiftKey);
    if (!offset || e.ctrlKey || e.metaKey) return false;
    if (!this.drag) this.nudge(offset.dx, offset.dy, e.altKey);
    return true;
  }

  keyUp(e: ToolKeyEvent): boolean {
    return e.key === 'Shift' || e.key === 'Alt' ? this.modifierChanged(e) : false;
  }

  /** Shift changes a drag's constraint. Alt is claimed too, so it doesn't open browser menus. */
  private modifierChanged(e: ToolKeyEvent): boolean {
    const drag = this.drag;
    if (drag) {
      drag.shiftKey = e.shiftKey;
      if (drag.target) this.frame ??= this.clock.requestFrame(this.onFrame);
    }
    return true;
  }

  /**
   * Takes hold of what the drag moves once the pointer has travelled past the click
   * tolerance. Returns false until then, or if there's nothing to move, which ends the drag.
   */
  private takeHold(drag: MoveDrag, zoom: number): boolean {
    const travel = Math.hypot(drag.x - drag.startX, drag.y - drag.startY) * zoom;
    if (travel < CLICK_TOLERANCE) return false;
    const editor = this.context?.editor;
    const target =
      editor?.document === drag.document ? this.takeTarget(editor, drag.copy, drag.steps) : null;
    if (!target) {
      this.drag = null;
      return false;
    }
    drag.target = target;
    return true;
  }

  /**
   * What a drag or nudge starting now moves: the floating selection; else the active
   * layer's selected pixels, lifted (with `copy`, copied) into a floating selection now;
   * else, with nothing selected, the active layer. With `copy`, a floating selection is
   * committed first and a copy of it lifted. Records the steps it adds in `steps`. Null
   * if there's nothing to move: no active layer, a hidden one, or a selection that misses
   * it.
   */
  private takeTarget(editor: Editor, copy: boolean, steps: number[]): MoveTarget | null {
    const { history } = editor;
    const stamp = copy && editor.floating !== null;
    if (stamp && editor.commitFloating()) steps.push(history.stateId);
    if (!editor.floating) {
      const doc = editor.document;
      const layer = editor.activeLayer;
      if (!layer?.visible) return null;
      if (!doc.selection) {
        return stamp ? null : { layerId: layer.id, x: layer.x, y: layer.y, floating: null };
      }
      const lift = liftSelectionCommand(doc, layer.id, copy);
      if (!lift) return null;
      history.execute(lift);
      steps.push(history.stateId);
    }
    const floating = editor.floating;
    const layer = floating && findLayer(editor.document, floating.layerId);
    return layer ? { layerId: layer.id, x: layer.x, y: layer.y, floating } : null;
  }

  private readonly onFrame = (): void => {
    this.frame = null;
    if (this.drag) this.moveDrag(this.drag);
  };

  /** Moves the drag's target to follow the pointer. */
  private moveDrag(drag: MoveDrag): void {
    const editor = this.context?.editor;
    const target = drag.target;
    if (!editor || !target) return;
    if (editor.document !== drag.document || !findLayer(drag.document, target.layerId)) {
      // The document or the layer went away (replaced, committed, undone): let go.
      this.drag = null;
      return;
    }
    let dx = drag.x - drag.startX;
    let dy = drag.y - drag.startY;
    if (drag.shiftKey) {
      if (Math.abs(dx) >= Math.abs(dy)) dy = 0;
      else dx = 0;
    }
    const x = target.x + Math.round(dx);
    const y = target.y + Math.round(dy);
    if (!this.moveTo(editor, target, x, y, drag.mergeKey, 'Move')) return;
    if (drag.moved) drag.steps[drag.steps.length - 1] = editor.history.stateId;
    else drag.steps.push(editor.history.stateId);
    drag.moved = true;
  }

  private nudge(dx: number, dy: number, copy: boolean): void {
    const editor = this.context?.editor;
    const target = editor && this.takeTarget(editor, copy, []);
    if (!editor || !target) return;
    const mergeKey = this.nudges.keyAt(this.clock.now());
    this.moveTo(editor, target, target.x + dx, target.y + dy, mergeKey, 'Nudge');
  }

  /**
   * Moves the target to (x, y), and a floating selection's outline along with it, as a
   * step merged by `mergeKey`. Returns false if that would change nothing.
   */
  private moveTo(
    editor: Editor,
    target: MoveTarget,
    x: number,
    y: number,
    mergeKey: string,
    verb: 'Move' | 'Nudge',
  ): boolean {
    const { floating } = target;
    const command = moveLayerCommand(editor.document, target.layerId, x, y, {
      label: `${verb} ${floating ? 'Selection' : 'Layer'}`,
      mergeKey,
      // Always from the selection as lifted, so that moving back restores it exactly.
      ...(floating && { selection: floating.selection.translate(x - floating.x, y - floating.y) }),
    });
    if (!command) return false;
    editor.history.execute(command);
    return true;
  }

  private cancelFrame(): void {
    if (this.frame === null) return;
    this.clock.cancelFrame(this.frame);
    this.frame = null;
  }
}
