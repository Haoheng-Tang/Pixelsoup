import type { Rgb } from '../../core';

/** A colour as hue (degrees, 0–360), saturation and value (0–1), as colour pickers show it. */
export interface Hsv {
  readonly h: number;
  readonly s: number;
  readonly v: number;
}

export function rgbToHsv([r, g, b]: Rgb): Hsv {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const range = max - min;
  let h = 0;
  if (range > 0) {
    if (max === r) h = (g - b) / range;
    else if (max === g) h = (b - r) / range + 2;
    else h = (r - g) / range + 4;
    h *= 60;
    if (h < 0) h += 360;
  }
  return { h, s: max === 0 ? 0 : range / max, v: max / 255 };
}

/** The nearest 8-bit colour. */
export function hsvToRgb({ h, s, v }: Hsv): Rgb {
  const sector = (((h % 360) + 360) % 360) / 60;
  const chroma = v * s;
  const mid = chroma * (1 - Math.abs((sector % 2) - 1));
  const low = v - chroma;
  let r = 0;
  let g = 0;
  let b = 0;
  switch (Math.floor(sector)) {
    case 0:
      [r, g] = [chroma, mid];
      break;
    case 1:
      [r, g] = [mid, chroma];
      break;
    case 2:
      [g, b] = [chroma, mid];
      break;
    case 3:
      [g, b] = [mid, chroma];
      break;
    case 4:
      [r, b] = [mid, chroma];
      break;
    default:
      [r, b] = [chroma, mid];
  }
  return [toByte(r + low), toByte(g + low), toByte(b + low)];
}

function toByte(unit: number): number {
  return Math.min(255, Math.max(0, Math.round(unit * 255)));
}

/**
 * The HSV of `rgb`, keeping the hue (and saturation) of `previous` where `rgb` has none to
 * give: greys have no hue, and black no saturation either. So dragging a picker to a
 * grey or black and back doesn't lose the hue the user picked.
 */
export function rgbToHsvKeeping(rgb: Rgb, previous: Hsv): Hsv {
  const hsv = rgbToHsv(rgb);
  if (hsv.v === 0) return { h: previous.h, s: previous.s, v: 0 };
  if (hsv.s === 0) return { h: previous.h, s: 0, v: hsv.v };
  return hsv;
}

/** `#rrggbb`, lower case. */
export function toHex(rgb: Rgb): string {
  return `#${rgb.map((channel) => channel.toString(16).padStart(2, '0')).join('')}`;
}

/** Parses `rrggbb` or `rgb` hex digits, with or without a leading `#`. Null if invalid. */
export function parseHex(text: string): Rgb | null {
  const digits = text.trim().replace(/^#/, '');
  if (!/^([0-9a-f]{3}|[0-9a-f]{6})$/i.test(digits)) return null;
  const full = digits.length === 3 ? digits.replace(/./g, '$&$&') : digits;
  const value = Number.parseInt(full, 16);
  return [(value >> 16) & 255, (value >> 8) & 255, value & 255];
}

export function sameRgb(a: Rgb, b: Rgb): boolean {
  return a[0] === b[0] && a[1] === b[1] && a[2] === b[2];
}
