import { useId, useState } from 'react';
import type { ExportFormat, ExportOptions } from '../session/file-types';
import { EXPORT_FORMATS } from '../session/file-types';
import { Dialog } from './Dialog';

interface ExportDialogProps {
  initial: ExportOptions;
  /** Called from the Export button's click, so the save picker can open. */
  onExport: (options: ExportOptions) => void;
  onCancel: () => void;
}

const FORMATS = Object.keys(EXPORT_FORMATS) as ExportFormat[];

export function ExportDialog({ initial, onExport, onCancel }: ExportDialogProps) {
  const [format, setFormat] = useState(initial.format);
  const [quality, setQuality] = useState(Math.round(initial.quality * 100));
  const qualityId = useId();
  const info = EXPORT_FORMATS[format];

  return (
    <Dialog title="Export Image" onCancel={onCancel}>
      <form
        className="dialog-form"
        onSubmit={(e) => {
          e.preventDefault();
          onExport({ format, quality: quality / 100 });
        }}
      >
        <fieldset className="choice-group">
          <legend>Format</legend>
          {FORMATS.map((value) => (
            <label key={value}>
              <input
                type="radio"
                name="format"
                value={value}
                checked={format === value}
                onChange={() => setFormat(value)}
                data-autofocus={format === value ? true : undefined}
              />
              {EXPORT_FORMATS[value].label}
            </label>
          ))}
        </fieldset>
        {info.lossy && (
          <div className="range-field">
            <label htmlFor={qualityId}>Quality</label>
            <input
              id={qualityId}
              type="range"
              min={1}
              max={100}
              step={1}
              value={quality}
              onChange={(e) => setQuality(Number(e.currentTarget.value))}
            />
            <output htmlFor={qualityId}>{quality}%</output>
          </div>
        )}
        <p className="field-hint">
          {info.alpha
            ? 'Exports the visible layers, flattened, with transparency.'
            : `${info.label} has no transparency: transparent areas become white.`}
        </p>
        <div className="dialog-actions">
          <button type="button" onClick={onCancel}>
            Cancel
          </button>
          <button type="submit" className="primary">
            Export…
          </button>
        </div>
      </form>
    </Dialog>
  );
}
