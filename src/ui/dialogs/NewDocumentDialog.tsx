import { useId, useState } from 'react';
import type { DocumentBackground, NewDocumentOptions } from '../../core';
import { MAX_IMAGE_SIZE, isValidImageSize } from '../../core';
import { Dialog } from './Dialog';

interface NewDocumentDialogProps {
  initial: NewDocumentOptions;
  onCreate: (options: NewDocumentOptions) => void;
  onCancel: () => void;
}

const BACKGROUNDS: readonly { value: DocumentBackground; label: string }[] = [
  { value: 'white', label: 'White' },
  { value: 'transparent', label: 'Transparent' },
];

/** Parses a whole number of pixels; anything else (including "") is NaN. */
function parsePixels(text: string): number {
  return /^\s*\d+\s*$/.test(text) ? Number(text) : NaN;
}

export function NewDocumentDialog({ initial, onCreate, onCancel }: NewDocumentDialogProps) {
  const [width, setWidth] = useState(String(initial.width));
  const [height, setHeight] = useState(String(initial.height));
  const [background, setBackground] = useState(initial.background);
  const options = { width: parsePixels(width), height: parsePixels(height), background };
  const valid = isValidImageSize(options.width, options.height);
  const hintId = useId();

  return (
    <Dialog title="New Document" onCancel={onCancel}>
      <form
        className="dialog-form"
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          if (!valid) return;
          onCreate(options);
        }}
      >
        <div className="size-fields">
          <PixelField
            label="Width"
            value={width}
            onChange={setWidth}
            invalid={!isValidImageSize(options.width, 1)}
            describedBy={hintId}
            autoFocus
          />
          <PixelField
            label="Height"
            value={height}
            onChange={setHeight}
            invalid={!isValidImageSize(1, options.height)}
            describedBy={hintId}
          />
        </div>
        <fieldset className="choice-group">
          <legend>Background</legend>
          {BACKGROUNDS.map(({ value, label }) => (
            <label key={value}>
              <input
                type="radio"
                name="background"
                value={value}
                checked={background === value}
                onChange={() => setBackground(value)}
              />
              {label}
            </label>
          ))}
        </fieldset>
        <p id={hintId} className="field-hint" role={valid ? undefined : 'alert'}>
          {valid
            ? `${options.width} × ${options.height} pixels`
            : `Width and height must be whole numbers from 1 to ${MAX_IMAGE_SIZE} pixels.`}
        </p>
        <div className="dialog-actions">
          <button type="button" onClick={onCancel}>
            Cancel
          </button>
          <button type="submit" className="primary" disabled={!valid}>
            Create
          </button>
        </div>
      </form>
    </Dialog>
  );
}

interface PixelFieldProps {
  label: string;
  value: string;
  onChange: (value: string) => void;
  invalid: boolean;
  describedBy: string;
  autoFocus?: boolean;
}

function PixelField({ label, value, onChange, invalid, describedBy, autoFocus }: PixelFieldProps) {
  const id = useId();
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <input
        id={id}
        type="number"
        inputMode="numeric"
        min={1}
        max={MAX_IMAGE_SIZE}
        step={1}
        value={value}
        onChange={(e) => onChange(e.currentTarget.value)}
        aria-invalid={invalid}
        aria-describedby={describedBy}
        data-autofocus={autoFocus}
      />
      <span className="unit" aria-hidden="true">
        px
      </span>
    </div>
  );
}
