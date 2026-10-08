import { formatShortcut } from '../use-file-shortcuts';

/** The Move tool has no settings yet, so its options bar explains the modifiers. */
export function MoveOptionsPanel() {
  return (
    <p className="tool-options-hint">
      Drag to move the active layer, or the selected pixels. Alt+drag copies them, Shift keeps to
      one axis, arrow keys nudge by 1 px (10 with Shift). {formatShortcut('Enter')} commits a
      floating selection.
    </p>
  );
}
