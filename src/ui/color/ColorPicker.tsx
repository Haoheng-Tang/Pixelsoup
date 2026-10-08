import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { KeyboardEvent, PointerEvent, RefObject } from 'react';
import type { Rgb } from '../../core';
import { useRevision } from '../use-revision';
import type { Hsv } from './color-math';
import { hsvToRgb, parseHex, rgbToHsv, rgbToHsvKeeping, sameRgb, toHex } from './color-math';
import type { ColorSlot, Colors } from './colors';

const SLOT_NAMES: Record<ColorSlot, string> = {
  foreground: 'Foreground colour',
  background: 'Background colour',
};

interface ColorPickerProps {
  colors: Colors;
  slot: ColorSlot;
  /** Closes the picker; `refocus` when it was closed from the keyboard. */
  onClose: (refocus: boolean) => void;
}

/**
 * Edits one of the colours live: a saturation/brightness square and a hue strip drawn on
 * canvases, plus hex and R, G, B fields. Enter or a click elsewhere keeps the colour,
 * Escape restores the one it had when the picker opened.
 */
export function ColorPicker({ colors, slot, onClose }: ColorPickerProps) {
  useRevision(colors);
  const rgb = colors.get(slot);
  const [original] = useState(rgb);
  // The picker keeps its own HSV so the hue survives greys and black, where RGB has none.
  const [state, setState] = useState(() => ({ rgb, hsv: rgbToHsv(rgb) }));
  // Follow changes made elsewhere while it's open (X, D, the eyedropper).
  const hsv = sameRgb(state.rgb, rgb) ? state.hsv : rgbToHsvKeeping(rgb, state.hsv);
  const hexInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    hexInput.current?.focus();
    hexInput.current?.select();
  }, []);

  const setHsv = (next: Hsv) => {
    const nextRgb = hsvToRgb(next);
    setState({ rgb: nextRgb, hsv: next });
    colors.set(slot, nextRgb);
  };
  const setRgb = (next: Rgb) => {
    setState({ rgb: next, hsv: rgbToHsvKeeping(next, hsv) });
    colors.set(slot, next);
  };

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      colors.set(slot, original);
      onClose(true);
    } else if (e.key === 'Enter') {
      onClose(true);
    } else {
      return;
    }
    e.preventDefault();
    e.stopPropagation();
  };

  return (
    <div className="color-picker" role="dialog" aria-label={SLOT_NAMES[slot]} onKeyDown={onKeyDown}>
      <SaturationBrightness hsv={hsv} onChange={setHsv} />
      <HueStrip hsv={hsv} onChange={setHsv} />
      <div className="color-picker-fields">
        <div className="color-compare">
          <span className="color-compare-new" style={{ backgroundColor: toHex(rgb) }} />
          <button
            type="button"
            className="color-compare-original"
            style={{ backgroundColor: toHex(original) }}
            onClick={() => setRgb(original)}
            title={`Original colour ${toHex(original)}: click to restore it`}
            aria-label={`Restore the original colour, ${toHex(original)}`}
          />
        </div>
        <HexField rgb={rgb} onChange={setRgb} inputRef={hexInput} />
        <ChannelField label="R" value={rgb[0]} onChange={(r) => setRgb([r, rgb[1], rgb[2]])} />
        <ChannelField label="G" value={rgb[1]} onChange={(g) => setRgb([rgb[0], g, rgb[2]])} />
        <ChannelField label="B" value={rgb[2]} onChange={(b) => setRgb([rgb[0], rgb[1], b])} />
      </div>
    </div>
  );
}

interface HsvControlProps {
  hsv: Hsv;
  onChange: (next: Hsv) => void;
}

/** Saturation left to right, brightness bottom to top, for the current hue. */
function SaturationBrightness({ hsv, onChange }: HsvControlProps) {
  const canvas = useRef<HTMLCanvasElement>(null);
  useLayoutEffect(() => {
    if (canvas.current) drawSaturationBrightness(canvas.current, hsv.h);
  }, [hsv.h]);

  const pick = (e: PointerEvent<HTMLElement>) => {
    const bounds = e.currentTarget.getBoundingClientRect();
    onChange({
      h: hsv.h,
      s: unit((e.clientX - bounds.left) / bounds.width),
      v: 1 - unit((e.clientY - bounds.top) / bounds.height),
    });
  };

  const onKeyDown = (e: KeyboardEvent) => {
    const step = e.shiftKey ? 0.1 : 0.01;
    let { s, v } = hsv;
    if (e.key === 'ArrowLeft') s -= step;
    else if (e.key === 'ArrowRight') s += step;
    else if (e.key === 'ArrowUp') v += step;
    else if (e.key === 'ArrowDown') v -= step;
    else return;
    e.preventDefault();
    e.stopPropagation();
    onChange({ h: hsv.h, s: unit(s), v: unit(v) });
  };

  return (
    <div
      className="color-sv"
      role="slider"
      tabIndex={0}
      aria-label="Saturation and brightness"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={percent(hsv.s)}
      aria-valuetext={`Saturation ${percent(hsv.s)} %, brightness ${percent(hsv.v)} %`}
      onPointerDown={(e) => startDrag(e, pick)}
      onPointerMove={(e) => continueDrag(e, pick)}
      onKeyDown={onKeyDown}
    >
      <canvas ref={canvas} />
      <span
        className="color-sv-marker"
        style={{ left: `${hsv.s * 100}%`, top: `${(1 - hsv.v) * 100}%` }}
      />
    </div>
  );
}

/** Hue from 0° at the bottom to 360° at the top, as in Photoshop. */
function HueStrip({ hsv, onChange }: HsvControlProps) {
  const canvas = useRef<HTMLCanvasElement>(null);
  useLayoutEffect(() => {
    if (canvas.current) drawHues(canvas.current);
  }, []);

  const pick = (e: PointerEvent<HTMLElement>) => {
    const bounds = e.currentTarget.getBoundingClientRect();
    onChange({ ...hsv, h: (1 - unit((e.clientY - bounds.top) / bounds.height)) * 360 });
  };

  const onKeyDown = (e: KeyboardEvent) => {
    const step = e.shiftKey ? 10 : 1;
    let { h } = hsv;
    if (e.key === 'ArrowUp' || e.key === 'ArrowRight') h += step;
    else if (e.key === 'ArrowDown' || e.key === 'ArrowLeft') h -= step;
    else return;
    e.preventDefault();
    e.stopPropagation();
    onChange({ ...hsv, h: Math.min(360, Math.max(0, h)) });
  };

  return (
    <div
      className="color-hue"
      role="slider"
      tabIndex={0}
      aria-label="Hue"
      aria-orientation="vertical"
      aria-valuemin={0}
      aria-valuemax={360}
      aria-valuenow={Math.round(hsv.h)}
      aria-valuetext={`${Math.round(hsv.h)}°`}
      onPointerDown={(e) => startDrag(e, pick)}
      onPointerMove={(e) => continueDrag(e, pick)}
      onKeyDown={onKeyDown}
    >
      <canvas ref={canvas} />
      <span className="color-hue-marker" style={{ top: `${(1 - hsv.h / 360) * 100}%` }} />
    </div>
  );
}

function startDrag(e: PointerEvent<HTMLElement>, pick: (e: PointerEvent<HTMLElement>) => void) {
  if (e.button !== 0) return;
  e.currentTarget.setPointerCapture(e.pointerId);
  pick(e);
}

function continueDrag(e: PointerEvent<HTMLElement>, pick: (e: PointerEvent<HTMLElement>) => void) {
  if (e.currentTarget.hasPointerCapture(e.pointerId)) pick(e);
}

interface HexFieldProps {
  rgb: Rgb;
  onChange: (rgb: Rgb) => void;
  inputRef: RefObject<HTMLInputElement | null>;
}

/** Applies the colour as soon as the text is valid hex; shows the colour again on blur. */
function HexField({ rgb, onChange, inputRef }: HexFieldProps) {
  const [text, setText] = useState<string | null>(null);
  const shown = text ?? toHex(rgb);
  return (
    <label className="color-field">
      <span>Hex</span>
      <input
        ref={inputRef}
        type="text"
        value={shown}
        maxLength={7}
        spellCheck={false}
        autoComplete="off"
        aria-invalid={parseHex(shown) === null}
        onChange={(e) => {
          setText(e.target.value);
          const parsed = parseHex(e.target.value);
          if (parsed) onChange(parsed);
        }}
        onBlur={() => setText(null)}
      />
    </label>
  );
}

interface ChannelFieldProps {
  label: string;
  value: number;
  onChange: (value: number) => void;
}

function ChannelField({ label, value, onChange }: ChannelFieldProps) {
  const [text, setText] = useState<string | null>(null);
  const shown = text ?? String(value);
  return (
    <label className="color-field">
      <span>{label}</span>
      <input
        type="number"
        min={0}
        max={255}
        step={1}
        value={shown}
        aria-invalid={parseChannel(shown) === null}
        onChange={(e) => {
          setText(e.target.value);
          const parsed = parseChannel(e.target.value);
          if (parsed !== null) onChange(parsed);
        }}
        onBlur={() => setText(null)}
      />
    </label>
  );
}

function parseChannel(text: string): number | null {
  if (!/^\s*\d{1,3}\s*$/.test(text)) return null;
  const value = Number(text);
  return value <= 255 ? value : null;
}

function unit(value: number): number {
  return Math.min(1, Math.max(0, value));
}

function percent(value: number): number {
  return Math.round(value * 100);
}

/** Sizes the canvas's backing store to its CSS size at device resolution. */
function fitCanvas(canvas: HTMLCanvasElement): CanvasRenderingContext2D | null {
  const ratio = window.devicePixelRatio || 1;
  const width = Math.max(1, Math.round(canvas.clientWidth * ratio));
  const height = Math.max(1, Math.round(canvas.clientHeight * ratio));
  if (canvas.width !== width) canvas.width = width;
  if (canvas.height !== height) canvas.height = height;
  return canvas.getContext('2d');
}

/**
 * The hue at full saturation, white fading out to the right, then black fading in towards
 * the bottom: exactly HSV's channel = v × (1 − s + s × hue), blended in sRGB like the app.
 */
function drawSaturationBrightness(canvas: HTMLCanvasElement, hue: number): void {
  const context = fitCanvas(canvas);
  if (!context) return;
  const { width, height } = canvas;
  context.fillStyle = toHex(hsvToRgb({ h: hue, s: 1, v: 1 }));
  context.fillRect(0, 0, width, height);
  const white = context.createLinearGradient(0, 0, width, 0);
  white.addColorStop(0, 'rgb(255 255 255 / 100%)');
  white.addColorStop(1, 'rgb(255 255 255 / 0%)');
  context.fillStyle = white;
  context.fillRect(0, 0, width, height);
  const black = context.createLinearGradient(0, 0, 0, height);
  black.addColorStop(0, 'rgb(0 0 0 / 0%)');
  black.addColorStop(1, 'rgb(0 0 0 / 100%)');
  context.fillStyle = black;
  context.fillRect(0, 0, width, height);
}

function drawHues(canvas: HTMLCanvasElement): void {
  const context = fitCanvas(canvas);
  if (!context) return;
  const gradient = context.createLinearGradient(0, 0, 0, canvas.height);
  for (let stop = 0; stop <= 6; stop++) {
    gradient.addColorStop(stop / 6, toHex(hsvToRgb({ h: 360 - stop * 60, s: 1, v: 1 })));
  }
  context.fillStyle = gradient;
  context.fillRect(0, 0, canvas.width, canvas.height);
}
