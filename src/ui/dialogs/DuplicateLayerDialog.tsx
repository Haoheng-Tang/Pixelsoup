import { useEffect, useId, useRef, useState } from 'react';
import { duplicateName } from '../../core';
import { Dialog } from './Dialog';

interface DuplicateLayerDialogProps {
  /** The name of the layer being duplicated. */
  layerName: string;
  /** Called with the copy's name, never blank. */
  onDuplicate: (name: string) => void;
  onCancel: () => void;
}

/**
 * Asks for the copy's name, "<name> copy" to start with and selected so it can be typed
 * over. Enter duplicates; a blank name is refused, as when renaming a layer.
 */
export function DuplicateLayerDialog({
  layerName,
  onDuplicate,
  onCancel,
}: DuplicateLayerDialogProps) {
  const [name, setName] = useState(() => duplicateName(layerName));
  const inputRef = useRef<HTMLInputElement>(null);
  const inputId = useId();
  const valid = name.trim() !== '';

  // After the dialog has focused the field.
  useEffect(() => inputRef.current?.select(), []);

  return (
    <Dialog title="Duplicate Layer" onCancel={onCancel}>
      <form
        className="dialog-form"
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          if (valid) onDuplicate(name);
        }}
      >
        <p className="dialog-text">
          Duplicate: <span>{layerName}</span>
        </p>
        <div className="field">
          <label htmlFor={inputId}>As:</label>
          <input
            ref={inputRef}
            id={inputId}
            type="text"
            value={name}
            onChange={(e) => setName(e.currentTarget.value)}
            aria-invalid={!valid}
            spellCheck={false}
            autoComplete="off"
            data-autofocus
          />
        </div>
        <div className="dialog-actions">
          <button type="button" onClick={onCancel}>
            Cancel
          </button>
          <button type="submit" className="primary" disabled={!valid}>
            OK
          </button>
        </div>
      </form>
    </Dialog>
  );
}
