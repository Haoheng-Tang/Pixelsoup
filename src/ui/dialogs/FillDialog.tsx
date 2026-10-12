import { useId, useState } from 'react';
import type { Rgb } from '../../core';
import { parseHex, toHex } from '../color/color-math';
import type { Colors } from '../color/colors';
import type { FillContents, FillSettings } from '../edit-actions';
import { fillColor } from '../edit-actions';
import { Dialog } from './Dialog';

interface FillDialogProps {
  initial: FillSettings;
  colors: Colors;
  /** Whether there's a selection to fill; without one, the whole layer is filled. */
  selection: boolean;
  onFill: (settings: FillSettings) => void;
  onCancel: () => void;
}

/** The contents with a fixed swatch, in order; "Custom colour" comes last, with a picker. */
const SWATCH_CONTENTS: readonly { value: FillContents; label: string }[] = [
  { value: 'foreground', label: 'Foreground colour' },
  { value: 'background', label: 'Background colour' },
  { value: 'black', label: 'Black' },
  { value: 'white', label: 'White' },
  { value: 'gray', label: '50% grey' },
];

export function FillDialog({ initial, colors, selection, onFill, onCancel }: FillDialogProps) {
  const [contents, setContents] = useState(initial.contents);
  const [custom, setCustom] = useState<Rgb>(initial.custom ?? colors.foreground);
  const [opacity, setOpacity] = useState(initial.opacity);
  const [preserveTransparency, setPreserveTransparency] = useState(initial.preserveTransparency);
  const group = useId();
  const opacityId = useId();

  const radio = (value: FillContents) => (
    <input
      type="radio"
      name={group}
      value={value}
      checked={contents === value}
      onChange={() => setContents(value)}
      data-autofocus={contents === value ? true : undefined}
    />
  );

  return (
    <Dialog title="Fill" onCancel={onCancel}>
      <form
        className="dialog-form"
        onSubmit={(e) => {
          e.preventDefault();
          onFill({ contents, custom, opacity, preserveTransparency });
        }}
      >
        <fieldset className="choice-group fill-contents">
          <legend>Contents</legend>
          {SWATCH_CONTENTS.map(({ value, label }) => (
            <label key={value}>
              {radio(value)}
              <span
                className="fill-swatch"
                style={{ backgroundColor: toHex(fillColor({ contents: value, custom }, colors)) }}
                aria-hidden="true"
              />
              {label}
            </label>
          ))}
          <div className="fill-custom">
            <label>
              {radio('custom')}
              Custom colour
            </label>
            {/* Outside the label, so that opening the picker doesn't also pick the radio. */}
            <input
              type="color"
              className="fill-color"
              aria-label="Custom colour"
              title={`Custom colour ${toHex(custom)}`}
              value={toHex(custom)}
              onChange={(e) => {
                const rgb = parseHex(e.currentTarget.value);
                if (!rgb) return;
                setCustom(rgb);
                setContents('custom');
              }}
            />
          </div>
        </fieldset>
        <div className="range-field">
          <label htmlFor={opacityId}>Opacity</label>
          <input
            id={opacityId}
            type="range"
            min={1}
            max={100}
            step={1}
            value={opacity}
            onChange={(e) => setOpacity(Number(e.currentTarget.value))}
          />
          <output htmlFor={opacityId}>{opacity}%</output>
        </div>
        <label className="check-field">
          <input
            type="checkbox"
            checked={preserveTransparency}
            onChange={(e) => setPreserveTransparency(e.currentTarget.checked)}
          />
          Preserve transparency
        </label>
        <p className="field-hint">
          {selection
            ? 'Fills the selection on the active layer.'
            : 'Fills the whole canvas on the active layer, as nothing is selected.'}
          {preserveTransparency && ' Every pixel keeps its transparency.'}
        </p>
        <div className="dialog-actions">
          <button type="button" onClick={onCancel}>
            Cancel
          </button>
          <button type="submit" className="primary">
            Fill
          </button>
        </div>
      </form>
    </Dialog>
  );
}
