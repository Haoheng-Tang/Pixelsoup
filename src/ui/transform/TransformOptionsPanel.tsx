import type { ComponentType } from 'react';
import { useCallback, useState, useSyncExternalStore } from 'react';
import type { Interpolation } from '../../core';
import { CANCEL_ICON, COMMIT_ICON, OptionsIcon } from '../tools/OptionsIcon';
import { IS_APPLE } from '../use-file-shortcuts';
import type { FreeTransform } from './free-transform';
import type { TransformField, TransformUnit } from './transform-math';
import { fieldText, parseFieldText, transformFields } from './transform-math';
import type { TransformOptions } from './transform-options';
import type { TransformSession } from './transform-session';

/** A label for every method, so adding one (bicubic) to `Interpolation` needs one here too. */
const INTERPOLATIONS: Record<Interpolation, string> = {
  bilinear: 'Bilinear',
  nearest: 'Nearest neighbour',
};

const UNITS: readonly { unit: TransformUnit; label: string; hint: string }[] = [
  { unit: 'percent', label: '%', hint: 'Width and height as a percentage' },
  { unit: 'px', label: 'px', hint: 'Width and height in pixels' },
];

/** Two links of a chain: keep the proportions. */
const LINK_ICON =
  'M4.5 5h3a3 3 0 0 1 0 6h-3a3 3 0 0 1 0-6zM8.5 5h3a3 3 0 0 1 0 6h-3a3 3 0 0 1 0-6z';

const CTRL = IS_APPLE ? 'Cmd' : 'Ctrl';

const HINT =
  'Shift keeps proportions, Alt scales about the centre; drag outside a corner to rotate. ' +
  `${CTRL} distorts a corner or skews an edge, ${CTRL}+Alt+Shift puts a corner in perspective.`;

function isInterpolation(value: string): value is Interpolation {
  return Object.keys(INTERPOLATIONS).includes(value);
}

/** Makes the options-bar panel that Free Transform's sessions show. */
export function transformOptionsPanel(freeTransform: FreeTransform): ComponentType {
  function TransformPanel() {
    return <TransformOptionsPanel freeTransform={freeTransform} />;
  }
  return TransformPanel;
}

/** Options bar for a Free Transform session, while one runs. */
export function TransformOptionsPanel({ freeTransform }: { freeTransform: FreeTransform }) {
  const subscribe = useCallback(
    (notify: () => void) => freeTransform.subscribe(notify),
    [freeTransform],
  );
  const session = useSyncExternalStore(subscribe, () => freeTransform.session);
  return session ? <SessionOptions session={session} options={freeTransform.options} /> : null;
}

interface SessionOptionsProps {
  session: TransformSession;
  options: TransformOptions;
}

/**
 * The pivot's position, the size, the angle, the skews and the interpolation, with ✓ and
 * ✗. The fields follow the handles, and typing in one previews straight away. A distorted
 * box has no angle or skew: those fields are blank and disabled.
 */
function SessionOptions({ session, options }: SessionOptionsProps) {
  const subscribe = useCallback((notify: () => void) => session.subscribe(notify), [session]);
  const state = useSyncExternalStore(subscribe, () => session.state);
  const settings = useSyncExternalStore(options.subscribe, () => options.settings);
  const fields = transformFields(session.source.rect, state, settings.unit);
  const sizeUnit = settings.unit === 'px' ? 'px' : '%';
  const set = (field: TransformField) => (value: number) => session.setField(field, value);
  return (
    <>
      <TransformNumber
        label="X"
        name="Pivot X"
        unit="px"
        hint="Where the layer’s centre goes, across"
        value={fields.x}
        onChange={set('x')}
      />
      <TransformNumber
        label="Y"
        name="Pivot Y"
        unit="px"
        hint="Where the layer’s centre goes, down"
        value={fields.y}
        onChange={set('y')}
      />
      <div className="options-field">
        <TransformNumber
          label="W"
          name="Width"
          unit={sizeUnit}
          hint="Width; a negative width flips the layer"
          value={fields.width}
          onChange={set('width')}
        />
        <button
          type="button"
          className="options-icon-button options-toggle"
          aria-label="Keep proportions"
          aria-pressed={settings.lockAspect}
          title="Keep proportions: the width and height change together"
          onClick={() => options.set({ lockAspect: !settings.lockAspect })}
        >
          <OptionsIcon d={LINK_ICON} />
        </button>
        <TransformNumber
          label="H"
          name="Height"
          unit={sizeUnit}
          hint="Height; a negative height flips the layer"
          value={fields.height}
          onChange={set('height')}
        />
        <div className="toolbar-group segmented" role="group" aria-label="Size unit">
          {UNITS.map(({ unit, label, hint }) => (
            <button
              key={unit}
              type="button"
              aria-pressed={unit === settings.unit}
              title={hint}
              onClick={() => options.set({ unit })}
            >
              {label}
            </button>
          ))}
        </div>
      </div>
      <TransformNumber
        label="Angle"
        name="Angle"
        unit="°"
        hint="Degrees clockwise"
        value={fields.angle}
        onChange={set('angle')}
      />
      <div className="options-field" role="group" aria-label="Skew">
        <span className="options-label" aria-hidden="true">
          Skew
        </span>
        <TransformNumber
          label="H"
          name="Horizontal skew"
          unit="°"
          hint="Horizontal skew: degrees the left and right edges lean clockwise"
          value={fields.skewX}
          onChange={set('skewX')}
        />
        <TransformNumber
          label="V"
          name="Vertical skew"
          unit="°"
          hint="Vertical skew: degrees the top and bottom edges lean clockwise"
          value={fields.skewY}
          onChange={set('skewY')}
        />
      </div>
      <label className="options-field">
        <span className="options-label">Interpolation</span>
        <select
          className="options-select"
          value={settings.interpolation}
          onChange={(e) => {
            if (isInterpolation(e.target.value)) options.set({ interpolation: e.target.value });
          }}
        >
          {Object.entries(INTERPOLATIONS).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
      </label>
      <div className="toolbar-group">
        <button
          type="button"
          className="options-icon-button"
          aria-label="Apply transform"
          title="Apply transform (Enter)"
          onClick={() => session.apply()}
        >
          <OptionsIcon d={COMMIT_ICON} />
        </button>
        <button
          type="button"
          className="options-icon-button"
          aria-label="Cancel transform"
          title="Cancel transform (Esc)"
          onClick={() => session.discard()}
        >
          <OptionsIcon d={CANCEL_ICON} />
        </button>
      </div>
      <p className="tool-options-hint" title={HINT}>
        {HINT}
      </p>
    </>
  );
}

interface TransformNumberProps {
  /** Shown before the field. */
  label: string;
  /** Its accessible name. */
  name: string;
  unit: string;
  hint: string;
  /** Null disables the field, blank: the box has no such value (an angle, once distorted). */
  value: number | null;
  /** Takes a typed value; false refuses it. */
  onChange: (value: number) => boolean;
}

/**
 * A number field that changes the transform as it's typed in. A value the transform
 * refuses is marked invalid and left out; leaving the field shows the value again.
 */
function TransformNumber({ label, name, unit, hint, value, onChange }: TransformNumberProps) {
  // What the user is typing; null shows the value.
  const [text, setText] = useState<string | null>(null);
  const [invalid, setInvalid] = useState(false);
  const disabled = value === null;
  return (
    <div className="options-field" title={disabled ? `${hint} (not while distorted)` : hint}>
      <span className="options-label" aria-hidden="true">
        {label}
      </span>
      <input
        type="number"
        className="options-number options-number-wide"
        aria-label={`${name} (${unit})`}
        aria-invalid={invalid}
        disabled={disabled}
        step="any"
        value={disabled ? '' : (text ?? fieldText(value))}
        onChange={(e) => {
          setText(e.target.value);
          const parsed = parseFieldText(e.target.value);
          setInvalid(parsed === null || !onChange(parsed));
        }}
        onBlur={() => {
          setText(null);
          setInvalid(false);
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') e.currentTarget.blur();
        }}
      />
      <span className="options-unit" aria-hidden="true">
        {unit}
      </span>
    </div>
  );
}
