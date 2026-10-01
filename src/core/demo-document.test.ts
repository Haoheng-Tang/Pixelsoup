import { describe, expect, it } from 'vitest';
import { createDemoDocument } from './demo-document';
import { getPixel } from './pixel-buffer';

describe('createDemoDocument', () => {
  it('creates an 800x600 document with a transparent bottom layer and a test pattern on top', () => {
    const doc = createDemoDocument();
    expect([doc.width, doc.height]).toEqual([800, 600]);
    expect(doc.selection).toBeNull();
    expect(doc.layers.map((l) => l.name)).toEqual(['Background', 'Test Pattern']);

    const [bottom, top] = doc.layers;
    expect(bottom?.pixels.data.every((v) => v === 0)).toBe(true);
    expect(top?.pixels.data.some((v) => v !== 0)).toBe(true);
    expect(new Set(doc.layers.map((l) => l.id)).size).toBe(2);
  });

  it('draws opaque content at the centre of the red circle', () => {
    const top = createDemoDocument().layers[1];
    if (!top) throw new Error('missing layer');
    expect(getPixel(top.pixels, 190, 330)).toEqual([230, 57, 70, 255]);
  });
});
