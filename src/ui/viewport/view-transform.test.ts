import { describe, expect, it } from 'vitest';
import {
  MAX_ZOOM,
  MIN_ZOOM,
  centered,
  fitZoom,
  nextZoomStep,
  screenToDocument,
  zoomAt,
} from './view-transform';

describe('view transform', () => {
  it('keeps the document point under the cursor fixed when zooming', () => {
    const view = { zoom: 1, panX: 40, panY: 30 };
    const before = screenToDocument(view, 300, 200);
    const zoomed = zoomAt(view, 2.5, 300, 200);
    expect(zoomed.zoom).toBe(2.5);
    const after = screenToDocument(zoomed, 300, 200);
    expect(after[0]).toBeCloseTo(before[0]);
    expect(after[1]).toBeCloseTo(before[1]);
  });

  it('clamps zoom to the supported range', () => {
    const view = { zoom: 1, panX: 0, panY: 0 };
    expect(zoomAt(view, 1000, 0, 0).zoom).toBe(MAX_ZOOM);
    expect(zoomAt(view, 0, 0, 0).zoom).toBe(MIN_ZOOM);
  });

  it('fits and centers a document', () => {
    expect(fitZoom(800, 600, 448, 348, 24)).toBeCloseTo(0.5);
    expect(fitZoom(800, 600, 4000, 4000)).toBe(1);
    expect(centered(0.5, 800, 600, 1000, 500)).toEqual({ zoom: 0.5, panX: 300, panY: 100 });
  });

  it('steps through zoom presets', () => {
    expect(nextZoomStep(1, 1)).toBe(2);
    expect(nextZoomStep(1, -1)).toBeCloseTo(0.6667);
    expect(nextZoomStep(1.5, -1)).toBe(1);
    expect(nextZoomStep(MAX_ZOOM, 1)).toBe(MAX_ZOOM);
  });
});
