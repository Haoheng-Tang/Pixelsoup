import { useId, useState } from 'react';
import type { Anchor } from '../../core';
import { MAX_IMAGE_SIZE, isValidImageSize } from '../../core';
import type { CanvasSizeOptions, CanvasSizeSettings } from '../session/image-options';
import { Dialog } from './Dialog';
import { NumberField } from './NumberField';
import { canvasPixels, toggleRelativeText } from './size-math';

interface CanvasSizeDialogProps {
  /** The document's current size. */
  width: number;
  height: number;
  initial: CanvasSizeSettings;
  onResize: (options: CanvasSizeOptions) => void;
  onCancel: () => void;
}

const ANCHORS: readonly Anchor[] = ['start', 'center', 'end'];
const ROW_NAMES: Record<Anchor, string> = { start: 'Top', center: '', end: 'Bottom' };
const COLUMN_NAMES: Record<Anchor, string> = { start: 'left', center: '', end: 'right' };

/** "Top left", "Top", "Left", "Centre", … */
function anchorName(horizontal: Anchor, vertical: Anchor): string {
  const name = `${ROW_NAMES[vertical]} ${COLUMN_NAMES[horizontal]}`.trim();
  return name ? name.charAt(0).toUpperCase() + name.slice(1) : 'Centre';
}

export function CanvasSizeDialog({
  width,
  height,
  initial,
  onResize,
  onCancel,
}: CanvasSizeDialogProps) {
  const [relative, setRelative] = useState(initial.relative);
  const [widthText, setWidthText] = useState(initial.relative ? '0' : String(width));
  const [heightText, setHeightText] = useState(initial.relative ? '0' : String(height));
  const [horizontal, setHorizontal] = useState<Anchor>('center');
  const [vertical, setVertical] = useState<Anchor>('center');
  const newWidth = canvasPixels(widthText, relative, width);
  const newHeight = canvasPixels(heightText, relative, height);
  const valid = isValidImageSize(newWidth, newHeight);
  const hintId = useId();
  const anchorGroup = useId();

  const changeRelative = (next: boolean) => {
    setWidthText(toggleRelativeText(widthText, relative, width));
    setHeightText(toggleRelativeText(heightText, relative, height));
    setRelative(next);
  };
  const fieldProps = (size: number) => ({
    unit: 'px',
    describedBy: hintId,
    // Relative sizes may be negative, so they get the full keyboard.
    ...(relative
      ? { min: 1 - size, max: MAX_IMAGE_SIZE - size }
      : { min: 1, max: MAX_IMAGE_SIZE, inputMode: 'numeric' as const }),
  });

  return (
    <Dialog title="Canvas Size" onCancel={onCancel}>
      <form
        className="dialog-form"
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          if (!valid) return;
          onResize({ width: newWidth, height: newHeight, horizontal, vertical, relative });
        }}
      >
        <div className="size-fields">
          <NumberField
            label={relative ? 'Width change' : 'Width'}
            value={widthText}
            onChange={setWidthText}
            invalid={!isValidImageSize(newWidth, 1)}
            autoFocus
            {...fieldProps(width)}
          />
          <NumberField
            label={relative ? 'Height change' : 'Height'}
            value={heightText}
            onChange={setHeightText}
            invalid={!isValidImageSize(1, newHeight)}
            {...fieldProps(height)}
          />
        </div>
        <label className="check-field">
          <input
            type="checkbox"
            checked={relative}
            onChange={(e) => changeRelative(e.currentTarget.checked)}
          />
          Relative
        </label>
        <fieldset className="anchor-field">
          <legend>Anchor</legend>
          <div className="anchor-grid">
            {ANCHORS.map((v) =>
              ANCHORS.map((h) => (
                <input
                  key={`${v}-${h}`}
                  type="radio"
                  name={anchorGroup}
                  value={`${v}-${h}`}
                  aria-label={anchorName(h, v)}
                  title={anchorName(h, v)}
                  checked={horizontal === h && vertical === v}
                  onChange={() => {
                    setHorizontal(h);
                    setVertical(v);
                  }}
                />
              )),
            )}
          </div>
        </fieldset>
        <p id={hintId} className="field-hint" role={valid ? undefined : 'alert'}>
          {valid
            ? `${newWidth} × ${newHeight} pixels, from ${width} × ${height}. New areas are ` +
              'transparent, and layers keep their pixels past the edges.'
            : relative
              ? `The changes must give a width and height from 1 to ${MAX_IMAGE_SIZE} pixels.`
              : `Width and height must be whole numbers from 1 to ${MAX_IMAGE_SIZE} pixels.`}
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
