import { useSyncExternalStore } from 'react';
import type { SelectionMode } from '../../core';
import type { SelectionOptions } from './selection-options';

const MODES: readonly { mode: SelectionMode; label: string; hint: string }[] = [
  { mode: 'replace', label: 'New', hint: 'New selection' },
  { mode: 'add', label: 'Add', hint: 'Add to selection (hold Shift when you start dragging)' },
  {
    mode: 'subtract',
    label: 'Subtract',
    hint: 'Subtract from selection (hold Alt when you start dragging)',
  },
  {
    mode: 'intersect',
    label: 'Intersect',
    hint: 'Intersect with selection (hold Shift+Alt when you start dragging)',
  },
];

/** Options bar for the selection tools: how a new shape combines with the selection. */
export function SelectionOptionsPanel({ options }: { options: SelectionOptions }) {
  const current = useSyncExternalStore(options.subscribe, () => options.mode);
  return (
    <div className="toolbar-group segmented" role="group" aria-label="Selection mode">
      {MODES.map(({ mode, label, hint }) => (
        <button
          key={mode}
          type="button"
          aria-pressed={mode === current}
          title={hint}
          onClick={() => options.setMode(mode)}
        >
          {label}
        </button>
      ))}
    </div>
  );
}
