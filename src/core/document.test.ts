import { describe, expect, it } from 'vitest';
import { MAX_IMAGE_SIZE, createDocument, createLayerId } from './document';
import { createRasterLayer } from './layer';

describe('createDocument', () => {
  it('accepts sizes from 1 to MAX_IMAGE_SIZE', () => {
    expect(createDocument(1, 1)).toMatchObject({ width: 1, height: 1, layers: [] });
    expect(createDocument(MAX_IMAGE_SIZE, MAX_IMAGE_SIZE).width).toBe(8192);
  });

  it('rejects empty, fractional and oversized documents', () => {
    expect(() => createDocument(0, 10)).toThrow(RangeError);
    expect(() => createDocument(10, 1.5)).toThrow(RangeError);
    expect(() => createDocument(MAX_IMAGE_SIZE + 1, 10)).toThrow(RangeError);
  });
});

describe('createLayerId', () => {
  it('numbers layers per document', () => {
    const a = createDocument(10, 10);
    const b = createDocument(10, 10);
    expect([createLayerId(a), createLayerId(a)]).toEqual(['layer-1', 'layer-2']);
    expect(createLayerId(b)).toBe('layer-1');
  });

  it('never hands out an ID twice, even after the layer is gone', () => {
    const doc = createDocument(10, 10);
    const layer = createRasterLayer({ id: createLayerId(doc), name: 'A', width: 1, height: 1 });
    doc.layers.push(layer);
    doc.layers.pop();
    expect(createLayerId(doc)).toBe('layer-2');
  });

  it('skips IDs that layers already use', () => {
    const doc = createDocument(10, 10);
    for (const id of ['layer-1', 'layer-2', 'layer-4']) {
      doc.layers.push(createRasterLayer({ id, name: id, width: 1, height: 1 }));
    }
    expect(createLayerId(doc)).toBe('layer-3');
    expect(createLayerId(doc)).toBe('layer-5');
  });
});
