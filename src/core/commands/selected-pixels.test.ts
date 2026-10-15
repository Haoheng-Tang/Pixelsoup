import { describe, expect, it } from 'vitest';
import { createDocument, createLayerId } from '../document';
import { createRasterLayer } from '../layer';
import type { PixelBuffer, Rgba } from '../pixel-buffer';
import { createPixelBuffer } from '../pixel-buffer';
import { Selection } from '../selection';
import { clearCommand } from './fill-commands';
import { copySelectedPixels, copySelection, splitSelectedPixels } from './selected-pixels';

function bufferOf(width: number, height: number, pixels: readonly Rgba[]): PixelBuffer {
  const buffer = createPixelBuffer(width, height);
  pixels.forEach((pixel, i) => buffer.data.set(pixel, i * 4));
  return buffer;
}

function pixelsOf(buffer: PixelBuffer): number[][] {
  const pixels: number[][] = [];
  for (let i = 0; i < buffer.data.length; i += 4) pixels.push([...buffer.data.subarray(i, i + 4)]);
  return pixels;
}

const RED: Rgba = [255, 0, 0, 255];
const BLUE: Rgba = [0, 0, 255, 255];
const NONE = [0, 0, 0, 0];

// Full, zero and partial coverage; a transparent pixel; one too faint to take any of.
const SOURCE: Rgba[] = [
  [200, 100, 50, 255],
  [10, 20, 30, 255],
  [90, 80, 70, 255],
  [40, 50, 60, 200],
  [7, 7, 7, 0],
  [1, 2, 3, 1],
];
const COVERAGE = [255, 0, 128, 128, 255, 100];
const TAKEN = [
  [200, 100, 50, 255], // all of it
  NONE, // not selected
  [90, 80, 70, 128], // 255 × 128/255 = 128
  [40, 50, 60, 100], // 200 × 128/255 = 100.4
  NONE, // nothing to take
  NONE, // 1 × 100/255 = 0.39 rounds to 0
];
const LEFT = [
  NONE, // all taken
  [10, 20, 30, 255],
  [90, 80, 70, 127], // 255 − 128
  [40, 50, 60, 100], // 200 − 100 (= 200 × 127/255 = 99.6, rounded)
  [7, 7, 7, 0],
  [1, 2, 3, 1],
];

describe('splitSelectedPixels', () => {
  it('takes each pixel weighted by coverage, and with cut leaves the rest', () => {
    const source = { pixels: bufferOf(6, 1, SOURCE), x: 0, y: 0 };
    const target = { pixels: createPixelBuffer(6, 1), x: 0, y: 0 };
    const selection = Selection.fromMask(6, 1, COVERAGE);

    const area = splitSelectedPixels(source, selection, target, true);
    expect(area).toEqual({ x: 0, y: 0, width: 6, height: 1 });
    expect(pixelsOf(target.pixels)).toEqual(TAKEN);
    expect(pixelsOf(source.pixels)).toEqual(LEFT);
  });

  it('leaves the source alone without cut, and works in canvas space', () => {
    // A 2×1 layer at (3, 0) on a 6×1 canvas, the target a 4×1 buffer at (2, 0).
    const source = { pixels: bufferOf(2, 1, [RED, BLUE]), x: 3, y: 0 };
    const target = { pixels: createPixelBuffer(4, 1), x: 2, y: 0 };
    const selection = Selection.fromMask(6, 1, [0, 0, 255, 255, 51, 0]);

    expect(splitSelectedPixels(source, selection, target, false)).toEqual({
      x: 3,
      y: 0,
      width: 2,
      height: 1,
    });
    // 255 × 51/255 = 51.
    expect(pixelsOf(target.pixels)).toEqual([NONE, RED, [0, 0, 255, 51], NONE]);
    expect(pixelsOf(source.pixels)).toEqual([RED, BLUE]);
  });

  it('returns null when the selection misses the source', () => {
    const source = { pixels: bufferOf(1, 1, [RED]), x: 0, y: 0 };
    const selection = Selection.fromMask(3, 1, [0, 0, 255]);
    expect(splitSelectedPixels(source, selection, null, true)).toBeNull();
    expect(pixelsOf(source.pixels)).toEqual([RED]);
  });

  it('cuts exactly what Clear clears, and takes exactly what it leaves, at every level', () => {
    // Column c has coverage c, row a has alpha a: every coverage against every alpha.
    const doc = createDocument(256, 256);
    const pixels = createPixelBuffer(256, 256);
    for (let a = 0; a < 256; a++) {
      for (let c = 0; c < 256; c++) {
        pixels.data.set(a === 0 ? [0, 0, 0, 0] : [c, 255 - c, a, a], (a * 256 + c) * 4);
      }
    }
    const layer = createRasterLayer({ id: createLayerId(doc), name: 'L', pixels });
    doc.layers.push(layer);
    const mask = new Uint8Array(256 * 256);
    for (let i = 0; i < mask.length; i++) mask[i] = i % 256;
    doc.selection = Selection.fromMask(256, 256, mask);

    const copied = copySelection(doc, { layerId: layer.id });
    const cut = { pixels: createPixelBuffer(256, 256), x: 0, y: 0 };
    const original = { ...layer, pixels: { ...pixels, data: pixels.data.slice() } };
    splitSelectedPixels(original, doc.selection, cut, true);
    clearCommand(doc, layer.id)!.apply(doc);

    // Column 0 has no coverage, so the copy starts at column 1.
    expect(copied).toMatchObject({ x: 1, y: 0, pixels: { width: 255, height: 256 } });
    let mismatches = 0;
    for (let y = 0; y < 256; y++) {
      for (let x = 0; x < 256; x++) {
        const i = (y * 256 + x) * 4;
        const j = (y * 255 + x - 1) * 4;
        for (let k = 0; k < 4; k++) {
          const copiedValue = x === 0 ? 0 : copied!.pixels.data[j + k];
          if (copiedValue !== cut.pixels.data[i + k]) mismatches++;
          if (original.pixels.data[i + k] !== layer.pixels.data[i + k]) mismatches++;
        }
        // What's taken and what's left add up to the whole pixel.
        if (cut.pixels.data[i + 3] + original.pixels.data[i + 3] !== y) mismatches++;
      }
    }
    expect(mismatches).toBe(0);
  });
});

describe('copySelectedPixels', () => {
  it('covers the selection bounds, transparent where the source does not reach', () => {
    // A 1×1 red layer at (2, 1); the selection covers (1, 1)–(2, 2) of a 4×3 canvas.
    const source = { pixels: bufferOf(1, 1, [RED]), x: 2, y: 1 };
    const selection = Selection.fromRect(4, 3, { x: 1, y: 1, width: 2, height: 2 });
    const copy = copySelectedPixels(source, selection);
    expect(copy).toMatchObject({ x: 1, y: 1 });
    expect(copy?.pixels).toMatchObject({ width: 2, height: 2 });
    expect(pixelsOf(copy!.pixels)).toEqual([NONE, RED, NONE, NONE]);
  });

  it('is null for an empty selection', () => {
    const source = { pixels: bufferOf(1, 1, [RED]), x: 0, y: 0 };
    expect(copySelectedPixels(source, Selection.empty(1, 1))).toBeNull();
  });
});

describe('copySelection', () => {
  function setup() {
    // Red below, a blue pixel above it at x = 1, and a hidden green layer over all.
    const doc = createDocument(3, 1);
    const red = createRasterLayer({
      id: createLayerId(doc),
      name: 'Red',
      pixels: bufferOf(3, 1, [RED, RED, RED]),
    });
    doc.layers.push(red);
    const blue = createRasterLayer({
      id: createLayerId(doc),
      name: 'Blue',
      x: 1,
      pixels: bufferOf(1, 1, [BLUE]),
    });
    doc.layers.push(blue);
    const green = createRasterLayer({
      id: createLayerId(doc),
      name: 'Green',
      visible: false,
      pixels: bufferOf(3, 1, [
        [0, 255, 0, 255],
        [0, 255, 0, 255],
        [0, 255, 0, 255],
      ]),
    });
    doc.layers.push(green);
    doc.selection = Selection.fromMask(3, 1, [255, 128, 0]);
    return { doc, red, blue, green };
  }

  it("copies one layer's selected pixels, hidden or not", () => {
    const { doc, red, green } = setup();
    const fromRed = copySelection(doc, { layerId: red.id });
    expect(fromRed).toMatchObject({ x: 0, y: 0 });
    expect(pixelsOf(fromRed!.pixels)).toEqual([RED, [255, 0, 0, 128]]);
    const fromGreen = copySelection(doc, { layerId: green.id });
    expect(pixelsOf(fromGreen!.pixels)).toEqual([
      [0, 255, 0, 255],
      [0, 255, 0, 128],
    ]);
  });

  it('copies the composite of the visible layers for Copy Merged', () => {
    const { doc } = setup();
    const merged = copySelection(doc, 'composite');
    expect(merged).toMatchObject({ x: 0, y: 0 });
    expect(pixelsOf(merged!.pixels)).toEqual([RED, [0, 0, 255, 128]]);
  });

  it('is null without a selection or for a missing layer', () => {
    const { doc } = setup();
    expect(copySelection(doc, { layerId: 'layer-9' })).toBeNull();
    doc.selection = null;
    expect(copySelection(doc, 'composite')).toBeNull();
  });
});
