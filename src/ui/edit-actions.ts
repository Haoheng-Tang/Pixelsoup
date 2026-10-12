import type { Command, Editor, FillMode, LayerId, Rgb } from '../core';
import { assertNever, clearCommand, fillCommand, intersectRects, rasterBounds } from '../core';
import type { Colors } from './color/colors';

/** What Edit → Fill fills with. */
export type FillContents = 'foreground' | 'background' | 'black' | 'white' | 'gray' | 'custom';

/** The Fill dialog's settings, which it remembers for the session. */
export interface FillSettings {
  readonly contents: FillContents;
  /** The colour for `custom`, or null to start from the foreground colour. */
  readonly custom: Rgb | null;
  /** Percent, 1–100. */
  readonly opacity: number;
  /** Only pixels with some alpha change colour, and their alpha stays as it is. */
  readonly preserveTransparency: boolean;
}

export const DEFAULT_FILL_SETTINGS: FillSettings = {
  contents: 'foreground',
  custom: null,
  opacity: 100,
  preserveTransparency: false,
};

/** The colour `contents` stands for, given the current colours. */
export function fillColor(
  { contents, custom }: Pick<FillSettings, 'contents' | 'custom'>,
  colors: Colors,
): Rgb {
  switch (contents) {
    case 'foreground':
      return colors.foreground;
    case 'background':
      return colors.background;
    case 'black':
      return [0, 0, 0];
    case 'white':
      return [255, 255, 255];
    case 'gray':
      return [128, 128, 128];
    case 'custom':
      return custom ?? colors.foreground;
    default:
      return assertNever(contents);
  }
}

/** Whether Fill can run: the active layer is visible. */
export function canFill(editor: Editor): boolean {
  return targetLayerId(editor) !== null;
}

/**
 * Whether Clear may do anything, for enabling menu items: the selection reaches the visible
 * active layer. It's cheap, so it doesn't check that a selected pixel has any alpha.
 */
export function canClear(editor: Editor): boolean {
  const layer = editor.activeLayer;
  const selected = editor.document.selection?.bounds();
  return !!layer?.visible && !!selected && intersectRects(selected, rasterBounds(layer)) !== null;
}

/**
 * Fills the active layer's selected pixels, or with no selection all of it on the canvas,
 * with `color` at `opacity` (0–1): one undo step ("Fill"), unless that would change
 * nothing. See `FillCommand`.
 */
export function runFill(editor: Editor, color: Rgb, opacity: number, mode: FillMode): void {
  run(editor, (id) =>
    fillCommand(editor.document, id, color, opacity, mode, { floating: editor.floating }),
  );
}

/** Clears the active layer's selected pixels to transparent: one undo step ("Clear"). */
export function runClear(editor: Editor): void {
  run(editor, (id) => clearCommand(editor.document, id, editor.floating));
}

/** The layer Fill and Clear change: the active layer, unless it's hidden. */
function targetLayerId(editor: Editor): LayerId | null {
  const layer = editor.activeLayer;
  return layer?.visible ? layer.id : null;
}

/**
 * Executes the command `build` makes for the target layer. A floating selection's layer is
 * the active one while it floats, so Fill and Clear change it, within its bounds, rather
 * than committing it; if another layer were active, the float would be committed first.
 */
function run(editor: Editor, build: (layerId: LayerId) => Command | null): void {
  const id = targetLayerId(editor);
  if (id === null) return;
  if (editor.floating && editor.floating.layerId !== id) editor.commitFloating();
  const command = build(id);
  if (command) editor.history.execute(command);
}
