import { describe, expect, it } from 'vitest';
import { dropSlot, isNoOpDrop, stackIndexForDrop } from './layer-drag';

describe('dropSlot', () => {
  const midpoints = [10, 30, 50, 70];

  it('finds the gap between rows from the pointer position', () => {
    expect(dropSlot(midpoints, 0)).toBe(0);
    expect(dropSlot(midpoints, 10)).toBe(0);
    expect(dropSlot(midpoints, 11)).toBe(1);
    expect(dropSlot(midpoints, 49)).toBe(2);
    expect(dropSlot(midpoints, 70)).toBe(3);
    expect(dropSlot(midpoints, 500)).toBe(4);
    expect(dropSlot([], 5)).toBe(0);
  });
});

describe('isNoOpDrop', () => {
  it('is true for the gaps on either side of the dragged row', () => {
    expect(isNoOpDrop(1, 1)).toBe(true);
    expect(isNoOpDrop(1, 2)).toBe(true);
    expect(isNoOpDrop(1, 0)).toBe(false);
    expect(isNoOpDrop(1, 3)).toBe(false);
  });
});

describe('stackIndexForDrop', () => {
  // Four layers: rows 0–3 show stack indices 3–0.
  it('moves the top layer to the bottom and back', () => {
    expect(stackIndexForDrop(4, 0, 4)).toBe(0);
    expect(stackIndexForDrop(4, 3, 0)).toBe(3);
  });

  it('accounts for the dragged row leaving its place', () => {
    // Row 1 (index 2) dropped below row 2 (index 1) takes index 1.
    expect(stackIndexForDrop(4, 1, 3)).toBe(1);
    // Row 2 (index 1) dropped above row 1 (index 2) takes index 2.
    expect(stackIndexForDrop(4, 2, 1)).toBe(2);
  });
});
