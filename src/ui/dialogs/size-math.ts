import type { SizeUnit } from '../session/image-options';

/** A whole number such as "12" (or with `signed`, "-12"); anything else, "" included, is NaN. */
export function parseWhole(text: string, signed = false): number {
  return (signed ? /^\s*[-+]?\d+\s*$/ : /^\s*\d+\s*$/).test(text) ? Number(text) : NaN;
}

/** A decimal number such as "12", "-0.5" or ".5"; anything else, "" included, is NaN. */
export function parseDecimal(text: string): number {
  return /^\s*[-+]?(\d+\.?\d*|\.\d+)\s*$/.test(text) ? Number(text) : NaN;
}

/** The pixels a size field asks for: whole pixels, or a percentage of `size`, rounded. */
export function toPixels(text: string, unit: SizeUnit, size: number): number {
  return unit === 'pixels' ? parseWhole(text) : Math.round((size * parseDecimal(text)) / 100);
}

/** What a size field shows for `pixels` of `size`: whole pixels, or a percentage. */
export function sizeText(pixels: number, unit: SizeUnit, size: number): string {
  return unit === 'pixels' ? String(pixels) : String(Math.round((pixels / size) * 10000) / 100);
}

/**
 * The text for the other side when one side's field changes to `text` with the aspect
 * ratio kept: the same percentage, or the pixels in proportion (at least 1). Null if
 * `text` isn't a usable size, which leaves the other side alone.
 */
export function proportionalText(
  text: string,
  unit: SizeUnit,
  from: number,
  to: number,
): string | null {
  const pixels = toPixels(text, unit, from);
  if (!(pixels > 0)) return null;
  return unit === 'percent' ? text : String(Math.max(1, Math.round((pixels * to) / from)));
}

/** A size field's text in another unit; unchanged if it isn't a usable size. */
export function convertSizeText(text: string, from: SizeUnit, to: SizeUnit, size: number): string {
  const pixels = toPixels(text, from, size);
  return from === to || !(pixels > 0) ? text : sizeText(pixels, to, size);
}

/** The pixels a Canvas Size field asks for: a size, or with `relative` a change to `size`. */
export function canvasPixels(text: string, relative: boolean, size: number): number {
  return relative ? size + parseWhole(text, true) : parseWhole(text);
}

/**
 * A Canvas Size field's text when Relative is toggled: from a change to `size` to the size
 * it gives (`relative` true), or back. Unchanged if it isn't a whole number.
 */
export function toggleRelativeText(text: string, relative: boolean, size: number): string {
  const pixels = canvasPixels(text, relative, size);
  if (!Number.isFinite(pixels)) return text;
  return String(relative ? pixels : pixels - size);
}
