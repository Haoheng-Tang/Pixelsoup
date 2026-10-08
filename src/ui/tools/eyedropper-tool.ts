import type { ComponentType } from 'react';
import type { Editor, Rgb } from '../../core';
import { sampleColor } from '../../core';
import type { ColorSlot, Colors } from '../color/colors';
import type { EyedropperOptions, SampleSource } from './eyedropper-options';
import type { Tool, ToolContext, ToolKeyEvent, ToolPointerEvent } from './tool';
import { TOOL_KEYS } from './tool';

const CURSOR_SVG =
  "<svg xmlns='http://www.w3.org/2000/svg' width='24' height='24'>" +
  "<path d='M3 21 14 10' stroke='#000' stroke-width='5' stroke-linecap='round'/>" +
  "<path d='M3 21 14 10' stroke='#fff' stroke-width='2.4' stroke-linecap='round'/>" +
  "<path d='m11.5 8.5 4 4' stroke='#000' stroke-width='3.4' stroke-linecap='round'/>" +
  "<path d='m14 10 5.5-5.5a2.1 2.1 0 0 0-3-3L11 7z' fill='#000' stroke='#fff' stroke-width='1'/>" +
  '</svg>';

/** A pipette whose tip, at the bottom left, is the hot spot. */
export const EYEDROPPER_CURSOR = `url("data:image/svg+xml,${encodeURIComponent(CURSOR_SVG)}") 2 21, crosshair`;

/**
 * The colour of the document pixel under (x, y), from the composite or the active layer
 * alone. Null where there's nothing to pick: off the canvas, or a transparent pixel.
 */
export function pickColor(editor: Editor, x: number, y: number, source: SampleSource): Rgb | null {
  const px = Math.floor(x);
  const py = Math.floor(y);
  if (source === 'composite') return sampleColor(editor.document, px, py, 'composite');
  const layerId = editor.activeLayerId;
  return layerId === null ? null : sampleColor(editor.document, px, py, { layerId });
}

/**
 * Picks colours from the document. Pressing and dragging sets the foreground colour to the
 * pixel under the pointer, or the background colour with Alt held at the press. Samples
 * the composite or the active layer (`EyedropperOptions`); transparent pixels pick
 * nothing. Colours are session state, so picking is never an undo step. Escape mid-drag
 * puts back the colour from before the press.
 */
export class EyedropperTool implements Tool {
  readonly id = 'eyedropper';
  readonly name = 'Eyedropper';
  readonly shortcut = TOOL_KEYS.eyedropper;
  readonly cursor = EYEDROPPER_CURSOR;
  private context: ToolContext | null = null;
  private picking: { readonly slot: ColorSlot; readonly before: Rgb } | null = null;

  constructor(
    private readonly colors: Colors,
    readonly options: EyedropperOptions,
    readonly OptionsPanel?: ComponentType,
  ) {}

  activate(context: ToolContext): void {
    this.context = context;
  }

  deactivate(): void {
    this.context = null;
  }

  pointerDown(e: ToolPointerEvent): void {
    const slot = e.altKey ? 'background' : 'foreground';
    this.picking = { slot, before: this.colors.get(slot) };
    this.pick(e);
  }

  pointerMove(e: ToolPointerEvent): void {
    this.pick(e);
  }

  pointerUp(e: ToolPointerEvent): void {
    this.pick(e);
    this.picking = null;
  }

  cancel(): void {
    if (!this.picking) return;
    this.colors.set(this.picking.slot, this.picking.before);
    this.picking = null;
  }

  /** Alt is claimed, so that it doesn't open browser menus. */
  keyDown(e: ToolKeyEvent): boolean {
    return e.key === 'Alt';
  }

  keyUp(e: ToolKeyEvent): boolean {
    return e.key === 'Alt';
  }

  private pick(e: ToolPointerEvent): void {
    const editor = this.context?.editor;
    if (!editor || !this.picking) return;
    const color = pickColor(editor, e.x, e.y, this.options.source);
    if (color) this.colors.set(this.picking.slot, color);
  }
}
