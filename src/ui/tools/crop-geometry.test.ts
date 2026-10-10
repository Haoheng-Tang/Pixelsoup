import { describe, expect, it } from 'vitest';
import { drawBox, hitCursor, hitTest, moveBox, reshapeBox, resizeBox } from './crop-geometry';
import { cropRatio, CropOptions, orientedRatio } from './crop-options';

const box = { x: 10, y: 20, width: 30, height: 30 };

describe('hitTest', () => {
  it('finds corners, edges, the inside and the outside', () => {
    expect(hitTest(box, 10, 20, 2)).toBe('nw');
    expect(hitTest(box, 40, 20, 2)).toBe('ne');
    expect(hitTest(box, 40, 50, 2)).toBe('se');
    expect(hitTest(box, 10, 50, 2)).toBe('sw');
    expect(hitTest(box, 25, 20, 2)).toBe('n');
    expect(hitTest(box, 41, 35, 2)).toBe('e');
    expect(hitTest(box, 25, 51.5, 2)).toBe('s');
    expect(hitTest(box, 8.5, 35, 2)).toBe('w');
    expect(hitTest(box, 25, 35, 2)).toBe('inside');
    expect(hitTest(box, 7, 35, 2)).toBe('outside');
    expect(hitTest(box, 25, 53, 2)).toBe('outside');
  });

  it('grabs edges only a third of the way into a small box', () => {
    const small = { x: 0, y: 0, width: 3, height: 3 };
    // A tolerance of 5 would cover the whole box; a third (1 px) leaves the middle to move.
    expect(hitTest(small, 1.5, 1.5, 5)).toBe('inside');
    expect(hitTest(small, 0.9, 1.5, 5)).toBe('w');
    expect(hitTest(small, 2.1, 2.1, 5)).toBe('se');
    expect(hitTest(small, -4, 1.5, 5)).toBe('w');
  });

  it('maps hits to cursors', () => {
    expect(hitCursor('n')).toBe('ns-resize');
    expect(hitCursor('w')).toBe('ew-resize');
    expect(hitCursor('ne')).toBe('nesw-resize');
    expect(hitCursor('se')).toBe('nwse-resize');
    expect(hitCursor('inside')).toBe('move');
    expect(hitCursor('outside')).toBe('crosshair');
  });
});

describe('drawBox', () => {
  it('spans the anchor and the point in either direction', () => {
    expect(drawBox(10, 10, 15, 13, null, false)).toEqual({ x: 10, y: 10, width: 5, height: 3 });
    expect(drawBox(10, 10, 4, 2, null, false)).toEqual({ x: 4, y: 2, width: 6, height: 8 });
  });

  it('is at least a pixel each way', () => {
    expect(drawBox(10, 10, 10, 14, null, false)).toEqual({ x: 10, y: 10, width: 1, height: 4 });
  });

  it('keeps a ratio, the longer side winning', () => {
    // 8 × 3 at 1:1: the width wins, 8 × 8.
    expect(drawBox(0, 0, 8, 3, 1, false)).toEqual({ x: 0, y: 0, width: 8, height: 8 });
    // 3 × 8 at 3:2: width 3 < 8 × 1.5, so the height wins: round(8 × 1.5) = 12 wide.
    expect(drawBox(0, 0, 3, 8, 1.5, false)).toEqual({ x: 0, y: 0, width: 12, height: 8 });
    // Dragged up and left, the box grows from the anchor that way too.
    expect(drawBox(20, 20, 12, 17, 1, false)).toEqual({ x: 12, y: 12, width: 8, height: 8 });
  });

  it('grows around the anchor from the centre', () => {
    expect(drawBox(10, 10, 13, 12, null, true)).toEqual({ x: 7, y: 8, width: 6, height: 4 });
    expect(drawBox(10, 10, 7, 13, 1, true)).toEqual({ x: 7, y: 7, width: 6, height: 6 });
  });
});

describe('resizeBox', () => {
  const start = { x: 0, y: 0, width: 10, height: 10 };

  it('moves the dragged edges only', () => {
    expect(resizeBox(start, 'e', 4, 9, null, false)).toEqual({ x: 0, y: 0, width: 14, height: 10 });
    expect(resizeBox(start, 'n', 9, 3, null, false)).toEqual({ x: 0, y: 3, width: 10, height: 7 });
    expect(resizeBox(start, 'nw', -2, -3, null, false)).toEqual({
      x: -2,
      y: -3,
      width: 12,
      height: 13,
    });
    expect(resizeBox(start, 'se', 1, -4, null, false)).toEqual({
      x: 0,
      y: 0,
      width: 11,
      height: 6,
    });
  });

  it('turns around when an edge passes the other one', () => {
    // The right edge, dragged from 10 to −5, now spans −5..0.
    expect(resizeBox(start, 'e', -15, 0, null, false)).toEqual({
      x: -5,
      y: 0,
      width: 5,
      height: 10,
    });
    // Onto the other edge: one pixel, on the side it came from.
    expect(resizeBox(start, 'e', -10, 0, null, false)).toEqual({
      x: 0,
      y: 0,
      width: 1,
      height: 10,
    });
    expect(resizeBox(start, 'w', 10, 0, null, false)).toEqual({
      x: 9,
      y: 0,
      width: 1,
      height: 10,
    });
  });

  it('keeps a ratio from an edge, centring the other side', () => {
    // 14 wide at 1:1 is 14 tall, centred on 0..10: (0 + 10 − 14) / 2 = −2.
    expect(resizeBox(start, 'e', 4, 0, 1, false)).toEqual({ x: 0, y: -2, width: 14, height: 14 });
    // 8 tall at 3:2 is 12 wide, centred: floor((0 + 10 − 12) / 2) = −1.
    expect(resizeBox(start, 's', 0, -2, 1.5, false)).toEqual({
      x: -1,
      y: 0,
      width: 12,
      height: 8,
    });
  });

  it('keeps a ratio from a corner, the longer side winning', () => {
    expect(resizeBox(start, 'se', 4, 1, 1, false)).toEqual({ x: 0, y: 0, width: 14, height: 14 });
    // The opposite corner (10, 10) stays put.
    expect(resizeBox(start, 'nw', -4, -1, 1, false)).toEqual({
      x: -4,
      y: -4,
      width: 14,
      height: 14,
    });
  });

  it('resizes about the centre', () => {
    // Both edges move 2 px apart: −2..12.
    expect(resizeBox(start, 'e', 2, 0, null, true)).toEqual({ x: -2, y: 0, width: 14, height: 10 });
    // The right edge at 2 and its mirror at 8.
    expect(resizeBox(start, 'e', -8, 0, null, true)).toEqual({ x: 2, y: 0, width: 6, height: 10 });
    expect(resizeBox(start, 'se', 2, 1, 1, true)).toEqual({ x: -2, y: -2, width: 14, height: 14 });
  });
});

describe('moveBox and reshapeBox', () => {
  it('moves by whole pixels', () => {
    expect(moveBox(box, -12, 3)).toEqual({ x: -2, y: 23, width: 30, height: 30 });
  });

  it('keeps the area and centre while changing the shape', () => {
    // 400 px² at 1:1 is 20 × 20, centred on (20, 5).
    expect(reshapeBox({ x: 0, y: 0, width: 40, height: 10 }, 1)).toEqual({
      x: 10,
      y: -5,
      width: 20,
      height: 20,
    });
    // 1200 px² at 3:4: width round(√900) = 30, height 40, centred on (20, 15).
    expect(reshapeBox({ x: 0, y: 0, width: 40, height: 30 }, 0.75)).toEqual({
      x: 5,
      y: -5,
      width: 30,
      height: 40,
    });
  });
});

describe('crop options', () => {
  it('gives each preset its ratio', () => {
    const settings = new CropOptions().settings;
    expect(cropRatio(settings, 300, 200)).toBeNull();
    expect(cropRatio({ ...settings, aspect: 'original' }, 300, 200)).toEqual({
      ratio: 1.5,
      turns: true,
    });
    expect(cropRatio({ ...settings, aspect: '16:9' }, 300, 200)?.ratio).toBeCloseTo(16 / 9);
    expect(cropRatio({ ...settings, aspect: 'custom' }, 300, 200)).toEqual({
      ratio: 1.25,
      turns: false,
    });
  });

  it('turns presets to suit the box, but not custom ratios', () => {
    expect(orientedRatio({ ratio: 4 / 3, turns: true }, true)).toBeCloseTo(4 / 3);
    expect(orientedRatio({ ratio: 4 / 3, turns: true }, false)).toBeCloseTo(3 / 4);
    // The original of a portrait image turns into landscape for a landscape box.
    expect(orientedRatio({ ratio: 0.5, turns: true }, true)).toBe(2);
    expect(orientedRatio({ ratio: 1.25, turns: false }, false)).toBe(1.25);
  });

  it('ignores invalid custom ratio terms and notifies only on a change', () => {
    const options = new CropOptions();
    let calls = 0;
    const unsubscribe = options.subscribe(() => calls++);
    options.set({ customWidth: 0, customHeight: Number.NaN });
    expect(calls).toBe(0);
    options.set({ customWidth: 2.35, customHeight: 1, aspect: 'custom' });
    expect(options.settings).toMatchObject({
      aspect: 'custom',
      customWidth: 2.35,
      customHeight: 1,
    });
    expect(calls).toBe(1);
    options.set({ customWidth: 20000 });
    expect(options.settings.customWidth).toBe(2.35);
    expect(calls).toBe(1);
    unsubscribe();
    options.set({ deleteCropped: true });
    expect(calls).toBe(1);
  });
});
