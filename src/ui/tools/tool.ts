import type { ComponentType } from 'react';
import type { Affine, Editor, Interpolation, LayerId, PixelBuffer, Point, Rect } from '../../core';
import type { ContextMenuSections } from '../panels/menu-logic';

/**
 * Tool shortcut keys. Tools that share a key form a group (e.g. the marquees): the key
 * selects the group's last-used tool and Shift+key cycles through the group. Keys of
 * tools that don't exist yet are listed so nothing else claims them.
 */
export const TOOL_KEYS = {
  marquee: 'M',
  move: 'V',
  brush: 'B',
  eraser: 'E',
  bucket: 'G',
  eyedropper: 'I',
  lasso: 'L',
  wand: 'W',
  text: 'T',
  crop: 'C',
} as const;

export type ToolKey = (typeof TOOL_KEYS)[keyof typeof TOOL_KEYS];

/** Pointer travel in CSS pixels below which a press is a click rather than a drag. */
export const CLICK_TOLERANCE = 3;

export interface ToolModifiers {
  readonly shiftKey: boolean;
  readonly altKey: boolean;
  readonly ctrlKey: boolean;
  readonly metaKey: boolean;
}

/** A position the pointer passed through, in document space. */
export interface ToolPointerSample {
  readonly x: number;
  readonly y: number;
  /** Pen pressure, 0–1. Absent for mice and touch. */
  readonly pressure?: number;
}

/** A pointer event mapped into document space. */
export interface ToolPointerEvent extends ToolModifiers {
  /**
   * Document coordinates, fractional: pixel (px, py) spans [px, px + 1) × [py, py + 1).
   * May lie outside the canvas.
   */
  readonly x: number;
  readonly y: number;
  /** CSS pixels per document pixel, for thresholds measured on screen. */
  readonly zoom: number;
  /**
   * For a press, the button: 0 primary (the default), 1 middle, 2 secondary. The
   * `ToolManager` passes tools primary presses only, so the other buttons never start a
   * gesture or count as a click.
   */
  readonly button?: number;
  /** Pen pressure, 0–1. Absent for mice and touch. */
  readonly pressure?: number;
  /**
   * Every position a move passed through since the previous event, oldest first and
   * ending at (x, y), when the browser reported more than one (coalesced events).
   */
  readonly samples?: readonly ToolPointerSample[];
}

export interface ToolKeyEvent extends ToolModifiers {
  readonly key: string;
  readonly code: string;
  readonly repeat: boolean;
}

/** A marquee shape being dragged, drawn as marching ants. */
export interface ShapeOverlay {
  readonly shape: 'rect' | 'ellipse';
  readonly rect: Rect;
  /** Hide the current selection's outline while this shape is shown (it will replace it). */
  readonly hidesSelection?: boolean;
}

/**
 * A painting tool's outline: a circle `diameter` pixels across, centred on (x, y). The
 * viewport shows it, or a crosshair when it would be tiny on screen, only while the
 * pointer is over the canvas.
 */
export interface BrushOverlay {
  readonly shape: 'brush';
  readonly x: number;
  readonly y: number;
  readonly diameter: number;
}

/**
 * The Crop tool's box, with handles; everything outside it is dimmed, unless it's the
 * whole canvas. It may extend past the canvas.
 */
export interface CropOverlay {
  readonly shape: 'crop';
  readonly rect: Rect;
  /** Show a rule-of-thirds grid inside the box (while it's being adjusted). */
  readonly grid: boolean;
  /** Dim everything outside the box: false while it's the whole canvas. */
  readonly shade: boolean;
}

/**
 * A lasso being drawn, as marching ants: the points placed so far joined in order, and a
 * rubber band from the last of them to `next`, where the next vertex would go. `closing`
 * rings the first point: a click would close the polygon there.
 */
export interface LassoOverlay {
  readonly shape: 'lasso';
  readonly points: readonly Point[];
  readonly next: Point | null;
  readonly closing: boolean;
  /** Hide the current selection's outline while this is shown (it will replace it). */
  readonly hidesSelection?: boolean;
}

/**
 * A Free Transform session's preview: the layer's pixels as they were (`pixels`, with its
 * top-left pixel at `x`, `y`) mapped through `affine`, drawn in the layer's place while the
 * composite leaves the layer out, and the transformed box with its handles.
 */
export interface TransformOverlay {
  readonly shape: 'transform';
  /** The layer being transformed. */
  readonly layerId: LayerId;
  readonly pixels: PixelBuffer;
  readonly x: number;
  readonly y: number;
  /** Canvas coordinates to canvas coordinates, as `TransformLayerCommand` takes it. */
  readonly affine: Affine;
  readonly interpolation: Interpolation;
  /** The layer's opacity, which the preview is drawn with. */
  readonly opacity: number;
  /** Where the layer's top-left, top-right, bottom-right and bottom-left corners go. */
  readonly corners: readonly [Point, Point, Point, Point];
  /** The point the transform scales and turns about, where it is now. */
  readonly pivot: Point;
}

/**
 * What the viewport draws over the document for the active tool. Plain data in document
 * coordinates, so tools stay free of canvas APIs.
 */
export type ToolOverlay =
  ShapeOverlay | LassoOverlay | BrushOverlay | CropOverlay | TransformOverlay;

/** What `[` and `]` step: a brush's size, or with Shift its hardness. */
export type BrushProperty = 'size' | 'hardness';

/** What a tool, or a session, gets from the `ToolManager` when it becomes active. */
export interface ToolContext {
  readonly editor: Editor;
  /** Call whenever `overlay` or `cursor` changes so the viewport redraws them. */
  overlayChanged(): void;
  /** Shows `text` briefly in the status bar, e.g. a brush size changed from the keyboard. */
  showMessage(text: string): void;
}

/**
 * What takes the canvas's input: the active tool, or a session that takes over from it
 * for a while. It's UI: it turns pointer and key input into core Commands run through
 * `editor.history`, and never mutates the document directly.
 *
 * The viewport routes input to it through the `ToolManager`; panning and zooming take
 * priority, so it only sees input the viewport doesn't use itself. Pointer handlers only
 * run for the primary button; moves are also forwarded while no button is down (hover). A
 * right-click (or a Control-click on a Mac) opens the canvas's context menu instead.
 */
export interface ToolInput {
  /** CSS cursor over the canvas while this is active. Report changes via `overlayChanged`. */
  readonly cursor: string;
  /** Settings shown in the tool-options bar while this is active. */
  readonly OptionsPanel?: ComponentType | undefined;
  /** Shape to draw over the document now, if any. Report changes via `overlayChanged`. */
  readonly overlay?: ToolOverlay | null;

  /** It became active. Keep `context` for later handlers. */
  activate?(context: ToolContext): void;
  /** It's no longer active. Any gesture has already been cancelled. */
  deactivate?(): void;

  pointerDown?(event: ToolPointerEvent): void;
  pointerMove?(event: ToolPointerEvent): void;
  pointerUp?(event: ToolPointerEvent): void;
  /** A double-click with the primary button, after the two presses and releases it ends. */
  doubleClick?(event: ToolPointerEvent): void;
  /**
   * Abandon any gesture in progress without committing it: the pointer was cancelled,
   * Escape was pressed, the window lost focus, or the tool or document is changing.
   */
  cancel?(): void;

  /** Return true if the key was used, so the viewport suppresses its default action. */
  keyDown?(event: ToolKeyEvent): boolean;
  keyUp?(event: ToolKeyEvent): boolean;

  /**
   * Items it adds to the canvas's context menu, above the standard ones; asked each time
   * the menu is drawn.
   */
  contextMenu?(): ContextMenuSections;
}

/** An editing tool, chosen in the toolbar or with its shortcut key. */
export interface Tool extends ToolInput {
  /** Stable identifier, e.g. 'rect-marquee'. */
  readonly id: string;
  /** Display name, e.g. 'Rectangular Marquee'. */
  readonly name: string;
  readonly shortcut: ToolKey;

  /** Painting tools: `[` / `]` (with Shift, hardness) step the brush down or up. */
  stepBrush?(property: BrushProperty, direction: -1 | 1): void;
}

/**
 * Something that takes over the canvas's input from the active tool for a while, such as
 * a Free Transform session, without becoming the active tool (`ToolManager.startSession`).
 * Its options and name replace the tool's in the options bar meanwhile.
 */
export interface ToolSession extends ToolInput {
  readonly name: string;
}
