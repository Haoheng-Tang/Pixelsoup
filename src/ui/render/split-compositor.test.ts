import { describe, expect, it } from 'vitest';
import type { ImageDocument, Layer, PixelBuffer, Rect, Rgba } from '../../core';
import {
  compositeLayers,
  CpuCompositor,
  createDocument,
  createLayerId,
  createRasterLayer,
  Editor,
  fillRect,
} from '../../core';
import { FakeClock } from '../tools/fake-clock';
import { MoveTool } from '../tools/move-tool';
import { ToolManager } from '../tools/tool-manager';
import { FreeTransform } from '../transform/free-transform';
import { coalesceRects, SplitCompositor, suppressedLayer } from './split-compositor';

const RED: Rgba = [255, 0, 0, 255];
const GREEN: Rgba = [0, 255, 0, 255];
const BLUE: Rgba = [0, 0, 255, 255];

function addLayer(doc: ImageDocument, area: Rect, color: Rgba, opacity = 1): Layer {
  const layer = createRasterLayer({ id: createLayerId(doc), name: '', ...area, opacity });
  fillRect(layer.pixels, { x: 0, y: 0, width: area.width, height: area.height }, color);
  doc.layers.push(layer);
  return layer;
}

/**
 * A 12 × 10 canvas: opaque red all over, a green 4 × 4 square at (2, 2) to leave out, and
 * over it a blue one at half opacity at (5, 4).
 */
function setup() {
  const doc = createDocument(12, 10);
  const bottom = addLayer(doc, { x: 0, y: 0, width: 12, height: 10 }, RED);
  const middle = addLayer(doc, { x: 2, y: 2, width: 4, height: 4 }, GREEN);
  const top = addLayer(doc, { x: 5, y: 4, width: 4, height: 4 }, BLUE, 0.5);
  return { doc, bottom, middle, top, split: new SplitCompositor(12, 10) };
}

/** `layers` of `doc` composited on their own, as the document compositor does it. */
function composite(doc: ImageDocument, layers: readonly Layer[] = doc.layers): PixelBuffer {
  const compositor = new CpuCompositor(doc.width, doc.height);
  compositor.composite({ ...doc, layers: [...layers] });
  return compositor.output;
}

/** The output of `compositor` as a layer covering the canvas. */
function outputLayer(doc: ImageDocument, compositor: CpuCompositor): Layer {
  return createRasterLayer({ id: createLayerId(doc), name: '', pixels: compositor.output });
}

describe('SplitCompositor', () => {
  it('composite every layer into below while none is left out', () => {
    const { doc, split } = setup();
    expect(split.composite(doc)).toEqual({
      below: [{ x: 0, y: 0, width: 12, height: 10 }],
      above: [],
    });
    expect(split.below.output).toEqual(composite(doc));
    expect(split.suppressed).toBeNull();
    expect(split.above).toBeNull();
  });

  it('leave a layer out, and composite the layers above it on their own', () => {
    const { doc, bottom, middle, top, split } = setup();
    split.composite(doc);
    // Wherever the green square or anything above it was.
    const areas = split.suppress(doc, middle.id);
    expect(areas).toEqual([{ x: 2, y: 2, width: 7, height: 6 }]);
    expect(split.suppressed).toBe(middle.id);
    const updated = split.composite(doc, areas);
    expect(updated).toEqual({
      below: [{ x: 2, y: 2, width: 7, height: 6 }],
      above: [{ x: 5, y: 4, width: 4, height: 4 }],
    });
    expect(split.below.output).toEqual(composite(doc, [bottom]));
    expect(split.above?.output).toEqual(composite(doc, [top]));

    // Below, the layer and above, stacked, look as the whole stack does: at most one level
    // of rounding off where the translucent blue meets the green.
    const above = split.above;
    if (!above) throw new Error('No layers above');
    const stacked = compositeLayers(
      [outputLayer(doc, split.below), middle, outputLayer(doc, above)],
      { x: 0, y: 0, width: 12, height: 10 },
    );
    const whole = composite(doc);
    const difference = stacked.data.reduce(
      (most, value, i) => Math.max(most, Math.abs(value - whole.data[i])),
      0,
    );
    expect(difference).toBeLessThanOrEqual(1);
  });

  it('put the layer back exactly, after changes while it was left out', () => {
    const { doc, middle, top, split } = setup();
    split.composite(doc);
    split.composite(doc, split.suppress(doc, middle.id));
    // The blue square moves while the green one is left out, as a command would move it.
    top.x = 7;
    const update = split.composite(doc, [{ x: 5, y: 4, width: 6, height: 4 }]);
    expect(update.above).toEqual([{ x: 5, y: 4, width: 6, height: 4 }]);

    const areas = split.suppress(doc, null);
    expect(areas).toEqual([{ x: 2, y: 2, width: 9, height: 6 }]);
    expect(split.suppressed).toBeNull();
    expect(split.above).toBeNull();
    split.composite(doc, areas);
    expect(split.below.output).toEqual(composite(doc));
  });

  it('have nothing above the top layer', () => {
    const { doc, bottom, middle, top, split } = setup();
    split.composite(doc);
    expect(split.composite(doc, split.suppress(doc, top.id)).above).toEqual([]);
    expect(split.above).toBeNull();
    expect(split.below.output).toEqual(composite(doc, [bottom, middle]));
  });

  it('change nothing for a layer that isn’t in the document, or is already left out', () => {
    const { doc, middle, split } = setup();
    expect(split.suppress(doc, 'layer-99')).toEqual([]);
    expect(split.suppressed).toBeNull();
    expect(split.suppress(doc, null)).toEqual([]);
    split.suppress(doc, middle.id);
    expect(split.suppress(doc, middle.id)).toEqual([]);
  });
});

describe('coalesceRects', () => {
  it('join overlapping areas into one, and leave apart ones apart', () => {
    const a = { x: 0, y: 0, width: 10, height: 10 };
    const b = { x: 2, y: 2, width: 10, height: 10 };
    const far = { x: 50, y: 50, width: 2, height: 2 };
    expect(coalesceRects([a, b])).toEqual([{ x: 0, y: 0, width: 12, height: 12 }]);
    expect(coalesceRects([a, far])).toEqual([a, far]);
    expect(coalesceRects([a])).toEqual([a]);
    expect(coalesceRects([])).toEqual([]);
  });
});

describe('suppressedLayer', () => {
  it('leave out a Free Transform session’s layer until it is applied or cancelled', () => {
    const { doc, bottom, middle, split } = setup();
    const editor = new Editor(doc);
    editor.setActiveLayer(middle.id);
    const tools = new ToolManager([new MoveTool(undefined, new FakeClock())], editor);
    const freeTransform = new FreeTransform(editor, tools);
    // What the viewport does at each redraw.
    let stale: Rect[] = [];
    editor.subscribe((change) => {
      if (change.dirty) stale.push(change.dirty);
    });
    const redraw = () => {
      const areas = split.suppress(doc, suppressedLayer(tools.overlay));
      split.composite(doc, coalesceRects([...areas, ...stale]));
      stale = [];
    };
    split.composite(doc);

    expect(freeTransform.start()).toBe(true);
    expect(suppressedLayer(tools.overlay)).toBe(middle.id);
    redraw();
    expect(split.below.output).toEqual(composite(doc, [bottom]));

    // Moved 3 px right, then applied: the green square shows where it went.
    expect(freeTransform.session?.setField('x', 7)).toBe(true);
    expect(freeTransform.session?.apply()).toBe(true);
    expect(suppressedLayer(tools.overlay)).toBeNull();
    redraw();
    expect(middle.x).toBe(5);
    expect(split.below.output).toEqual(composite(doc));

    expect(freeTransform.start()).toBe(true);
    redraw();
    expect(split.below.output).toEqual(composite(doc, [bottom]));
    freeTransform.session?.discard();
    expect(suppressedLayer(tools.overlay)).toBeNull();
    redraw();
    expect(split.below.output).toEqual(composite(doc));
  });
});
