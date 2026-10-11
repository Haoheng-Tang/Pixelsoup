import { useId, useState } from 'react';
import type { RotateTarget } from '../image-actions';
import { Dialog } from './Dialog';
import { parseDecimal } from './size-math';

interface RotateLayerDialogProps {
  target: RotateTarget;
  /** Called with each valid angle (degrees clockwise) as it's entered. */
  onPreview: (degrees: number) => void;
  onRotate: (degrees: number) => void;
  onCancel: () => void;
}

const MAX_ANGLE = 360;

/** The same angle in −180 to 180°, for the slider. */
function sliderAngle(degrees: number): number {
  const turned = degrees % 360;
  return turned > 180 ? turned - 360 : turned < -180 ? turned + 360 : turned;
}

/**
 * Asks for an angle and previews it live on the canvas (through `onPreview`), so the dialog
 * sits at the side with no backdrop.
 */
export function RotateLayerDialog({
  target,
  onPreview,
  onRotate,
  onCancel,
}: RotateLayerDialogProps) {
  const [text, setText] = useState('0');
  const degrees = parseDecimal(text);
  const valid = Math.abs(degrees) <= MAX_ANGLE;
  const inputId = useId();
  const hintId = useId();

  const change = (next: string) => {
    setText(next);
    const angle = parseDecimal(next);
    if (Math.abs(angle) <= MAX_ANGLE) onPreview(angle);
  };

  return (
    <Dialog
      title={target === 'selection' ? 'Rotate Selection' : 'Rotate Layer'}
      onCancel={onCancel}
      className="dialog-preview"
    >
      <form
        className="dialog-form"
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          if (valid) onRotate(degrees);
        }}
      >
        <div className="angle-field">
          <label htmlFor={inputId}>Angle</label>
          <input
            type="range"
            min={-180}
            max={180}
            step={1}
            value={valid ? sliderAngle(degrees) : 0}
            onChange={(e) => change(e.currentTarget.value)}
            aria-label="Angle"
            aria-describedby={hintId}
          />
          <input
            id={inputId}
            type="number"
            min={-MAX_ANGLE}
            max={MAX_ANGLE}
            step="any"
            value={text}
            onChange={(e) => change(e.currentTarget.value)}
            aria-invalid={!valid}
            aria-describedby={hintId}
            data-autofocus
          />
          <span className="unit" aria-hidden="true">
            °
          </span>
        </div>
        <p id={hintId} className="field-hint" role={valid ? undefined : 'alert'}>
          {valid
            ? `Turns the ${target === 'selection' ? 'selected pixels' : 'layer'} about the ` +
              'centre: positive angles clockwise, negative anticlockwise.'
            : `Enter an angle from −${MAX_ANGLE}° to ${MAX_ANGLE}°.`}
        </p>
        <div className="dialog-actions">
          <button type="button" onClick={onCancel}>
            Cancel
          </button>
          <button type="submit" className="primary" disabled={!valid}>
            Rotate
          </button>
        </div>
      </form>
    </Dialog>
  );
}
