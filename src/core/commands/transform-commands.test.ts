import { describe, expect, it } from 'vitest';
import type { ImageDocument } from '../document';
import { createDocument, createLayerId } from '../document';
import { Editor } from '../editor';
import type { RasterLayer } from '../layer';
import { createRasterLayer } from '../layer';
import type { Orientation } from '../orientation';
import { orientPixels, orientedSize } from '../orientation';
import type { PixelBuffer } from '../pixel-buffer';
import { clonePixelBuffer, createPixelBuffer, fillRect, getPixel } from '../pixel-buffer';
import type { Affine } from '../resample/affine';
import {
  IDENTITY,
  aboutPivot,
  alignToPixels,
  rotation,
  scaling,
  translation,
} from '../resample/affine';
import type { Projective, Quad } from '../resample/projective';
import { compose, fromAffine, homographyFromQuad } from '../resample/projective';
import { transformPixels } from '../resample/transform';
import { Selection } from '../selection';
import { liftSelectionCommand } from './float-commands';
import { MoveLayerCommand } from './move-commands';
import { ORIENTATION_LABELS } from './orientation-commands';
import { orientLayerCommand, transformLayerCommand } from './transform-commands';

/** A buffer whose pixel (x, y) is [40x, 40y, n, 255], n counting from 1 in reading order. */
function numbered(width: number, height: number): PixelBuffer {
  const buffer = createPixelBuffer(width, height);
  for (let i = 0; i < width * height; i++) {
    buffer.data.set([(i % width) * 40, Math.floor(i / width) * 40, i + 1, 255], i * 4);
  }
  return buffer;
}

function addLayer(doc: ImageDocument, x: number, y: number, pixels: PixelBuffer): RasterLayer {
  const layer = createRasterLayer({ id: createLayerId(doc), name: 'Layer', x, y, pixels });
  doc.layers.push(layer);
  return layer;
}

function placement(layer: RasterLayer) {
  return { x: layer.x, y: layer.y, width: layer.pixels.width, height: layer.pixels.height };
}

/**
 * A turn of `degrees` clockwise about the layer's centre, shifted by less than a pixel so
 * that its bounds start on a pixel corner (`alignToPixels`).
 */
function turn(layer: RasterLayer, degrees: number): Affine {
  const area = placement(layer);
  const centre = aboutPivot(rotation(degrees), area.x + area.width / 2, area.y + area.height / 2);
  return alignToPixels(centre, area);
}

/**
 * The homography taking the layer's corners to `quad` moved by the layer's position: `quad`
 * is relative to its top-left corner.
 */
function distortion(layer: RasterLayer, quad: Quad): Projective {
  const at = quad.map((p) => ({ x: p.x + layer.x, y: p.y + layer.y }));
  const m = homographyFromQuad(placement(layer), [at[0], at[1], at[2], at[3]]);
  if (!m) throw new Error('Not a convex quad');
  return m;
}

describe('TransformLayerCommand', () => {
  it('turns exactly by aligned quarter turns, even with bilinear interpolation', () => {
    const turns: [number, Orientation, { x: number; y: number }][] = [
      // A 3 × 2 layer at (5, 4) has its centre at (6.5, 5). Turned a quarter, its corners
      // reach (5.5, 3.5), so it moves on half a pixel away from (5, 4), to (6, 3).
      [90, 'rotate-cw', { x: 6, y: 3 }],
      [-90, 'rotate-ccw', { x: 6, y: 3 }],
      [180, 'rotate-180', { x: 5, y: 4 }],
    ];
    for (const [degrees, orientation, at] of turns) {
      const doc = createDocument(12, 12);
      const layer = addLayer(doc, 5, 4, numbered(3, 2));
      const command = transformLayerCommand(doc, layer.id, turn(layer, degrees), 'bilinear');
      if (command) new Editor(doc).history.execute(command);
      expect({ ...placement(layer), data: layer.pixels.data }).toEqual({
        ...at,
        ...orientedSize(orientation, 3, 2),
        data: orientPixels(orientation, numbered(3, 2).data, 3, 2, 4),
      });
    }
  });

  it('anti-aliases the edges of other angles without darkening them', () => {
    const doc = createDocument(40, 40);
    const pixels = createPixelBuffer(20, 10);
    fillRect(pixels, { x: 0, y: 0, width: 20, height: 10 }, [255, 0, 0, 255]);
    const layer = addLayer(doc, 10, 15, pixels);
    const command = transformLayerCommand(doc, layer.id, turn(layer, 15), 'bilinear');
    if (command) new Editor(doc).history.execute(command);
    // The 20 × 10 rect turned 15° about its centre (20, 20) reaches 10 cos 15° + 5 sin 15°
    // ≈ 10.95 across and 10 sin 15° + 5 cos 15° ≈ 7.42 down from it: (9.05, 12.58) to
    // (30.95, 27.42). Shifted to start on (9, 13), it ends at (30.91, 27.84): 22 × 15 pixels.
    expect(placement(layer)).toEqual({ x: 9, y: 13, width: 22, height: 15 });
    expect(getPixel(layer.pixels, 11, 7)).toEqual([255, 0, 0, 255]);
    const { data } = layer.pixels;
    let partial = 0;
    const darkened: number[] = [];
    for (let i = 0; i < data.length; i += 4) {
      if (data[i + 3] > 0 && data[i + 3] < 255) partial++;
      // Edges fade to transparent without darkening: visible pixels stay pure red.
      const [r, g, b] = data[i + 3] === 0 ? [0, 0, 0] : [255, 0, 0];
      if (data[i] !== r || data[i + 1] !== g || data[i + 2] !== b) darkened.push(i / 4);
    }
    expect(partial).toBeGreaterThan(0);
    expect(darkened).toEqual([]);
  });

  it('undoes to the very same pixels and position, and redoes without resampling again', () => {
    const doc = createDocument(10, 10);
    const original = numbered(3, 2);
    const copy = clonePixelBuffer(original);
    const layer = addLayer(doc, 2, 3, original);
    const editor = new Editor(doc);
    const command = transformLayerCommand(doc, layer.id, turn(layer, 30), 'bilinear');
    if (!command) throw new Error('Nothing to rotate');
    editor.history.execute(command);
    const rotated = layer.pixels;
    expect(rotated).not.toBe(original);
    expect(editor.isDirty).toBe(true);
    editor.history.undo();
    expect(layer.pixels).toBe(original);
    expect(layer.pixels.data).toEqual(copy.data);
    expect([layer.x, layer.y]).toEqual([2, 3]);
    editor.history.redo();
    expect(layer.pixels).toBe(rotated);
  });

  it('reports the old and new bounds and the layer’s pixels', () => {
    const doc = createDocument(10, 10);
    const layer = addLayer(doc, 2, 3, numbered(3, 2));
    const command = transformLayerCommand(doc, layer.id, translation(4, -2), 'nearest');
    expect(command?.label).toBe('Transform Layer');
    expect(command?.apply(doc)).toEqual({
      dirty: { x: 2, y: 1, width: 7, height: 4 },
      layerPixels: [{ layerId: layer.id, rect: null }],
    });
    expect(placement(layer)).toEqual({ x: 6, y: 1, width: 3, height: 2 });
    expect(layer.pixels.data).toEqual(numbered(3, 2).data);
  });

  it('refuses transforms that change nothing or flatten the layer, and hidden or missing layers', () => {
    const doc = createDocument(8, 8);
    const layer = addLayer(doc, 0, 0, numbered(2, 2));
    expect(transformLayerCommand(doc, layer.id, IDENTITY, 'bilinear')).toBeNull();
    expect(transformLayerCommand(doc, layer.id, fromAffine(IDENTITY), 'bilinear')).toBeNull();
    expect(transformLayerCommand(doc, layer.id, scaling(0, 1), 'bilinear')).toBeNull();
    expect(
      transformLayerCommand(doc, layer.id, [1, 0, 0, 0, 1, 0, 1, 1, 0], 'bilinear'),
    ).toBeNull();
    expect(transformLayerCommand(doc, 'nope', scaling(2), 'bilinear')).toBeNull();
    layer.visible = false;
    expect(transformLayerCommand(doc, layer.id, scaling(2), 'bilinear')).toBeNull();
  });

  it('refuses a perspective that would take part of the layer past its horizon', () => {
    const doc = createDocument(8, 8);
    const layer = addLayer(doc, 0, 0, numbered(2, 2));
    // w = 1 − x / 1.5 is 0 at x = 1.5, inside the 2 px wide layer.
    const past: Projective = [1, 0, 0, 0, 1, 0, -1 / 1.5, 0, 1];
    expect(transformLayerCommand(doc, layer.id, past, 'bilinear')).toBeNull();
  });

  it('maps a layer through a perspective, and undoes to the very same pixels', () => {
    const doc = createDocument(40, 40);
    const original = numbered(6, 4);
    const copy = clonePixelBuffer(original);
    const layer = addLayer(doc, 5, 6, original);
    const m = distortion(layer, [
      { x: 2, y: 0 },
      { x: 10, y: -1 },
      { x: 13, y: 6 },
      { x: -1, y: 4 },
    ]);
    const editor = new Editor(doc);
    const command = transformLayerCommand(doc, layer.id, m, 'bilinear', { label: 'Distort' });
    if (!command) throw new Error('Nothing to distort');
    expect(command.label).toBe('Distort');
    expect(command.apply(doc)).toEqual({
      // The old place, (5, 6) to (11, 10), and the new one, (4, 5) to (18, 12).
      dirty: { x: 4, y: 5, width: 14, height: 7 },
      layerPixels: [{ layerId: layer.id, rect: null }],
    });
    command.revert(doc);
    editor.history.execute(command);
    const expected = transformPixels(original, compose(m, translation(5, 6)), 'bilinear');
    expect({ ...placement(layer), data: layer.pixels.data }).toEqual({
      x: 4,
      y: 5,
      width: 14,
      height: 7,
      data: expected?.pixels.data,
    });
    editor.history.undo();
    expect(layer.pixels).toBe(original);
    expect(layer.pixels.data).toEqual(copy.data);
    expect([layer.x, layer.y]).toEqual([5, 6]);
  });

  it('keeps only the canvas when a layer would grow past the maximum size', () => {
    const doc = createDocument(10, 10);
    const pixels = createPixelBuffer(3000, 1);
    for (let x = 0; x < 3000; x++) pixels.data.set([x % 256, 0, 0, 255], x * 4);
    const layer = addLayer(doc, 0, 0, pixels);
    const command = transformLayerCommand(doc, layer.id, scaling(3), 'nearest');
    if (command) new Editor(doc).history.execute(command);
    // 9000 × 3 is too big, so just the canvas's part: source pixel x covers 3x to 3x + 2.
    expect(placement(layer)).toEqual({ x: 0, y: 0, width: 10, height: 3 });
    expect(getPixel(layer.pixels, 4, 2)).toEqual([1, 0, 0, 255]);
    expect(getPixel(layer.pixels, 9, 0)).toEqual([3, 0, 0, 255]);
  });
});

describe('OrientLayerCommand', () => {
  const ALL: Orientation[] = [
    'rotate-cw',
    'rotate-ccw',
    'rotate-180',
    'flip-horizontal',
    'flip-vertical',
  ];

  it('moves the pixels exactly, about the layer’s centre', () => {
    // A 3 × 2 layer at (5, 4) has its centre at (6.5, 5). Turned a quarter either way, its
    // corners reach (5.5, 3.5), so it moves on half a pixel away from (5, 4), to (6, 3).
    const at: Record<Orientation, { x: number; y: number }> = {
      'rotate-cw': { x: 6, y: 3 },
      'rotate-ccw': { x: 6, y: 3 },
      'rotate-180': { x: 5, y: 4 },
      'flip-horizontal': { x: 5, y: 4 },
      'flip-vertical': { x: 5, y: 4 },
    };
    for (const orientation of ALL) {
      const doc = createDocument(12, 12);
      const layer = addLayer(doc, 5, 4, numbered(3, 2));
      const command = orientLayerCommand(doc, layer.id, orientation);
      expect(command?.label).toBe(ORIENTATION_LABELS[orientation]);
      if (command) new Editor(doc).history.execute(command);
      expect({ ...placement(layer), data: layer.pixels.data }).toEqual({
        ...at[orientation],
        ...orientedSize(orientation, 3, 2),
        data: orientPixels(orientation, numbered(3, 2).data, 3, 2, 4),
      });
    }
  });

  it('comes back to the same bytes and place', () => {
    const sequences: Orientation[][] = [
      ['flip-horizontal', 'flip-horizontal'],
      ['flip-vertical', 'flip-vertical'],
      ['rotate-180', 'rotate-180'],
      ['rotate-cw', 'rotate-ccw'],
      ['rotate-ccw', 'rotate-cw'],
      ['rotate-cw', 'rotate-cw', 'rotate-cw', 'rotate-cw'],
      ['rotate-ccw', 'rotate-ccw', 'rotate-180'],
      ['flip-horizontal', 'flip-vertical', 'rotate-180'],
    ];
    for (const sequence of sequences) {
      const doc = createDocument(12, 12);
      // Its sides differ by an odd number, so quarter turns land half a pixel off the grid.
      const layer = addLayer(doc, 5, 4, numbered(3, 2));
      const editor = new Editor(doc);
      for (const orientation of sequence) {
        const command = orientLayerCommand(doc, layer.id, orientation);
        if (command) editor.history.execute(command);
      }
      expect(placement(layer)).toEqual({ x: 5, y: 4, width: 3, height: 2 });
      expect(layer.pixels.data).toEqual(numbered(3, 2).data);
    }
  });

  it('reports both places and the layer’s pixels', () => {
    const doc = createDocument(12, 12);
    const layer = addLayer(doc, 5, 4, numbered(3, 2));
    // From 3 × 2 at (5, 4) to 2 × 3 at (6, 3).
    expect(orientLayerCommand(doc, layer.id, 'rotate-cw')?.apply(doc)).toEqual({
      dirty: { x: 5, y: 3, width: 3, height: 3 },
      layerPixels: [{ layerId: layer.id, rect: null }],
    });
  });

  it('undoes to the very same buffer and place, and redoes without copying again', () => {
    const doc = createDocument(12, 12);
    const original = numbered(3, 2);
    const layer = addLayer(doc, 5, 4, original);
    const editor = new Editor(doc);
    const command = orientLayerCommand(doc, layer.id, 'flip-horizontal');
    if (!command) throw new Error('Nothing to flip');
    editor.history.execute(command);
    const flipped = layer.pixels;
    expect(editor.history.undoLabel).toBe('Flip Horizontal');
    editor.history.undo();
    expect(layer.pixels).toBe(original);
    expect([layer.x, layer.y]).toEqual([5, 4]);
    editor.history.redo();
    expect(layer.pixels).toBe(flipped);
  });

  it('refuses hidden layers and missing ones', () => {
    const doc = createDocument(8, 8);
    const layer = addLayer(doc, 0, 0, numbered(2, 2));
    expect(orientLayerCommand(doc, 'nope', 'flip-vertical')).toBeNull();
    layer.visible = false;
    expect(orientLayerCommand(doc, layer.id, 'flip-vertical')).toBeNull();
  });
});

describe('Transforming a floating selection', () => {
  /**
   * An opaque 24 × 20 layer with a soft-edged elliptical selection lifted out of it and
   * moved one pixel right and down, as the Move tool leaves it.
   */
  function floatingSetUp() {
    const doc = createDocument(24, 20);
    const pixels = createPixelBuffer(24, 20);
    fillRect(pixels, { x: 0, y: 0, width: 24, height: 20 }, [30, 160, 90, 255]);
    const source = addLayer(doc, 0, 0, pixels);
    doc.selection = Selection.fromEllipse(24, 20, { x: 4, y: 3, width: 13, height: 9 });
    const editor = new Editor(doc);
    const lift = liftSelectionCommand(doc, source.id, false);
    if (!lift) throw new Error('Nothing to lift');
    editor.history.execute(lift);
    const lifted = editor.floating;
    const float = editor.activeLayer;
    if (!lifted || !float) throw new Error('Nothing floating');
    const moved = lifted.selection.translate(1, 1);
    editor.history.execute(
      new MoveLayerCommand(float.id, float.x + 1, float.y + 1, { selection: moved }),
    );
    return { doc, editor, float, moved };
  }

  /** Canvas pixels where the selection's coverage isn't the floating layer's alpha. */
  function misaligned(doc: ImageDocument, float: RasterLayer): string[] {
    const wrong: string[] = [];
    for (let y = 0; y < doc.height; y++) {
      for (let x = 0; x < doc.width; x++) {
        const alpha = getPixel(float.pixels, x - float.x, y - float.y)[3];
        if ((doc.selection?.coverageAt(x, y) ?? 0) !== alpha) wrong.push(`${x},${y}`);
      }
    }
    return wrong;
  }

  it('turns the outline with the pixels, so coverage matches their alpha', () => {
    const { doc, editor, float } = floatingSetUp();
    // Lifted from opaque pixels, the floating layer's alpha is the selection's coverage.
    expect(misaligned(doc, float)).toEqual([]);
    const command = transformLayerCommand(doc, float.id, turn(float, 30), 'bilinear', {
      floating: editor.floating,
    });
    if (command) editor.history.execute(command);
    const floating = editor.floating;
    expect(floating?.edited).toBe(true);
    expect(floating?.selection).toBe(doc.selection);
    expect([floating?.x, floating?.y]).toEqual([float.x, float.y]);
    expect(misaligned(doc, float)).toEqual([]);
  });

  it('undoes the outline and the floating selection with the pixels', () => {
    const { doc, editor, float, moved } = floatingSetUp();
    const before = editor.floating;
    const pixels = float.pixels;
    const command = transformLayerCommand(doc, float.id, turn(float, -40), 'bilinear', {
      floating: before,
    });
    if (command) editor.history.execute(command);
    const after = editor.floating;
    const outline = doc.selection;
    editor.history.undo();
    expect(editor.floating).toBe(before);
    expect(doc.selection?.equals(moved)).toBe(true);
    expect(float.pixels).toBe(pixels);
    editor.history.redo();
    expect(editor.floating).toBe(after);
    expect(doc.selection).toBe(outline);
  });

  it('distorts the outline with the pixels through a perspective', () => {
    for (const interpolation of ['nearest', 'bilinear'] as const) {
      const { doc, editor, float } = floatingSetUp();
      const { width, height } = float.pixels;
      const m = distortion(float, [
        { x: 2, y: -1 },
        { x: width + 3, y: 1 },
        { x: width - 1, y: height + 2 },
        { x: -2, y: height },
      ]);
      const command = transformLayerCommand(doc, float.id, m, interpolation, {
        floating: editor.floating,
      });
      if (command) editor.history.execute(command);
      const floating = editor.floating;
      expect(floating?.edited).toBe(true);
      expect(floating?.selection).toBe(doc.selection);
      expect(misaligned(doc, float)).toEqual([]);
    }
  });

  it('turns and flips the outline exactly with the pixels', () => {
    for (const orientation of ['rotate-cw', 'flip-vertical'] as const) {
      const { doc, editor, float } = floatingSetUp();
      const command = orientLayerCommand(doc, float.id, orientation, editor.floating);
      if (command) editor.history.execute(command);
      const floating = editor.floating;
      expect(floating?.edited).toBe(true);
      expect(floating?.selection).toBe(doc.selection);
      expect([floating?.x, floating?.y]).toEqual([float.x, float.y]);
      expect(misaligned(doc, float)).toEqual([]);
    }
  });

  it('moves the turned outline from where it was turned', () => {
    const { doc, editor, float } = floatingSetUp();
    const command = transformLayerCommand(doc, float.id, turn(float, 30), 'bilinear', {
      floating: editor.floating,
    });
    if (command) editor.history.execute(command);
    const turned = doc.selection;
    const floating = editor.floating;
    if (!turned || !floating) throw new Error('Nothing floating');
    // As the Move tool moves it: from the floating selection's outline and position.
    const x = float.x + 2;
    const selection = floating.selection.translate(x - floating.x, float.y - floating.y);
    editor.history.execute(new MoveLayerCommand(float.id, x, float.y, { selection }));
    expect(doc.selection?.equals(turned.translate(2, 0))).toBe(true);
    expect(misaligned(doc, float)).toEqual([]);
  });
});
