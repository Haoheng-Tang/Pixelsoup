import { describe, expect, it } from 'vitest';
import { DEFAULT_REGION, RegionOptions } from './region-options';

describe('RegionOptions', () => {
  it('starts from the defaults, with any given settings', () => {
    expect(new RegionOptions().settings).toEqual(DEFAULT_REGION);
    expect(new RegionOptions({ opacity: 40 }).settings).toEqual({ ...DEFAULT_REGION, opacity: 40 });
  });

  it('rounds and clamps numbers into range, keeping the old value for ones not finite', () => {
    const options = new RegionOptions();
    options.set({ tolerance: 300, opacity: 0 });
    expect(options.settings).toMatchObject({ tolerance: 255, opacity: 1 });
    options.set({ tolerance: -4, opacity: 250 });
    expect(options.settings).toMatchObject({ tolerance: 0, opacity: 100 });
    options.set({ tolerance: 31.5, opacity: 49.4 });
    expect(options.settings).toMatchObject({ tolerance: 32, opacity: 49 });
    options.set({ tolerance: Number.NaN, opacity: Number.POSITIVE_INFINITY });
    expect(options.settings).toMatchObject({ tolerance: 32, opacity: 49 });
  });

  it('tells subscribers about changes only', () => {
    const options = new RegionOptions();
    let calls = 0;
    const unsubscribe = options.subscribe(() => calls++);
    const before = options.settings;
    options.set({ tolerance: 32, contiguous: true });
    expect(calls).toBe(0);
    expect(options.settings).toBe(before);
    options.set({ contiguous: false });
    expect(calls).toBe(1);
    expect(options.settings).not.toBe(before);
    unsubscribe();
    options.set({ sampleAll: true });
    expect(calls).toBe(1);
  });
});
