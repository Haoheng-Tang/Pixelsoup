import { describe, expect, it } from 'vitest';
import { createDocument, createLayerId } from '../document';
import type { RasterLayer } from '../layer';
import { createRasterLayer } from '../layer';
import type { Rgba } from '../pixel-buffer';
import { setPixel } from '../pixel-buffer';
import { sampleColor } from './sample-color';

const RED: Rgba = [200, 10, 20, 255];
const HALF_BLUE: Rgba = [0, 0, 255, 128];
const GREEN: Rgba = [0, 255, 0, 255];

/**
 * A 4×3 canvas. The background is opaque red except at (3, 0) and (3, 2), which are
 * transparent. Above it, a 3×2 "Paint" layer at (1, 1) has half-transparent blue at
 * (1, 1) and (3, 2), opaque green at (2, 1), and nothing elsewhere.
 */
function setup() {
  const doc = createDocument(4, 3);
  const background = createRasterLayer({
    id: createLayerId(doc),
    name: 'Background',
    width: 4,
    height: 3,
  });
  for (let y = 0; y < 3; y++) {
    for (let x = 0; x < 4; x++) if (x !== 3 || y === 1) setPixel(background.pixels, x, y, RED);
  }
  const paint: RasterLayer = createRasterLayer({
    id: createLayerId(doc),
    name: 'Paint',
    x: 1,
    y: 1,
    width: 3,
    height: 2,
  });
  setPixel(paint.pixels, 0, 0, HALF_BLUE);
  setPixel(paint.pixels, 1, 0, GREEN);
  setPixel(paint.pixels, 2, 1, HALF_BLUE);
  doc.layers.push(background, paint);
  return { doc, background, paint };
}

describe('sampleColor', () => {
  it('samples the composite of the visible layers', () => {
    const { doc } = setup();
    expect(sampleColor(doc, 0, 0, 'composite')).toEqual([200, 10, 20]);
    expect(sampleColor(doc, 2, 1, 'composite')).toEqual([0, 255, 0]);
    // Half blue (alpha 128/255) over opaque red: red 200 × 127/255 = 99.6, green
    // 10 × 127/255 = 5.0, blue 255 × 128/255 + 20 × 127/255 = 128 + 9.96 = 138.0.
    expect(sampleColor(doc, 1, 1, 'composite')).toEqual([100, 5, 138]);
  });

  it('gives the colour of a partly transparent composite without its transparency', () => {
    const { doc } = setup();
    // Half blue over a transparent background pixel composites to half blue.
    expect(sampleColor(doc, 3, 2, 'composite')).toEqual([0, 0, 255]);
  });

  it('picks nothing where the composite is transparent', () => {
    const { doc } = setup();
    expect(sampleColor(doc, 3, 0, 'composite')).toBeNull();
  });

  it('leaves hidden layers out of the composite', () => {
    const { doc, paint } = setup();
    paint.visible = false;
    expect(sampleColor(doc, 2, 1, 'composite')).toEqual([200, 10, 20]);
  });

  it("samples one layer's own pixels, unblended and at its offset", () => {
    const { doc, background, paint } = setup();
    expect(sampleColor(doc, 1, 1, { layerId: paint.id })).toEqual([0, 0, 255]);
    expect(sampleColor(doc, 2, 1, { layerId: paint.id })).toEqual([0, 255, 0]);
    expect(sampleColor(doc, 1, 1, { layerId: background.id })).toEqual([200, 10, 20]);
    paint.visible = false;
    expect(sampleColor(doc, 2, 1, { layerId: paint.id })).toEqual([0, 255, 0]);
  });

  it("picks nothing where the layer is transparent or doesn't reach", () => {
    const { doc, background, paint } = setup();
    expect(sampleColor(doc, 1, 2, { layerId: paint.id })).toBeNull();
    expect(sampleColor(doc, 0, 0, { layerId: paint.id })).toBeNull();
    expect(sampleColor(doc, 3, 2, { layerId: background.id })).toBeNull();
    expect(sampleColor(doc, 0, 0, { layerId: 'missing' })).toBeNull();
  });

  it('picks nothing off the canvas or between pixels', () => {
    const { doc, paint } = setup();
    for (const [x, y] of [
      [-1, 0],
      [4, 0],
      [0, -1],
      [0, 3],
      [0.5, 0],
    ]) {
      expect(sampleColor(doc, x, y, 'composite')).toBeNull();
    }
    // The layer's pixels don't extend it past the canvas either.
    paint.x = 2;
    expect(sampleColor(doc, 4, 1, { layerId: paint.id })).toBeNull();
  });
});
