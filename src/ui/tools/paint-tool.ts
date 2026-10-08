import type { ComponentType } from 'react';
import type {
  Dab,
  Editor,
  ImageDocument,
  PaintStroke,
  Rgb,
  StrokeSample,
  StrokeStyle,
} from '../../core';
import { beginStroke, DabPlacer, strokeCommand } from '../../core';
import type { Colors } from '../color/colors';
import type { BrushOptions } from './brush-options';
import type { EyedropperOptions } from './eyedropper-options';
import { EYEDROPPER_CURSOR, pickColor } from './eyedropper-tool';
import type { FrameClock } from './frame-clock';
import { browserClock } from './frame-clock';
import type {
  BrushOverlay,
  BrushProperty,
  Tool,
  ToolContext,
  ToolKey,
  ToolKeyEvent,
  ToolPointerEvent,
  ToolPointerSample,
} from './tool';
import { TOOL_KEYS } from './tool';

/** What a painting tool does under its brush: lay down colour, or erase. */
export type PaintMode = StrokeStyle['mode'];

interface ActiveStroke {
  readonly document: ImageDocument;
  readonly stroke: PaintStroke;
  readonly placer: DabPlacer;
  /** Pointer positions that arrived since the stroke last painted. */
  readonly pending: StrokeSample[];
  /**
   * `history.stateId` after the stroke's latest step, or at the press before its first.
   * If it moves, something else changed the document, and the stroke ends.
   */
  stateId: number;
  /** True once the stroke has a step in history. */
  painted: boolean;
}

/** Where the last stroke ended: a Shift-click draws a straight line from there. */
interface StrokeEnd {
  readonly document: ImageDocument;
  readonly x: number;
  readonly y: number;
}

/**
 * The Brush and the Eraser: they paint the active layer with the foreground colour, or
 * erase it to transparent, through the core stroke engine (`beginStroke`). Each press to
 * release is one stroke and one undo step; while the pointer moves, the positions that
 * arrived (coalesced events included) are painted once per animation frame. Escape
 * undoes the stroke. Shift-click draws a straight line from where the last stroke ended.
 *
 * With Alt held the tool samples the foreground colour instead, like the eyedropper (and
 * with its options). `[` and `]` step the brush size, Shift+`[` and Shift+`]` its hardness.
 * The brush's outline follows the pointer on the viewport's overlay.
 */
export class PaintTool implements Tool {
  readonly id: string;
  readonly name: string;
  readonly shortcut: ToolKey;
  private context: ToolContext | null = null;
  private unsubscribeOptions: (() => void) | null = null;
  private stroke: ActiveStroke | null = null;
  /** An Alt-press colour pick in progress, and the foreground colour from before it. */
  private picking: { readonly before: Rgb } | null = null;
  private frame: number | null = null;
  private lastEnd: StrokeEnd | null = null;
  /** The pointer's latest position, in document space; null until the tool hears of it. */
  private pointer: { readonly x: number; readonly y: number } | null = null;
  /** Pressure for positions reported without one: the pen's latest, or 1 for a mouse. */
  private pressure = 1;
  private altHeld = false;

  constructor(
    readonly mode: PaintMode,
    readonly options: BrushOptions,
    private readonly colors: Colors,
    private readonly eyedropper: EyedropperOptions,
    readonly OptionsPanel?: ComponentType,
    private readonly clock: FrameClock = browserClock,
  ) {
    this.id = mode === 'paint' ? 'brush' : 'eraser';
    this.name = mode === 'paint' ? 'Brush' : 'Eraser';
    this.shortcut = mode === 'paint' ? TOOL_KEYS.brush : TOOL_KEYS.eraser;
  }

  /** The pointer shows the eyedropper, or nothing: the overlay draws the brush instead. */
  get cursor(): string {
    if (this.sampling) return EYEDROPPER_CURSOR;
    return this.pointer ? 'none' : 'crosshair';
  }

  get overlay(): BrushOverlay | null {
    if (!this.pointer || this.sampling) return null;
    const { x, y } = this.pointer;
    return { shape: 'brush', x, y, diameter: this.options.settings.size };
  }

  activate(context: ToolContext): void {
    this.context = context;
    this.unsubscribeOptions = this.options.subscribe(() => context.overlayChanged());
  }

  deactivate(): void {
    this.unsubscribeOptions?.();
    this.unsubscribeOptions = null;
    this.context = null;
    this.pointer = null;
    this.altHeld = false;
  }

  pointerDown(e: ToolPointerEvent): void {
    const editor = this.context?.editor;
    if (editor && e.altKey) {
      this.picking = { before: this.colors.foreground };
      this.pick(editor, e);
    } else if (editor) {
      this.begin(editor, e);
    }
    this.track(e);
  }

  pointerMove(e: ToolPointerEvent): void {
    const stroke = this.stroke;
    const editor = this.context?.editor;
    if (stroke) {
      for (const sample of e.samples ?? [e]) stroke.pending.push(this.strokeSample(sample));
      // Before `track` redraws the outline, so that this frame's paint lands before the
      // viewport draws it.
      this.frame ??= this.clock.requestFrame(this.onFrame);
    } else if (this.picking && editor) {
      this.pick(editor, e);
    }
    this.track(e);
  }

  pointerUp(e: ToolPointerEvent): void {
    const stroke = this.stroke;
    const editor = this.context?.editor;
    if (stroke) {
      stroke.pending.push(this.strokeSample(e));
      this.cancelFrame();
      this.paint(stroke);
      const end = stroke.placer.position;
      // Unless it was abandoned while painting.
      if (this.stroke === stroke && end) {
        this.lastEnd = { document: stroke.document, x: end.x, y: end.y };
      }
      this.stroke = null;
    } else if (this.picking && editor) {
      this.pick(editor, e);
    }
    this.picking = null;
    this.track(e);
  }

  /** Undoes the stroke in progress (it stays redoable), or puts back a picked colour. */
  cancel(): void {
    if (this.picking) this.colors.set('foreground', this.picking.before);
    this.picking = null;
    const stroke = this.stroke;
    this.stroke = null;
    this.cancelFrame();
    const editor = this.context?.editor;
    if (
      stroke?.painted &&
      editor?.document === stroke.document &&
      // Unless something else changed the document since.
      editor.history.stateId === stroke.stateId
    ) {
      editor.history.undo();
    }
    this.context?.overlayChanged();
  }

  /** Alt turns the tool into an eyedropper while held. Claimed, so it opens no browser menus. */
  keyDown(e: ToolKeyEvent): boolean {
    if (e.key !== 'Alt') return false;
    this.setAltHeld(true);
    return true;
  }

  keyUp(e: ToolKeyEvent): boolean {
    if (e.key !== 'Alt') return false;
    this.setAltHeld(false);
    return true;
  }

  stepBrush(property: BrushProperty, direction: -1 | 1): void {
    if (property === 'size') {
      this.context?.showMessage(`Size: ${this.options.stepSize(direction)} px`);
    } else {
      this.context?.showMessage(`Hardness: ${this.options.stepHardness(direction)}%`);
    }
  }

  /** Alt samples colours, except during a stroke, which carries on painting. */
  private get sampling(): boolean {
    return this.picking !== null || (this.altHeld && this.stroke === null);
  }

  private begin(editor: Editor, e: ToolPointerEvent): void {
    const layer = editor.activeLayer;
    if (!layer) return;
    if (!layer.visible) {
      this.context?.showMessage('The active layer is hidden');
      return;
    }
    const settings = this.options.settings;
    const doc = editor.document;
    const style: StrokeStyle = {
      mode: this.mode,
      color: this.colors.foreground,
      opacity: settings.opacity / 100,
      hardness: settings.hardness / 100,
    };
    const stroke = beginStroke(doc, layer.id, style, editor.floating);
    if (!stroke) return;
    const active: ActiveStroke = {
      document: doc,
      stroke,
      placer: new DabPlacer(settings.size, settings.pressure ? settings.pressureTarget : null),
      pending: [],
      stateId: editor.history.stateId,
      painted: false,
    };
    this.pressure = e.pressure ?? 1;
    const start = this.strokeSample(e);
    const end = this.lastEnd;
    if (e.shiftKey && end?.document === doc) {
      active.pending.push({ x: end.x, y: end.y, pressure: start.pressure });
    }
    active.pending.push(start);
    this.stroke = active;
    this.paint(active);
  }

  private readonly onFrame = (): void => {
    this.frame = null;
    if (this.stroke) this.paint(this.stroke);
  };

  /** Paints the positions that arrived since the last frame, as one more step of the stroke. */
  private paint(stroke: ActiveStroke): void {
    const editor = this.context?.editor;
    if (
      !editor ||
      editor.document !== stroke.document ||
      editor.history.stateId !== stroke.stateId ||
      editor.document.selection !== stroke.stroke.selection
    ) {
      // Something else changed the document mid-stroke (an undo, a selection change, a new
      // document), so the stroke can't carry on as the same undo step: it ends here.
      this.stroke = null;
      this.cancelFrame();
      return;
    }
    const dabs: Dab[] = [];
    for (const sample of stroke.pending) stroke.placer.add(sample, dabs);
    stroke.pending.length = 0;
    const command = strokeCommand(stroke.stroke, dabs);
    if (!command) return;
    editor.history.execute(command);
    stroke.stateId = editor.history.stateId;
    stroke.painted = true;
  }

  private pick(editor: Editor, e: ToolPointerEvent): void {
    const color = pickColor(editor, e.x, e.y, this.eyedropper.source);
    if (color) this.colors.set('foreground', color);
  }

  private strokeSample(sample: ToolPointerSample): StrokeSample {
    if (sample.pressure !== undefined) this.pressure = sample.pressure;
    return { x: sample.x, y: sample.y, pressure: this.pressure };
  }

  /** Moves the outline to the pointer, and follows Alt as pointer events report it. */
  private track(e: ToolPointerEvent): void {
    this.pointer = { x: e.x, y: e.y };
    this.altHeld = e.altKey;
    this.context?.overlayChanged();
  }

  private setAltHeld(held: boolean): void {
    if (held === this.altHeld) return;
    this.altHeld = held;
    this.context?.overlayChanged();
  }

  private cancelFrame(): void {
    if (this.frame === null) return;
    this.clock.cancelFrame(this.frame);
    this.frame = null;
  }
}
