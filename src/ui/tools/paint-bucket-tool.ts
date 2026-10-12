import type { ComponentType } from 'react';
import { fillCommand } from '../../core';
import type { Colors } from '../color/colors';
import type { RegionOptions } from './region-options';
import { regionAt } from './region-options';
import type { Tool, ToolContext, ToolPointerEvent } from './tool';
import { TOOL_KEYS } from './tool';

const CURSOR_SVG =
  "<svg xmlns='http://www.w3.org/2000/svg' width='24' height='24'>" +
  "<path d='M7 10 13.5 3.5 21 11l-6.5 6.5z' fill='#fff' stroke='#000' stroke-width='1.5' stroke-linejoin='round'/>" +
  "<path d='M7 10h12.5' stroke='#000' stroke-width='1.2'/>" +
  "<path d='M7 10c-1.6 0-2.7.8-3 2.2' fill='none' stroke='#000' stroke-width='1.5' stroke-linecap='round'/>" +
  "<path d='M4 13.4c-1.4 2.2-2.2 3.9-2.2 5.2a2.2 2.2 0 0 0 4.4 0c0-1.3-.8-3-2.2-5.2z' fill='#000' stroke='#fff' stroke-width='1'/>" +
  '</svg>';

/** A tipped bucket pouring a drop, whose bottom is the hot spot. */
export const PAINT_BUCKET_CURSOR = `url("data:image/svg+xml,${encodeURIComponent(CURSOR_SVG)}") 4 21, crosshair`;

/**
 * The Paint Bucket: a click fills the region whose colours match the pixel clicked
 * (`regionAt`, as the options bar sets it) with the foreground colour, on the active
 * layer, at the options' opacity and within the selection: one undo step ("Paint Bucket")
 * per click. With a floating selection, its layer is the active one and gets the fill,
 * within its bounds. Nothing is filled on a hidden layer; the status bar says why.
 */
export class PaintBucketTool implements Tool {
  readonly id = 'paint-bucket';
  readonly name = 'Paint Bucket';
  readonly shortcut = TOOL_KEYS.bucket;
  readonly cursor = PAINT_BUCKET_CURSOR;
  private context: ToolContext | null = null;

  constructor(
    private readonly colors: Colors,
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
    const context = this.context;
    const layer = context?.editor.activeLayer;
    if (!context || !layer) return;
    if (!layer.visible) {
      context.showMessage('The active layer is hidden');
      return;
    }
    const { editor } = context;
    const settings = this.options.settings;
    const region = regionAt(editor, e.x, e.y, settings);
    if (!region) return;
    const command = fillCommand(
      editor.document,
      layer.id,
      this.colors.foreground,
      settings.opacity / 100,
      'normal',
      { region, floating: editor.floating, label: this.name },
    );
    if (command) editor.history.execute(command);
  }
}
