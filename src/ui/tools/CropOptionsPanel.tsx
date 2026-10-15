import { useState, useSyncExternalStore } from 'react';
import type { CropAspect, CropOptions } from './crop-options';
import { MAX_RATIO_TERM } from './crop-options';
import type { CropTool } from './crop-tool';
import { CANCEL_ICON, COMMIT_ICON, OptionsIcon } from './OptionsIcon';

const ASPECTS: readonly { aspect: CropAspect; label: string }[] = [
  { aspect: 'free', label: 'Free' },
  { aspect: 'original', label: 'Original' },
  { aspect: '1:1', label: '1:1 (square)' },
  { aspect: '4:3', label: '4:3' },
  { aspect: '3:2', label: '3:2' },
  { aspect: '16:9', label: '16:9' },
  { aspect: 'custom', label: 'Custom' },
];

function isAspect(value: string): value is CropAspect {
  return ASPECTS.some(({ aspect }) => aspect === value);
}

/** Options bar for the Crop tool: the box's ratio, whether to trim layers, and ✓ / ✗. */
export function CropOptionsPanel({ options, tool }: { options: CropOptions; tool: CropTool }) {
  const settings = useSyncExternalStore(options.subscribe, () => options.settings);
  const canCommit = useSyncExternalStore(tool.subscribe, () => tool.canCommit);
  const canReset = useSyncExternalStore(tool.subscribe, () => tool.canReset);
  return (
    <>
      <label className="options-field">
        <span className="options-label">Ratio</span>
        <select
          className="options-select"
          value={settings.aspect}
          title="Presets fit a portrait box as well as a landscape one"
          onChange={(e) => {
            if (isAspect(e.target.value)) options.set({ aspect: e.target.value });
          }}
        >
          {ASPECTS.map(({ aspect, label }) => (
            <option key={aspect} value={aspect}>
              {label}
            </option>
          ))}
        </select>
      </label>
      {settings.aspect === 'custom' && (
        <div className="options-field" role="group" aria-label="Custom ratio">
          <RatioTerm
            label="Ratio width"
            value={settings.customWidth}
            onChange={(customWidth) => options.set({ customWidth })}
          />
          <span className="options-unit" aria-hidden="true">
            :
          </span>
          <RatioTerm
            label="Ratio height"
            value={settings.customHeight}
            onChange={(customHeight) => options.set({ customHeight })}
          />
        </div>
      )}
      <button
        type="button"
        className="options-toggle"
        aria-pressed={settings.deleteCropped}
        title="Trim every layer to the new canvas. Off, layers keep the pixels outside it."
        onClick={() => options.set({ deleteCropped: !settings.deleteCropped })}
      >
        Delete cropped pixels
      </button>
      <div className="toolbar-group">
        <button
          type="button"
          className="options-icon-button"
          aria-label="Commit crop"
          title="Commit crop (Enter)"
          disabled={!canCommit}
          onClick={() => tool.commit()}
        >
          <OptionsIcon d={COMMIT_ICON} />
        </button>
        <button
          type="button"
          className="options-icon-button"
          aria-label="Cancel crop"
          title="Cancel crop (Esc)"
          disabled={!canReset}
          onClick={() => tool.resetBox()}
        >
          <OptionsIcon d={CANCEL_ICON} />
        </button>
      </div>
      <p className="tool-options-hint">
        Drag a box: Shift keeps its shape, Alt works from the centre. Enter or double-click crops.
      </p>
    </>
  );
}

/** A custom ratio term, if `text` is a number above 0 and at most `MAX_RATIO_TERM`. */
function parseTerm(text: string): number | null {
  const value = Number(text);
  if (text.trim() === '' || !Number.isFinite(value)) return null;
  return value > 0 && value <= MAX_RATIO_TERM ? value : null;
}

interface RatioTermProps {
  label: string;
  value: number;
  onChange: (value: number) => void;
}

/** One side of the custom ratio; it may have decimals, as in 1.91 : 1. */
function RatioTerm({ label, value, onChange }: RatioTermProps) {
  // What the user is typing; null shows the value.
  const [text, setText] = useState<string | null>(null);
  const shown = text ?? String(value);
  return (
    <input
      type="number"
      className="options-number"
      aria-label={label}
      aria-invalid={parseTerm(shown) === null}
      min={0}
      max={MAX_RATIO_TERM}
      step="any"
      value={shown}
      onChange={(e) => {
        setText(e.target.value);
        const parsed = parseTerm(e.target.value);
        if (parsed !== null) onChange(parsed);
      }}
      onBlur={() => setText(null)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') e.currentTarget.blur();
      }}
    />
  );
}
