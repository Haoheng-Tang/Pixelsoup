import { useEffect, useRef, useState } from 'react';
import { useRevision } from '../use-revision';
import { ColorPicker } from './ColorPicker';
import { toHex } from './color-math';
import type { ColorSlot, Colors } from './colors';

const LABELS: Record<ColorSlot, string> = {
  foreground: 'Foreground colour',
  background: 'Background colour',
};

/**
 * The foreground and background swatches, overlapping as in Photoshop, with buttons to swap
 * them (X) and reset them to black and white (D). Clicking a swatch opens its picker.
 */
export function ColorSwatches({ colors }: { colors: Colors }) {
  useRevision(colors);
  const [editing, setEditing] = useState<ColorSlot | null>(null);
  const group = useRef<HTMLDivElement>(null);
  const swatches = {
    foreground: useRef<HTMLButtonElement>(null),
    background: useRef<HTMLButtonElement>(null),
  };

  useEffect(() => {
    if (!editing) return;
    const onPointerDown = (e: PointerEvent) => {
      if (e.target instanceof Node && group.current?.contains(e.target)) return;
      setEditing(null);
    };
    document.addEventListener('pointerdown', onPointerDown, true);
    return () => document.removeEventListener('pointerdown', onPointerDown, true);
  }, [editing]);

  const close = (refocus: boolean) => {
    if (refocus && editing) swatches[editing].current?.focus();
    setEditing(null);
  };

  const swatch = (slot: ColorSlot) => {
    const hex = toHex(colors.get(slot));
    return (
      <button
        ref={swatches[slot]}
        type="button"
        className={`swatch swatch-${slot}`}
        style={{ backgroundColor: hex }}
        aria-label={`${LABELS[slot]} ${hex}`}
        title={`${LABELS[slot]} ${hex}: click to edit`}
        aria-haspopup="dialog"
        aria-expanded={editing === slot}
        onClick={() => setEditing((current) => (current === slot ? null : slot))}
      />
    );
  };

  return (
    <div ref={group} className="color-swatches" role="group" aria-label="Colours">
      <div className="swatch-stack">
        {swatch('foreground')}
        {swatch('background')}
      </div>
      <div className="swatch-actions">
        <button
          type="button"
          className="swatch-action"
          onClick={() => colors.swap()}
          title="Swap colours (X)"
          aria-label="Swap colours"
        >
          <svg width="12" height="10" viewBox="0 0 12 10" aria-hidden="true">
            <path
              d="M2.5 8.5V4a2 2 0 0 1 2-2h5.5M8 .5 9.8 2 8 3.5M1 7l1.5 1.7L4 7"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.2"
            />
          </svg>
        </button>
        <button
          type="button"
          className="swatch-action"
          onClick={() => colors.reset()}
          title="Default colours (D)"
          aria-label="Default colours"
        >
          <svg width="12" height="10" viewBox="0 0 12 10" aria-hidden="true">
            <rect className="default-background" x="4.5" y="3.5" width="6" height="5" />
            <rect className="default-foreground" x="1.5" y="1.5" width="6" height="5" />
          </svg>
        </button>
      </div>
      {editing && <ColorPicker key={editing} colors={colors} slot={editing} onClose={close} />}
    </div>
  );
}
