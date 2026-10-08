import { describe, expect, it } from 'vitest';
import type { Rgb } from '../../core';
import { hsvToRgb, parseHex, rgbToHsv, rgbToHsvKeeping, sameRgb, toHex } from './color-math';

describe('rgbToHsv', () => {
  it('converts primaries, secondaries and greys', () => {
    expect(rgbToHsv([255, 0, 0])).toEqual({ h: 0, s: 1, v: 1 });
    expect(rgbToHsv([255, 255, 0])).toEqual({ h: 60, s: 1, v: 1 });
    expect(rgbToHsv([0, 255, 0])).toEqual({ h: 120, s: 1, v: 1 });
    expect(rgbToHsv([0, 0, 255])).toEqual({ h: 240, s: 1, v: 1 });
    expect(rgbToHsv([255, 0, 255])).toEqual({ h: 300, s: 1, v: 1 });
    expect(rgbToHsv([0, 0, 0])).toEqual({ h: 0, s: 0, v: 0 });
    expect(rgbToHsv([51, 51, 51])).toEqual({ h: 0, s: 0, v: 0.2 });
  });

  it('works out hue, saturation and value of a mixed colour', () => {
    // max 204 (red), min 51, range 153: s = 153 / 204 = 0.75, v = 204 / 255 = 0.8,
    // h = 60 × (g − b) / range = 60 × (102 − 51) / 153 = 20.
    const { h, s, v } = rgbToHsv([204, 102, 51]);
    expect(h).toBeCloseTo(20, 10);
    expect(s).toBeCloseTo(0.75, 10);
    expect(v).toBeCloseTo(0.8, 10);
  });

  it('keeps hues in 0–360 for colours just short of red', () => {
    // Red is the maximum and b > g, so (g − b) / range is negative and 360 is added.
    const { h } = rgbToHsv([255, 0, 1]);
    expect(h).toBeGreaterThan(359);
    expect(h).toBeLessThan(360);
  });
});

describe('hsvToRgb', () => {
  it('converts every hue sector', () => {
    expect(hsvToRgb({ h: 0, s: 1, v: 1 })).toEqual([255, 0, 0]);
    expect(hsvToRgb({ h: 30, s: 1, v: 1 })).toEqual([255, 128, 0]);
    expect(hsvToRgb({ h: 90, s: 1, v: 1 })).toEqual([128, 255, 0]);
    expect(hsvToRgb({ h: 150, s: 1, v: 1 })).toEqual([0, 255, 128]);
    expect(hsvToRgb({ h: 210, s: 1, v: 1 })).toEqual([0, 128, 255]);
    expect(hsvToRgb({ h: 270, s: 1, v: 1 })).toEqual([128, 0, 255]);
    expect(hsvToRgb({ h: 330, s: 1, v: 1 })).toEqual([255, 0, 128]);
  });

  it('wraps hues and handles grey and black', () => {
    expect(hsvToRgb({ h: 360, s: 1, v: 1 })).toEqual([255, 0, 0]);
    expect(hsvToRgb({ h: -120, s: 1, v: 1 })).toEqual([0, 0, 255]);
    expect(hsvToRgb({ h: 200, s: 0, v: 0.5 })).toEqual([128, 128, 128]);
    expect(hsvToRgb({ h: 200, s: 1, v: 0 })).toEqual([0, 0, 0]);
  });

  it('round-trips every 8-bit colour on a grid', () => {
    for (let r = 0; r <= 255; r += 15) {
      for (let g = 0; g <= 255; g += 15) {
        for (let b = 0; b <= 255; b += 15) {
          const rgb: Rgb = [r, g, b];
          expect(hsvToRgb(rgbToHsv(rgb))).toEqual(rgb);
        }
      }
    }
    expect(hsvToRgb(rgbToHsv([1, 2, 254]))).toEqual([1, 2, 254]);
  });
});

describe('rgbToHsvKeeping', () => {
  const previous = { h: 200, s: 0.6, v: 0.7 };

  it('keeps the previous hue for greys', () => {
    expect(rgbToHsvKeeping([128, 128, 128], previous)).toEqual({ h: 200, s: 0, v: 128 / 255 });
  });

  it('keeps the previous hue and saturation for black', () => {
    expect(rgbToHsvKeeping([0, 0, 0], previous)).toEqual({ h: 200, s: 0.6, v: 0 });
  });

  it('takes everything from a saturated colour', () => {
    expect(rgbToHsvKeeping([0, 255, 0], previous)).toEqual({ h: 120, s: 1, v: 1 });
  });
});

describe('hex', () => {
  it('formats colours as lower-case #rrggbb', () => {
    expect(toHex([255, 0, 171])).toBe('#ff00ab');
    expect(toHex([0, 10, 1])).toBe('#000a01');
  });

  it('parses six and three digits, with or without #', () => {
    expect(parseHex('#FF00ab')).toEqual([255, 0, 171]);
    expect(parseHex('ff00ab')).toEqual([255, 0, 171]);
    expect(parseHex(' #0a1 ')).toEqual([0, 170, 17]);
    expect(parseHex('fff')).toEqual([255, 255, 255]);
  });

  it('rejects anything else', () => {
    for (const text of ['', '#', '#ff', '#ffff', '#fffff', '#fffffff', '#ggg', '12 345', '##fff']) {
      expect(parseHex(text)).toBeNull();
    }
  });

  it('compares colours by value', () => {
    expect(sameRgb([1, 2, 3], [1, 2, 3])).toBe(true);
    expect(sameRgb([1, 2, 3], [1, 2, 4])).toBe(false);
  });
});
