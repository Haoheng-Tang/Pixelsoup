import { describe, expect, it } from 'vitest';
import { DEFAULT_NEW_DOCUMENT, createBlankDocument } from './blank-document';
import { createLayerId } from './document';
import { getPixel } from './pixel-buffer';

describe('createBlankDocument', () => {
  it('defaults to 1920x1080 on white', () => {
    expect(DEFAULT_NEW_DOCUMENT).toEqual({ width: 1920, height: 1080, background: 'white' });
  });

  it('creates one canvas-sized opaque white Background layer', () => {
    const doc = createBlankDocument({ width: 3, height: 2, background: 'white' });
    expect([doc.width, doc.height]).toEqual([3, 2]);
    expect(doc.layers).toHaveLength(1);
    const background = doc.layers[0];
    if (!background) throw new Error('missing layer');
    expect(background).toMatchObject({ id: 'layer-1', name: 'Background', x: 0, y: 0 });
    expect(background.pixels).toMatchObject({ width: 3, height: 2 });
    expect(getPixel(background.pixels, 2, 1)).toEqual([255, 255, 255, 255]);
    expect(createLayerId(doc)).toBe('layer-2');
  });

  it('leaves the Background transparent when asked', () => {
    const doc = createBlankDocument({ width: 3, height: 2, background: 'transparent' });
    expect(doc.layers[0]?.pixels.data.every((v) => v === 0)).toBe(true);
  });

  it('rejects sizes outside 1–8192', () => {
    expect(() => createBlankDocument({ width: 0, height: 5, background: 'white' })).toThrow();
    expect(() => createBlankDocument({ width: 8193, height: 5, background: 'white' })).toThrow();
  });
});
