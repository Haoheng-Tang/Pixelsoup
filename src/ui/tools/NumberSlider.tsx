import { useId, useState } from 'react';

/** Maps a value to and from the positions of a slider that isn't linear. */
export interface SliderScale {
  readonly max: number;
  readonly toPosition: (value: number) => number;
  readonly fromPosition: (position: number) => number;
}

interface NumberSliderProps {
  label: string;
  unit: string;
  value: number;
  min: number;
  max: number;
  /** Positions of a non-linear slider; by default the slider runs from `min` to `max`. */
  slider?: SliderScale;
  /** Shown as a tooltip on the label. */
  hint?: string;
  onChange: (value: number) => void;
}

/** The whole number in `text`, if it's one from `min` to `max`. */
function parseWhole(text: string, min: number, max: number): number | null {
  const value = Number(text);
  if (text.trim() === '' || !Number.isFinite(value)) return null;
  const whole = Math.round(value);
  return whole >= min && whole <= max ? whole : null;
}

/**
 * A labelled slider for the tool-options bar, with a number field beside it, both
 * changing the value as they move.
 */
export function NumberSlider({
  label,
  unit,
  value,
  min,
  max,
  slider,
  hint,
  onChange,
}: NumberSliderProps) {
  const id = useId();
  const labelId = `${id}-label`;
  const unitId = `${id}-unit`;
  // What the user is typing; null shows the value.
  const [text, setText] = useState<string | null>(null);
  const shown = text ?? String(value);
  const valueText = unit ? `${value} ${unit}` : String(value);
  return (
    <div className="options-field">
      <span className="options-label" id={labelId} title={hint}>
        {label}
      </span>
      <input
        type="range"
        className="options-slider"
        aria-labelledby={labelId}
        aria-valuetext={valueText}
        min={slider ? 0 : min}
        max={slider ? slider.max : max}
        step={1}
        value={slider ? slider.toPosition(value) : value}
        onChange={(e) => {
          const position = Number(e.target.value);
          onChange(slider ? slider.fromPosition(position) : position);
        }}
      />
      <input
        type="number"
        className="options-number"
        aria-labelledby={unit ? `${labelId} ${unitId}` : labelId}
        aria-invalid={parseWhole(shown, min, max) === null}
        min={min}
        max={max}
        step={1}
        value={shown}
        onChange={(e) => {
          setText(e.target.value);
          const parsed = parseWhole(e.target.value, min, max);
          if (parsed !== null) onChange(parsed);
        }}
        onBlur={() => setText(null)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') e.currentTarget.blur();
        }}
      />
      {unit && (
        <span className="options-unit" id={unitId}>
          {unit}
        </span>
      )}
    </div>
  );
}
