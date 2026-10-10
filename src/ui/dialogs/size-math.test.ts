import { describe, expect, it } from 'vitest';
import {
  canvasPixels,
  convertSizeText,
  parseDecimal,
  parseWhole,
  proportionalText,
  sizeText,
  toPixels,
  toggleRelativeText,
} from './size-math';

describe('parsing', () => {
  it('reads whole numbers, signed only when asked', () => {
    expect(parseWhole('12')).toBe(12);
    expect(parseWhole(' 7 ')).toBe(7);
    for (const text of ['', '-3', '1.5', '1e3', 'x']) expect(parseWhole(text)).toBeNaN();
    expect(parseWhole('-3', true)).toBe(-3);
    expect(parseWhole('+3', true)).toBe(3);
  });

  it('reads decimals', () => {
    expect(parseDecimal('12')).toBe(12);
    expect(parseDecimal('-0.5')).toBe(-0.5);
    expect(parseDecimal('.5')).toBe(0.5);
    expect(parseDecimal('3.')).toBe(3);
    for (const text of ['', '-', '.', '1e3', '1.2.3']) expect(parseDecimal(text)).toBeNaN();
  });
});

describe('Image Size fields', () => {
  it('turns pixels or percentages into pixels', () => {
    expect(toPixels('640', 'pixels', 1920)).toBe(640);
    expect(toPixels('50', 'percent', 1920)).toBe(960);
    // 1080 × 33.3 / 100 = 359.64
    expect(toPixels('33.3', 'percent', 1080)).toBe(360);
    expect(toPixels('12.5', 'pixels', 1920)).toBeNaN();
  });

  it('shows sizes as pixels or percentages to two places', () => {
    expect(sizeText(960, 'pixels', 1920)).toBe('960');
    expect(sizeText(960, 'percent', 1920)).toBe('50');
    // 640 / 1920 = 33.333…%
    expect(sizeText(640, 'percent', 1920)).toBe('33.33');
  });

  it('keeps the aspect ratio: same percentage, or pixels in proportion', () => {
    expect(proportionalText('75', 'percent', 1920, 1080)).toBe('75');
    // 1000 × 1080 / 1920 = 562.5, rounded up
    expect(proportionalText('1000', 'pixels', 1920, 1080)).toBe('563');
    // Never below one pixel: 1 × 1 / 1000 rounds to 0
    expect(proportionalText('1', 'pixels', 1000, 1)).toBe('1');
    expect(proportionalText('', 'pixels', 1920, 1080)).toBeNull();
    expect(proportionalText('0', 'percent', 1920, 1080)).toBeNull();
  });

  it('converts a field between units', () => {
    expect(convertSizeText('960', 'pixels', 'percent', 1920)).toBe('50');
    expect(convertSizeText('33.33', 'percent', 'pixels', 1920)).toBe('640');
    expect(convertSizeText('oops', 'pixels', 'percent', 1920)).toBe('oops');
  });
});

describe('Canvas Size fields', () => {
  it('reads absolute sizes or changes', () => {
    expect(canvasPixels('800', false, 600)).toBe(800);
    expect(canvasPixels('-100', true, 600)).toBe(500);
    expect(canvasPixels('-100', false, 600)).toBeNaN();
  });

  it('converts a field when Relative is toggled', () => {
    expect(toggleRelativeText('800', false, 600)).toBe('200');
    expect(toggleRelativeText('200', true, 600)).toBe('800');
    expect(toggleRelativeText('-50', true, 600)).toBe('550');
    expect(toggleRelativeText('', false, 600)).toBe('');
  });
});
