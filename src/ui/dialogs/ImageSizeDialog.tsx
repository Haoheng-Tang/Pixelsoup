import { useId, useState } from 'react';
import type { Interpolation } from '../../core';
import { MAX_IMAGE_SIZE, isValidImageSize } from '../../core';
import type { ImageSizeOptions, ImageSizeSettings, SizeUnit } from '../session/image-options';
import { Dialog } from './Dialog';
import { NumberField } from './NumberField';
import { convertSizeText, proportionalText, sizeText, toPixels } from './size-math';

interface ImageSizeDialogProps {
  /** The document's current size. */
  width: number;
  height: number;
  initial: ImageSizeSettings;
  onResize: (options: ImageSizeOptions) => void;
  onCancel: () => void;
}

const UNITS: Record<SizeUnit, string> = { pixels: 'Pixels', percent: 'Percent' };

/** A label for every method, so adding one (bicubic) to `Interpolation` needs one here too. */
const INTERPOLATIONS: Record<Interpolation, string> = {
  nearest: 'Nearest neighbour (hard edges)',
  bilinear: 'Bilinear (smooth)',
};

export function ImageSizeDialog({
  width,
  height,
  initial,
  onResize,
  onCancel,
}: ImageSizeDialogProps) {
  const [unit, setUnit] = useState(initial.unit);
  const [keepAspect, setKeepAspect] = useState(initial.keepAspect);
  const [interpolation, setInterpolation] = useState(initial.interpolation);
  const [widthText, setWidthText] = useState(() => sizeText(width, initial.unit, width));
  const [heightText, setHeightText] = useState(() => sizeText(height, initial.unit, height));
  const newWidth = toPixels(widthText, unit, width);
  const newHeight = toPixels(heightText, unit, height);
  const valid = isValidImageSize(newWidth, newHeight);
  const hintId = useId();
  const pixels = unit === 'pixels';
  const fieldProps = {
    unit: pixels ? 'px' : '%',
    describedBy: hintId,
    ...(pixels
      ? { min: 1, max: MAX_IMAGE_SIZE, inputMode: 'numeric' as const }
      : { min: 0, step: 'any' as const, inputMode: 'decimal' as const }),
  };

  const changeWidth = (text: string) => {
    setWidthText(text);
    const linked = keepAspect ? proportionalText(text, unit, width, height) : null;
    if (linked !== null) setHeightText(linked);
  };
  const changeHeight = (text: string) => {
    setHeightText(text);
    const linked = keepAspect ? proportionalText(text, unit, height, width) : null;
    if (linked !== null) setWidthText(linked);
  };
  const changeUnit = (next: SizeUnit) => {
    setWidthText(convertSizeText(widthText, unit, next, width));
    setHeightText(convertSizeText(heightText, unit, next, height));
    setUnit(next);
  };

  return (
    <Dialog title="Image Size" onCancel={onCancel}>
      <form
        className="dialog-form"
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          if (!valid) return;
          onResize({ width: newWidth, height: newHeight, unit, keepAspect, interpolation });
        }}
      >
        <fieldset className="choice-group">
          <legend>Units</legend>
          {(Object.keys(UNITS) as SizeUnit[]).map((value) => (
            <label key={value}>
              <input
                type="radio"
                name="unit"
                value={value}
                checked={unit === value}
                onChange={() => changeUnit(value)}
              />
              {UNITS[value]}
            </label>
          ))}
        </fieldset>
        <div className="size-fields">
          <NumberField
            label="Width"
            value={widthText}
            onChange={changeWidth}
            invalid={!isValidImageSize(newWidth, 1)}
            autoFocus
            {...fieldProps}
          />
          <NumberField
            label="Height"
            value={heightText}
            onChange={changeHeight}
            invalid={!isValidImageSize(1, newHeight)}
            {...fieldProps}
          />
        </div>
        <label className="check-field">
          <input
            type="checkbox"
            checked={keepAspect}
            onChange={(e) => setKeepAspect(e.currentTarget.checked)}
          />
          Lock aspect ratio
        </label>
        <fieldset className="choice-group">
          <legend>Resample</legend>
          {(Object.keys(INTERPOLATIONS) as Interpolation[]).map((value) => (
            <label key={value}>
              <input
                type="radio"
                name="interpolation"
                value={value}
                checked={interpolation === value}
                onChange={() => setInterpolation(value)}
              />
              {INTERPOLATIONS[value]}
            </label>
          ))}
        </fieldset>
        <p id={hintId} className="field-hint" role={valid ? undefined : 'alert'}>
          {valid
            ? `${newWidth} × ${newHeight} pixels, from ${width} × ${height}.`
            : pixels
              ? `Width and height must be whole numbers from 1 to ${MAX_IMAGE_SIZE} pixels.`
              : `Width and height must come to between 1 and ${MAX_IMAGE_SIZE} pixels.`}
        </p>
        <div className="dialog-actions">
          <button type="button" onClick={onCancel}>
            Cancel
          </button>
          <button type="submit" className="primary" disabled={!valid}>
            Resize
          </button>
        </div>
      </form>
    </Dialog>
  );
}
