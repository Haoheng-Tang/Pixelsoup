import { useSyncExternalStore } from 'react';
import type { PressureTarget } from '../../core';
import type { BrushOptions } from './brush-options';
import { MAX_BRUSH_SIZE, MIN_BRUSH_SIZE, sizeToSlider, sliderToSize } from './brush-options';
import { NumberSlider } from './NumberSlider';

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
