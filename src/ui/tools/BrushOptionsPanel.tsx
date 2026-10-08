import { useId, useState, useSyncExternalStore } from 'react';
import type { PressureTarget } from '../../core';
import type { BrushOptions } from './brush-options';
import { MAX_BRUSH_SIZE, MIN_BRUSH_SIZE, sizeToSlider, sliderToSize } from './brush-options';

/** Positions along the non-linear size slider. */
const SIZE_SLIDER_STEPS = 1000;

const TARGETS: readonly { target: PressureTarget; label: string; hint: string }[] = [
  { target: 'size', label: 'Size', hint: 'Pen pressure scales the brush size' },
  { target: 'opacity', label: 'Opacity', hint: 'Pen pressure scales the opacity' },
  { target: 'both', label: 'Both', hint: 'Pen pressure scales the size and the opacity' },
];

/** Options bar for the brush and the eraser: size, hardness, opacity and pen pressure. */
export function BrushOptionsPanel({ options }: { options: BrushOptions }) {
  const settings = useSyncExternalStore(options.subscribe, () => options.settings);
  return (
    <>
      <NumberSlider
        label="Size"
        unit="px"
        value={settings.size}
        min={MIN_BRUSH_SIZE}
        max={MAX_BRUSH_SIZE}
        slider={{
          max: SIZE_SLIDER_STEPS,
          toPosition: (size) => Math.round(sizeToSlider(size) * SIZE_SLIDER_STEPS),
          fromPosition: (position) => sliderToSize(position / SIZE_SLIDER_STEPS),
        }}
        onChange={(size) => options.set({ size })}
      />
      <NumberSlider
        label="Hardness"
        unit="%"
        value={settings.hardness}
        min={0}
        max={100}
        onChange={(hardness) => options.set({ hardness })}
      />
      <NumberSlider
        label="Opacity"
        unit="%"
        value={settings.opacity}
        min={1}
        max={100}
        onChange={(opacity) => options.set({ opacity })}
      />
      <div className="options-field">
        <button
          type="button"
          className="options-toggle"
          aria-pressed={settings.pressure}
          title="Use pen pressure"
          onClick={() => options.set({ pressure: !settings.pressure })}
        >
          Pressure
        </button>
        <div className="toolbar-group segmented" role="group" aria-label="Pressure controls">
          {TARGETS.map(({ target, label, hint }) => (
            <button
              key={target}
              type="button"
              aria-pressed={target === settings.pressureTarget}
              title={hint}
              disabled={!settings.pressure}
              onClick={() => options.set({ pressureTarget: target })}
            >
              {label}
            </button>
          ))}
        </div>
      </div>
      <p className="tool-options-hint">
        Shift-click draws a line, Alt picks a colour. [ ] size, Shift+[ ] hardness.
      </p>
    </>
  );
}

/** Maps a value to and from the positions of a slider that isn't linear. */
interface SliderScale {
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
  onChange: (value: number) => void;
}

/** The whole number in `text`, if it's one from `min` to `max`. */
function parseWhole(text: string, min: number, max: number): number | null {
  const value = Number(text);
  if (text.trim() === '' || !Number.isFinite(value)) return null;
  const whole = Math.round(value);
  return whole >= min && whole <= max ? whole : null;
}

/** A labelled slider with a number field beside it, both changing the value as they move. */
function NumberSlider({ label, unit, value, min, max, slider, onChange }: NumberSliderProps) {
  const id = useId();
  const labelId = `${id}-label`;
  const unitId = `${id}-unit`;
  // What the user is typing; null shows the value.
  const [text, setText] = useState<string | null>(null);
  const shown = text ?? String(value);
  return (
    <div className="options-field">
      <span className="options-label" id={labelId}>
        {label}
      </span>
      <input
        type="range"
        className="options-slider"
        aria-labelledby={labelId}
        aria-valuetext={`${value} ${unit}`}
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
        aria-labelledby={`${labelId} ${unitId}`}
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
      <span className="options-unit" id={unitId}>
        {unit}
      </span>
    </div>
  );
}
