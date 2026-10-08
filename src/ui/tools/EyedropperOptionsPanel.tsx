import { useSyncExternalStore } from 'react';
import type { EyedropperOptions, SampleSource } from './eyedropper-options';

const SOURCES: readonly { source: SampleSource; label: string; hint: string }[] = [
  { source: 'composite', label: 'All layers', hint: 'Sample what you see: all visible layers' },
  { source: 'layer', label: 'Active layer', hint: "Sample the active layer's own pixels" },
];

/** Options bar for the eyedropper: what it samples. */
export function EyedropperOptionsPanel({ options }: { options: EyedropperOptions }) {
  const current = useSyncExternalStore(options.subscribe, () => options.source);
  return (
    <>
      <div className="options-field">
        <span className="options-label" id="eyedropper-sample-label">
          Sample
        </span>
        <div
          className="toolbar-group segmented"
          role="group"
          aria-labelledby="eyedropper-sample-label"
        >
          {SOURCES.map(({ source, label, hint }) => (
            <button
              key={source}
              type="button"
              aria-pressed={source === current}
              title={hint}
              onClick={() => options.setSource(source)}
            >
              {label}
            </button>
          ))}
        </div>
      </div>
      <p className="tool-options-hint">
        Click or drag to pick the foreground colour; Alt+click picks the background colour.
      </p>
    </>
  );
}
