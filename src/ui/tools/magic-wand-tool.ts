import type { ComponentType } from 'react';
import type { RegionOptions } from './region-options';
import { regionAt } from './region-options';
import type { SelectionOptions } from './selection-options';
import { applySelection, pressMode } from './selection-tool';
import type { Tool, ToolContext, ToolKeyEvent, ToolPointerEvent } from './tool';
import { TOOL_KEYS } from './tool';

const CURSOR_SVG =
  "<svg xmlns='http://www.w3.org/2000/svg' width='24' height='24'>" +
  "<path d='M10 10 21 21' stroke='#000' stroke-width='5' stroke-linecap='round'/>" +
  "<path d='M10 10 21 21' stroke='#fff' stroke-width='2.4' stroke-linecap='round'/>" +
  "<path d='M5 1v8M1 5h8M2.5 2.5l5 5M7.5 2.5l-5 5' stroke='#000' stroke-width='3' stroke-linecap='round'/>" +
  "<path d='M5 1.5v7M1.5 5h7' stroke='#fff' stroke-width='1.2' stroke-linecap='round'/>" +
  '</svg>';

/** A wand with a sparkle at its tip, which is the hot spot. */
export const MAGIC_WAND_CURSOR = `url("data:image/svg+xml,${encodeURIComponent(CURSOR_SVG)}") 5 5, crosshair`;

/**
 * The Magic Wand: a click selects the pixels whose colours match the one clicked
 * (`regionAt`, as the options bar sets it), combined with the selection like a marquee's
 * shape: in the options bar's mode, or with a selection Shift adds, Alt subtracts and both
 * intersect. A click off the canvas deselects in New mode. One undo step per click, after
 * dropping a floating selection back into its layer, so the wand sees the merged pixels.
 */
export class MagicWandTool implements Tool {
  readonly id = 'magic-wand';
  readonly name = 'Magic Wand';
  readonly shortcut = TOOL_KEYS.wand;
  readonly cursor = MAGIC_WAND_CURSOR;
  private context: ToolContext | null = null;

  constructor(
    private readonly selectionOptions: SelectionOptions,
    readonly options: RegionOptions,
    readonly OptionsPanel?: ComponentType,
  ) {}

  activate(context: ToolContext): void {
    this.context = context;
  }

  deactivate(): void {
    this.context = null;
  }

  pointerDown(e: ToolPointerEvent): void {
    const editor = this.context?.editor;
    if (!editor) return;
    const { mode } = pressMode(editor, e, this.selectionOptions);
    const doc = editor.document;
    const onCanvas = e.x >= 0 && e.y >= 0 && e.x < doc.width && e.y < doc.height;
    if (onCanvas) editor.commitFloating();
    const region = onCanvas ? regionAt(editor, e.x, e.y, this.options.settings) : null;
    applySelection(editor, region, mode, this.name);
  }

  /** Alt is claimed, so that it doesn't open browser menus. */
  keyDown(e: ToolKeyEvent): boolean {
    return e.key === 'Alt';
  }

  keyUp(e: ToolKeyEvent): boolean {
    return e.key === 'Alt';
  }
}
