import type { ComponentType } from 'react';
import type { Editor, Rect } from '../../core';

/**
 * Tool shortcut keys. Tools that share a key form a group (e.g. the marquees): the key
 * selects the group's last-used tool and Shift+key cycles through the group. Keys of
 * tools that don't exist yet are listed so nothing else claims them.
 */
export const TOOL_KEYS = {
  marquee: 'M',
  move: 'V',
  brush: 'B',
  lasso: 'L',
  wand: 'W',
  text: 'T',
  crop: 'C',
} as const;

export type ToolKey = (typeof TOOL_KEYS)[keyof typeof TOOL_KEYS];

export interface ToolModifiers {
  readonly shiftKey: boolean;
  readonly altKey: boolean;
  readonly ctrlKey: boolean;
  readonly metaKey: boolean;
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
}

export interface ToolKeyEvent extends ToolModifiers {
  readonly key: string;
  readonly code: string;
  readonly repeat: boolean;
}

/**
 * A shape the viewport draws over the document for the active tool, such as a marquee
 * being dragged. Plain data in document coordinates, so tools stay free of canvas APIs.
 */
export interface ToolOverlay {
  readonly shape: 'rect' | 'ellipse';
  readonly rect: Rect;
  /** Hide the current selection's outline while this shape is shown (it will replace it). */
  readonly hidesSelection?: boolean;
}

/** What a tool gets from the `ToolManager` when it becomes active. */
export interface ToolContext {
  readonly editor: Editor;
  /** Call whenever `overlay` changes so the viewport redraws it. */
  overlayChanged(): void;
}

/**
 * An editing tool. Tools are UI: they turn pointer and key input into core Commands run
 * through `editor.history`, and never mutate the document directly.
 *
 * The viewport routes input to the active tool through the `ToolManager`; panning and
 * zooming take priority, so tools only see input the viewport doesn't use itself.
 * Pointer handlers only run for the primary button; moves are also forwarded while no
 * button is down (hover).
 */
export interface Tool {
  /** Stable identifier, e.g. 'rect-marquee'. */
  readonly id: string;
  /** Display name, e.g. 'Rectangular Marquee'. */
  readonly name: string;
  readonly shortcut: ToolKey;
  /** CSS cursor over the canvas while this tool is active. */
  readonly cursor: string;
  /** Settings shown in the tool-options bar while this tool is active. */
  readonly OptionsPanel?: ComponentType | undefined;
  /** Shape to draw over the document now, if any. Report changes via `overlayChanged`. */
  readonly overlay?: ToolOverlay | null;

  /** The tool became active. Keep `context` for later handlers. */
  activate?(context: ToolContext): void;
  /** The tool is no longer active. Any gesture has already been cancelled. */
  deactivate?(): void;

  pointerDown?(event: ToolPointerEvent): void;
  pointerMove?(event: ToolPointerEvent): void;
  pointerUp?(event: ToolPointerEvent): void;
  /**
   * Abandon any gesture in progress without committing it: the pointer was cancelled,
   * Escape was pressed, the window lost focus, or the tool or document is changing.
   */
  cancel?(): void;

  /** Return true if the key was used, so the viewport suppresses its default action. */
  keyDown?(event: ToolKeyEvent): boolean;
  keyUp?(event: ToolKeyEvent): boolean;
}
