import type { ImageDocument } from './document';
import { createDocument } from './document';
import type { RasterLayer } from './layer';
import { createRasterLayer } from './layer';
import type { PixelBuffer, Rgba } from './pixel-buffer';

export const DEFAULT_DOCUMENT_WIDTH = 800;
export const DEFAULT_DOCUMENT_HEIGHT = 600;

/**
 * The document shown at startup: a transparent "Background" layer and, above it, an
 * offset "Test Pattern" layer with a gradient and a few overlapping translucent shapes.
 */
export function createDemoDocument(): ImageDocument {
  const doc = createDocument(DEFAULT_DOCUMENT_WIDTH, DEFAULT_DOCUMENT_HEIGHT);
  const background = createRasterLayer({
    name: 'Background',
    width: doc.width,
    height: doc.height,
  });
  doc.layers.push(background, createTestPatternLayer());
  return doc;
}

function createTestPatternLayer(): RasterLayer {
  const layer = createRasterLayer({ name: 'Test Pattern', width: 680, height: 500, x: 60, y: 50 });
  const buf = layer.pixels;

  // Hue sweep across the top band, fading from opaque to transparent downwards.
  for (let y = 0; y < 180; y++) {
    const alpha = Math.round(255 * (1 - y / 180));
    for (let x = 0; x < buf.width; x++) {
      const [r, g, b] = hueToRgb(x / buf.width);
      paintOver(buf, x, y, [r, g, b, alpha], 1);
    }
  }

  fillCircle(buf, 190, 330, 120, [230, 57, 70, 255]);
  fillRectOver(buf, 300, 220, 260, 220, [29, 111, 214, 170]);
  fillCircle(buf, 520, 300, 90, [255, 209, 102, 200]);

  return layer;
}

function hueToRgb(h: number): [number, number, number] {
  const channel = (n: number): number => {
    const k = (n + h * 6) % 6;
    return Math.round(255 * (1 - Math.max(0, Math.min(k, 4 - k, 1))));
  };
  return [channel(5), channel(3), channel(1)];
}

function fillCircle(buf: PixelBuffer, cx: number, cy: number, radius: number, color: Rgba): void {
  const x0 = Math.max(0, Math.floor(cx - radius - 1));
  const x1 = Math.min(buf.width, Math.ceil(cx + radius + 1));
  const y0 = Math.max(0, Math.floor(cy - radius - 1));
  const y1 = Math.min(buf.height, Math.ceil(cy + radius + 1));
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const distance = Math.hypot(x + 0.5 - cx, y + 0.5 - cy);
      const coverage = Math.min(1, Math.max(0, radius - distance + 0.5));
      if (coverage > 0) paintOver(buf, x, y, color, coverage);
    }
  }
}

function fillRectOver(
  buf: PixelBuffer,
  x: number,
  y: number,
  width: number,
  height: number,
  color: Rgba,
): void {
  for (let py = Math.max(0, y); py < Math.min(buf.height, y + height); py++) {
    for (let px = Math.max(0, x); px < Math.min(buf.width, x + width); px++) {
      paintOver(buf, px, py, color, 1);
    }
  }
}

/** Straight-alpha "normal" paint of `color` at `coverage` (0–1) over one pixel. */
function paintOver(buf: PixelBuffer, x: number, y: number, color: Rgba, coverage: number): void {
  const d = buf.data;
  const i = (y * buf.width + x) * 4;
  const sa = (color[3] / 255) * coverage;
  const da = d[i + 3] / 255;
  const oa = sa + da * (1 - sa);
  if (oa <= 0) return;
  for (let c = 0; c < 3; c++) {
    d[i + c] = (color[c] * sa + d[i + c] * da * (1 - sa)) / oa;
  }
  d[i + 3] = oa * 255;
}
