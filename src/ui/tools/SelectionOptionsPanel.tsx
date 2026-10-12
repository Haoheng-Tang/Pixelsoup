import { useSyncExternalStore } from 'react';
import type { SelectionMode } from '../../core';
import type { SelectionOptions } from './selection-options';

const MODES: readonly { mode: SelectionMode; label: string; hint: string }[] = [
  { mode: 'replace', label: 'New', hint: 'New selection' },
  { mode: 'add', label: 'Add', hint: 'Add to selection (hold Shift as you start)' },
  {
    mode: 'subtract',
    label: 'Subtract',
    hint: 'Subtract from selection (hold Alt as you start)',
  },
  {
    mode: 'intersect',
    label: 'Intersect',
    hint: 'Intersect with selection (hold Shift+Alt as you start)',
  },
];

/** Options bar for the selection tools: how a new shape combines with the selection. */
export function SelectionOptionsPanel({
  options,
  hint,
}: {
  options: SelectionOptions;
  /** How to use the tool, after the modes. */
  hint?: string;
}) {
  const current = useSyncExternalStore(options.subscribe, () => options.mode);
  return (
    <>
      <div className="toolbar-group segmented" role="group" aria-label="Selection mode">
        {MODES.map(({ mode, label, hint: modeHint }) => (
          <button
            key={mode}
            type="button"
            aria-pressed={mode === current}
            title={modeHint}
            onClick={() => options.setMode(mode)}
          >
            {label}
          </button>
        ))}
      </div>
      {hint && <p className="tool-options-hint">{hint}</p>}
    </>
  );
}
