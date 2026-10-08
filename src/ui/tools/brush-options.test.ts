import { describe, expect, it } from 'vitest';
import {
  BrushOptions,
  DEFAULT_BRUSH,
  MAX_BRUSH_SIZE,
  MIN_BRUSH_SIZE,
  sizeToSlider,
  sliderToSize,
} from './brush-options';

describe('BrushOptions', () => {
  it('starts from the defaults, rounding and clamping what it is given', () => {
    expect(new BrushOptions().settings).toEqual(DEFAULT_BRUSH);
    expect(new BrushOptions({ size: 0, hardness: 120, opacity: 0 }).settings).toMatchObject({
      size: MIN_BRUSH_SIZE,
      hardness: 100,
      opacity: 1,
    });
    expect(
      new BrushOptions({ size: 12.6, hardness: -3, opacity: Number.NaN }).settings,
    ).toMatchObject({ size: 13, hardness: 0, opacity: DEFAULT_BRUSH.opacity });
  });

  it('notifies subscribers of changes, and only of changes', () => {
    const options = new BrushOptions();
    let calls = 0;
    const unsubscribe = options.subscribe(() => calls++);
    const first = options.settings;
    options.set({ size: DEFAULT_BRUSH.size, hardness: 100.2 });
    expect(options.settings).toBe(first);
    expect(calls).toBe(0);

    options.set({ size: 640, pressureTarget: 'both' });
    expect(options.settings).toMatchObject({ size: MAX_BRUSH_SIZE, pressureTarget: 'both' });
    expect(options.settings).not.toBe(first);
    expect(calls).toBe(1);

    // Numbers that aren't finite keep the setting as it was.
    options.set({ size: Number.NaN, hardness: Number.POSITIVE_INFINITY });
    expect(options.settings).toMatchObject({ size: MAX_BRUSH_SIZE, hardness: 100 });
    expect(calls).toBe(1);

    unsubscribe();
    options.set({ pressure: false });
    expect(options.settings.pressure).toBe(false);
    expect(calls).toBe(1);
  });

  it('steps the size through the stops, finer for small brushes', () => {
    const options = new BrushOptions({ size: 9 });
    expect(options.stepSize(1)).toBe(10);
    expect(options.stepSize(1)).toBe(20);
    expect(options.stepSize(-1)).toBe(10);
    expect(options.stepSize(-1)).toBe(9);
    // From between two stops, to the next one either way.
    options.set({ size: 33 });
    expect(options.stepSize(1)).toBe(40);
    options.set({ size: 33 });
    expect(options.stepSize(-1)).toBe(30);
    options.set({ size: 450 });
    expect(options.stepSize(1)).toBe(500);
    expect(options.stepSize(1)).toBe(500);
    options.set({ size: 1 });
    expect(options.stepSize(-1)).toBe(1);
  });

  it('steps the hardness by quarters', () => {
    const options = new BrushOptions({ hardness: 60 });
    expect(options.stepHardness(1)).toBe(75);
    expect(options.stepHardness(1)).toBe(100);
    expect(options.stepHardness(1)).toBe(100);
    options.set({ hardness: 60 });
    expect(options.stepHardness(-1)).toBe(50);
    expect(options.stepHardness(-1)).toBe(25);
    expect(options.stepHardness(-1)).toBe(0);
    expect(options.stepHardness(-1)).toBe(0);
  });

  it('spreads sizes exponentially along the slider', () => {
    expect(sizeToSlider(MIN_BRUSH_SIZE)).toBe(0);
    expect(sizeToSlider(MAX_BRUSH_SIZE)).toBe(1);
    expect(sliderToSize(0)).toBe(MIN_BRUSH_SIZE);
    expect(sliderToSize(1)).toBe(MAX_BRUSH_SIZE);
    // Halfway along is the geometric mean of 1 and 500: √500 ≈ 22.4.
    expect(sliderToSize(0.5)).toBe(22);
    for (let size = MIN_BRUSH_SIZE; size <= MAX_BRUSH_SIZE; size++) {
      expect(sliderToSize(sizeToSlider(size))).toBe(size);
    }
  });
});
