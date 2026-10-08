import { describe, expect, it } from 'vitest';
import { FULL_WEIGHT, OPACITY_STEPS, erasePixel, opacitySteps, paintPixel } from './paint-math';

const RED = [255, 0, 0] as const;

/** Weight of mask m and selection coverage c at the given opacity. */
const weight = (m: number, c: number, opacity: number) => m * c * opacitySteps(opacity);

function paint(original: readonly number[], color: readonly number[], w: number): number[] {
  const out = new Uint8ClampedArray(4);
  paintPixel(out, 0, new Uint8ClampedArray(original), 0, color[0], color[1], color[2], w);
  return [...out];
}

function erase(original: readonly number[], w: number): number[] {
  const out = new Uint8ClampedArray(4);
  erasePixel(out, 0, new Uint8ClampedArray(original), 0, w);
  return [...out];
}

describe('opacitySteps', () => {
  it('quantises opacity to whole steps', () => {
    expect(opacitySteps(1)).toBe(OPACITY_STEPS);
    expect(opacitySteps(0.5)).toBe(5000);
    expect(opacitySteps(2)).toBe(OPACITY_STEPS);
    expect(opacitySteps(-1)).toBe(0);
    expect(weight(255, 255, 1)).toBe(FULL_WEIGHT);
  });
});

describe('paintPixel', () => {
  const opaque = [100, 150, 200, 255];
  const translucent = [100, 150, 200, 128];
  const transparent = [0, 0, 0, 0];

  it('replaces a pixel at full weight', () => {
    for (const original of [opaque, translucent, transparent]) {
      expect(paint(original, RED, FULL_WEIGHT)).toEqual([255, 0, 0, 255]);
    }
  });

  it('leaves a pixel alone at zero weight', () => {
    expect(paint(opaque, RED, 0)).toEqual(opaque);
    expect(paint(translucent, RED, 0)).toEqual(translucent);
    expect(paint([9, 8, 7, 0], RED, 0)).toEqual([9, 8, 7, 0]);
  });

  it('mixes into an opaque pixel', () => {
    // p = 0.5: (255 + 100) / 2 = 177.5 → 178, 150 / 2 = 75, 200 / 2 = 100.
    expect(paint(opaque, RED, weight(255, 255, 0.5))).toEqual([178, 75, 100, 255]);
    // Half-covered selection at 50 % opacity: p = 128/255 × 0.5 = 0.250980…
    // 100 + 155p = 138.90 → 139, 150 (1 − p) = 112.35 → 112, 200 (1 − p) = 149.80 → 150.
    expect(paint(opaque, RED, weight(255, 128, 0.5))).toEqual([139, 112, 150, 255]);
    // Mask 64 at 30 %: p = 64/255 × 0.3 = 0.075294…
    // 100 + 155p = 111.67 → 112, 150 (1 − p) = 138.71 → 139, 200 (1 − p) = 184.94 → 185.
    expect(paint(opaque, RED, weight(64, 255, 0.3))).toEqual([112, 139, 185, 255]);
  });

  it('paints over a translucent pixel', () => {
    // p = 0.5 over alpha 128: alpha 127.5 + 64 = 191.5 → 192, and each channel is
    // (127.5 C + 64 c) / 191.5: red 38912.5 / 191.5 = 203.20 → 203,
    // green 9600 / 191.5 = 50.13 → 50, blue 12800 / 191.5 = 66.84 → 67.
    expect(paint(translucent, RED, weight(255, 255, 0.5))).toEqual([203, 50, 67, 192]);
    // Green (0, 255, 0) at p = 0.25 over (40, 80, 120, 60): alpha 63.75 + 45 = 108.75 →
    // 109; red 1800 / 108.75 = 16.55 → 17, green (16256.25 + 3600) / 108.75 = 182.59 →
    // 183, blue 5400 / 108.75 = 49.66 → 50.
    expect(paint([40, 80, 120, 60], [0, 255, 0], weight(255, 255, 0.25))).toEqual([
      17, 183, 50, 109,
    ]);
  });

  it('paints the colour itself onto a transparent pixel', () => {
    // Whatever colour a transparent pixel has doesn't show through.
    expect(paint(transparent, RED, weight(255, 255, 0.5))).toEqual([255, 0, 0, 128]);
    expect(paint([90, 90, 90, 0], RED, weight(255, 128, 0.1))).toEqual([255, 0, 0, 13]);
    // Too little to round up to any alpha at all: the pixel is left as it was.
    expect(paint([90, 90, 90, 0], RED, 1)).toEqual([90, 90, 90, 0]);
  });
});

describe('erasePixel', () => {
  it('scales alpha and keeps the colour', () => {
    expect(erase([100, 150, 200, 255], weight(255, 255, 0.5))).toEqual([100, 150, 200, 128]);
    // 255 × (1 − 128/510) = 255 − 64 = 191 exactly.
    expect(erase([100, 150, 200, 255], weight(255, 128, 0.5))).toEqual([100, 150, 200, 191]);
    expect(erase([100, 150, 200, 128], weight(255, 255, 0.5))).toEqual([100, 150, 200, 64]);
    // 1 × 0.5 = 0.5 rounds up.
    expect(erase([100, 150, 200, 1], weight(255, 255, 0.5))).toEqual([100, 150, 200, 1]);
    // 200 × (1 − 64/255 × 0.3) = 184.94 → 185.
    expect(erase([1, 2, 3, 200], weight(64, 255, 0.3))).toEqual([1, 2, 3, 185]);
  });

  it('leaves transparent black where it erases everything', () => {
    expect(erase([100, 150, 200, 255], FULL_WEIGHT)).toEqual([0, 0, 0, 0]);
    expect(erase([100, 150, 200, 1], weight(255, 255, 0.6))).toEqual([0, 0, 0, 0]);
    expect(erase([5, 5, 5, 0], weight(255, 255, 0.2))).toEqual([0, 0, 0, 0]);
  });

  it('leaves a pixel alone at zero weight', () => {
    expect(erase([100, 150, 200, 77], 0)).toEqual([100, 150, 200, 77]);
  });
});
