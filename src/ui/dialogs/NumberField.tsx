import { useId } from 'react';

interface NumberFieldProps {
  label: string;
  value: string;
  onChange: (value: string) => void;
  /** Shown after the field, e.g. "px". */
  unit: string;
  invalid: boolean;
  describedBy: string;
  min?: number | undefined;
  max?: number | undefined;
  /** `'any'` allows decimals. */
  step?: number | 'any';
  /** The on-screen keyboard; leave it out for fields that take negative numbers. */
  inputMode?: 'numeric' | 'decimal' | undefined;
  autoFocus?: boolean;
}

/** A labelled number input with its unit after it, laid out by `.field`. */
export function NumberField({
  label,
  value,
  onChange,
  unit,
  invalid,
  describedBy,
  min,
  max,
  step = 1,
  inputMode,
  autoFocus,
}: NumberFieldProps) {
  const id = useId();
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <input
        id={id}
        type="number"
        inputMode={inputMode}
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(e.currentTarget.value)}
        aria-invalid={invalid}
        aria-describedby={describedBy}
        data-autofocus={autoFocus}
      />
      <span className="unit" aria-hidden="true">
        {unit}
      </span>
    </div>
  );
}
