import { describe, expect, it, vi } from 'vitest';
import { Colors } from './colors';

describe('Colors', () => {
  it('starts with a black foreground and a white background', () => {
    const colors = new Colors();
    expect(colors.foreground).toEqual([0, 0, 0]);
    expect(colors.background).toEqual([255, 255, 255]);
    expect(colors.get('foreground')).toBe(colors.foreground);
  });

  it('sets colours, rounding and clamping the channels', () => {
    const colors = new Colors();
    colors.set('foreground', [12.4, -5, 300]);
    colors.set('background', [1, 2, 3]);
    expect(colors.foreground).toEqual([12, 0, 255]);
    expect(colors.background).toEqual([1, 2, 3]);
  });

  it('notifies and bumps the revision only when something changes', () => {
    const colors = new Colors();
    const listener = vi.fn();
    colors.subscribe(listener);
    colors.set('foreground', [0, 0, 0]);
    expect(listener).not.toHaveBeenCalled();
    expect(colors.revision).toBe(0);

    colors.set('foreground', [10, 20, 30]);
    expect(listener).toHaveBeenCalledTimes(1);
    expect(colors.revision).toBe(1);
  });

  it('swaps the two colours', () => {
    const colors = new Colors();
    colors.set('foreground', [10, 20, 30]);
    colors.swap();
    expect(colors.foreground).toEqual([255, 255, 255]);
    expect(colors.background).toEqual([10, 20, 30]);
  });

  it('resets to black and white', () => {
    const colors = new Colors();
    colors.set('foreground', [10, 20, 30]);
    colors.set('background', [40, 50, 60]);
    colors.reset();
    expect(colors.foreground).toEqual([0, 0, 0]);
    expect(colors.background).toEqual([255, 255, 255]);
  });

  it('stops notifying after unsubscribing', () => {
    const colors = new Colors();
    const listener = vi.fn();
    const unsubscribe = colors.subscribe(listener);
    unsubscribe();
    colors.swap();
    expect(listener).not.toHaveBeenCalled();
  });
});
