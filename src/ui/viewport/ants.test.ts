import { describe, expect, it } from 'vitest';
import { Selection, traceSelectionOutline } from '../../core';
import type { AntPhaseKey, AntsOutline, DocumentPlacement } from './ants';
import {
  ANT_PHASES,
  AntPhaseCache,
  AntsOutlineCache,
  antDashes,
  antSegments,
  deviceRegion,
  lineWidthFor,
  outlineCell,
  staticLoopCount,
  traceAnts,
} from './ants';

/** A 1 × 1, 2 × 2, 4 × 4 and 16 × 16 square, apart: loops 4, 8, 16 and 64 pixels long. */
function squares(): Selection {
  return [
    { x: 0, y: 0, width: 1, height: 1 },
    { x: 4, y: 0, width: 2, height: 2 },
    { x: 10, y: 0, width: 4, height: 4 },
    { x: 20, y: 20, width: 16, height: 16 },
  ]
    .map((rect) => Selection.fromRect(40, 40, rect))
    .reduce((a, b) => a.union(b));
}

const byJson = (a: readonly number[], b: readonly number[]) =>
  JSON.stringify(a).localeCompare(JSON.stringify(b));

describe('outlineCell', () => {
  it('is about one CSS pixel when zoomed out, and 1 from about 67 % up', () => {
    const cells = [4, 1, 0.9, 0.7, 0.6, 0.5, 0.34, 0.25, 0.01].map(outlineCell);
    expect(cells).toEqual([1, 1, 1, 1, 2, 2, 3, 4, 100]);
  });
});

describe('traceAnts', () => {
  it('sorts the loops shortest first and measures them', () => {
    const outline = traceAnts(squares(), 1);
    expect([...outline.lengths]).toEqual([4, 8, 16, 64]);
    expect(outline.loops.map((loop) => loop.length / 2)).toEqual([4, 4, 4, 4]);
    expect(outline.vertices).toBe(16);
    expect(outline.bounds).toEqual({ x: 0, y: 0, width: 36, height: 36 });
  });

  it('keeps the document-space outline at 100 % and above', () => {
    const selection = squares().subtract(
      Selection.fromRect(40, 40, { x: 24, y: 24, width: 3, height: 5 }),
    );
    const ants = traceAnts(selection, outlineCell(1));
    const traced = traceSelectionOutline(selection);
    expect([...ants.loops].sort(byJson)).toEqual([...traced.loops].sort(byJson));
    expect(traceAnts(selection, outlineCell(8)).loops).toEqual(ants.loops);
  });

  it('has no bounds when nothing is big enough to show', () => {
    const outline = traceAnts(squares(), 32);
    expect(outline).toMatchObject({ loops: [], vertices: 0, bounds: null });
  });
});

describe('staticLoopCount', () => {
  it('counts the loops shorter than two dash periods on screen', () => {
    // On screen, at each zoom: 4, 8, 16 and 64 canvas pixels × zoom CSS pixels. Exactly 16
    // is long enough to animate.
    const outline = traceAnts(squares(), 1);
    const counts = [0.25, 0.5, 1, 2, 4].map((zoom) => staticLoopCount(outline, zoom));
    expect(counts).toEqual([3, 3, 2, 1, 0]);
  });
});

describe('lineWidthFor', () => {
  it('rounds the device pixel ratio, centring odd widths on a device pixel', () => {
    const widths = [0.5, 1, 1.25, 1.5, 2, 3].map(lineWidthFor);
    expect(widths).toEqual([
      { lineWidth: 1, nudge: 0.5 },
      { lineWidth: 1, nudge: 0.5 },
      { lineWidth: 1, nudge: 0.5 },
      { lineWidth: 2, nudge: 0 },
      { lineWidth: 2, nudge: 0 },
      { lineWidth: 3, nudge: 0.5 },
    ]);
  });
});

describe('antSegments', () => {
  it('lists every edge with where it starts round its loop', () => {
    const outline = traceAnts(squares(), 1);
    const segments = antSegments(outline);
    expect(segments.count).toBe(16);
    expect([...segments.starts]).toEqual([0, 1, 2, 3, 0, 2, 4, 6, 0, 4, 8, 12, 0, 16, 32, 48]);
    expect([...segments.loopLengths]).toEqual([
      ...[4, 4, 4, 4],
      ...[8, 8, 8, 8],
      ...[16, 16, 16, 16],
      ...[64, 64, 64, 64],
    ]);
    // The first edge runs from the first loop's first corner to its second.
    expect([...segments.ends.subarray(0, 4)]).toEqual(outline.loops[0].slice(0, 4));
    expect(segments.outline).toBe(outline);
  });

  it('closes each loop and leaves out edges of zero length', () => {
    const outline: AntsOutline = {
      ...traceAnts(squares(), 1),
      loops: [[0, 0, 2, 0, 2, 0, 2, 3, 0, 3]],
      lengths: Float64Array.of(10),
      vertices: 5,
    };
    const segments = antSegments(outline);
    expect(segments.count).toBe(4);
    expect([...segments.ends]).toEqual([0, 0, 2, 0, 2, 0, 2, 3, 2, 3, 0, 3, 0, 3, 0, 0]);
    expect([...segments.starts]).toEqual([0, 2, 5, 7]);
    expect([...segments.loopLengths]).toEqual([10, 10, 10, 10]);
  });
});

describe('antDashes', () => {
  it('gives where the dashes stand at each edge, and flags the loops too short to animate', () => {
    // At dpr 1.25 the period is 10 device pixels. At 1.5 device pixels per canvas pixel, the
    // 4 × 4 square's edges start 0, 6, 12 and 18 device pixels round: 0, 6, 2 and 8 into a
    // period; the 16 × 16 square's 0, 24, 48 and 72: 0, 4, 8 and 2. At zoom 1.2 the loops
    // 4 and 8 canvas pixels long are 4.8 and 9.6 CSS pixels: too short to animate.
    const segments = antSegments(traceAnts(squares(), 1));
    const dashes = antDashes(segments, 1.5, 1.2, 1.25);
    const at = (i: number) => [dashes[i * 2], dashes[i * 2 + 1]];
    expect([0, 1, 2, 3].map(at)).toEqual([
      [0, 1],
      [1.5, 1],
      [3, 1],
      [4.5, 1],
    ]);
    expect([4, 5, 6, 7].map(at).map(([, still]) => still)).toEqual([1, 1, 1, 1]);
    expect([8, 9, 10, 11].map(at)).toEqual([
      [0, 0],
      [6, 0],
      [2, 0],
      [8, 0],
    ]);
    expect([12, 13, 14, 15].map(at)).toEqual([
      [0, 0],
      [4, 0],
      [8, 0],
      [2, 0],
    ]);
  });

  it('fills the array it is given', () => {
    const segments = antSegments(traceAnts(squares(), 1));
    const out = new Float32Array(40);
    expect(antDashes(segments, 1.25, 1, 1, out)).toBe(out);
    // The 16 × 16 square's second edge starts 16 canvas pixels round: 20 device pixels, 4
    // into the 8-pixel period.
    expect(out[13 * 2]).toBe(4);
    expect(out[13 * 2 + 1]).toBe(0);
  });
});

/** An outline cache whose traces are recorded by cell size. */
function countingCache(): { cache: AntsOutlineCache; cells: number[] } {
  const cells: number[] = [];
  const cache = new AntsOutlineCache((selection, cell) => {
    cells.push(cell);
    return traceAnts(selection, cell);
  });
  return { cache, cells };
}

describe('AntsOutlineCache', () => {
  it('traces once per selection and zoom bucket, so panning never retraces', () => {
    const { cache, cells } = countingCache();
    const selection = squares();
    const quarter = cache.get(selection, 0.25, false);
    expect(cells).toEqual([4]);
    // Panning draws at the same zoom; 26 % is in the same bucket.
    for (let i = 0; i < 5; i++) expect(cache.get(selection, 0.25, false)).toBe(quarter);
    expect(cache.get(selection, 0.26, false)).toBe(quarter);
    expect(cells).toEqual([4]);
    const half = cache.get(selection, 0.5, false);
    expect(half.cell).toBe(2);
    expect(cells).toEqual([4, 2]);
    // Back to an earlier zoom: still cached.
    expect(cache.get(selection, 0.25, false)).toBe(quarter);
    expect(cells).toEqual([4, 2]);
  });

  it('retraces for a new selection', () => {
    const { cache, cells } = countingCache();
    const first = squares();
    cache.get(first, 0.25, false);
    cache.get(first, 0.5, false);
    const second = first.invert();
    expect(cache.get(second, 0.5, false).selection).toBe(second);
    expect(cache.get(second, 0.25, false).selection).toBe(second);
    expect(cells).toEqual([4, 2, 2, 4]);
  });

  it('keeps the previous outline while a wheel zoom is in progress', () => {
    const { cache, cells } = countingCache();
    const selection = squares();
    const quarter = cache.get(selection, 0.25, false);
    expect(cache.get(selection, 0.4, true)).toBe(quarter);
    expect(cache.get(selection, 0.5, true)).toBe(quarter);
    expect(cells).toEqual([4]);
    // The zoom settles: trace for where it ended.
    const half = cache.get(selection, 0.5, false);
    expect(half.cell).toBe(2);
    // Zooming back through a traced bucket uses it straight away.
    expect(cache.get(selection, 0.25, true)).toBe(quarter);
    expect(cells).toEqual([4, 2]);
    // A new selection mid-zoom has nothing to fall back on.
    expect(cache.get(selection.invert(), 0.3, true).cell).toBe(3);
  });

  it('keeps the four zoom levels used most recently', () => {
    const { cache, cells } = countingCache();
    const selection = squares();
    for (const zoom of [1, 0.5, 0.34, 0.25, 0.2]) cache.get(selection, zoom, false);
    cache.get(selection, 0.5, false);
    expect(cells).toEqual([1, 2, 3, 4, 5]);
    cache.get(selection, 1, false);
    expect(cells).toEqual([1, 2, 3, 4, 5, 1]);
  });

  it('forgets everything when cleared', () => {
    const { cache, cells } = countingCache();
    const selection = squares();
    cache.get(selection, 0.25, false);
    cache.clear();
    cache.get(selection, 0.25, false);
    expect(cells).toEqual([4, 4]);
  });
});

const PLACEMENT: DocumentPlacement = { x: 10, y: 20, width: 80, height: 80, scaleX: 2, scaleY: 2 };

describe('deviceRegion', () => {
  const bounds = { x: 5, y: 5, width: 10, height: 10 };

  it('maps the bounds to device pixels and pads them', () => {
    expect(deviceRegion(bounds, PLACEMENT, 2, 200, 200)).toEqual({
      x: 18,
      y: 28,
      width: 24,
      height: 24,
    });
  });

  it('cuts the region to the overlay', () => {
    expect(deviceRegion(bounds, PLACEMENT, 2, 30, 40)).toEqual({
      x: 18,
      y: 28,
      width: 12,
      height: 12,
    });
    const away = { ...PLACEMENT, x: -100 };
    expect(deviceRegion(bounds, away, 2, 200, 200)).toBeNull();
  });
});

interface FakeImage {
  readonly id: number;
  phase: number;
}

function phaseCache(): { cache: AntPhaseCache<FakeImage>; reused: (FakeImage | null)[] } {
  let next = 0;
  const reused: (FakeImage | null)[] = [];
  const cache = new AntPhaseCache<FakeImage>((_key, phase, reuse) => {
    reused.push(reuse);
    if (!reuse) return { id: next++, phase };
    reuse.phase = phase;
    return reuse;
  });
  return { cache, reused };
}

function phaseKey(outline: AntsOutline): AntPhaseKey {
  return {
    outline,
    staticCount: 1,
    placement: PLACEMENT,
    dpr: 1.25,
    region: { x: 8, y: 18, width: 84, height: 84 },
  };
}

describe('AntPhaseCache', () => {
  it('renders each phase once, then reuses them every cycle', () => {
    const { cache } = phaseCache();
    const key = phaseKey(traceAnts(squares(), 1));
    const first = Array.from({ length: ANT_PHASES }, (_, phase) => cache.get(key, phase));
    expect(cache.rendered).toBe(ANT_PHASES);
    expect(new Set(first.map((image) => image.id)).size).toBe(ANT_PHASES);
    expect(first.map((image) => image.phase)).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
    for (let step = 0; step < 3 * ANT_PHASES; step++) {
      // An equal key, even a copy, keeps the phases.
      expect(cache.get({ ...key }, step % ANT_PHASES)).toBe(first[step % ANT_PHASES]);
    }
    expect(cache.rendered).toBe(ANT_PHASES);
  });

  it('starts again on a pan, zoom, selection, dpr or overlay change, reusing images', () => {
    const outline = traceAnts(squares(), 1);
    const key = phaseKey(outline);
    const changes: Partial<AntPhaseKey>[] = [
      { placement: { ...PLACEMENT, x: 11 } },
      { placement: { ...PLACEMENT, y: 19 } },
      { placement: { ...PLACEMENT, scaleX: 2.5, scaleY: 2.5 } },
      { outline: traceAnts(squares(), 1) },
      { staticCount: 2 },
      { dpr: 2 },
      { region: { ...key.region, width: 83 } },
    ];
    for (const change of changes) {
      const { cache, reused } = phaseCache();
      const before = [cache.get(key, 0), cache.get(key, 1)];
      const changed = { ...key, ...change };
      const after = cache.get(changed, 0);
      expect(cache.rendered).toBe(3);
      expect(before).toContain(after);
      expect(reused).toEqual([null, null, after]);
      expect(cache.get(changed, 0)).toBe(after);
    }
  });

  it('drops its images when released', () => {
    const { cache, reused } = phaseCache();
    const key = phaseKey(traceAnts(squares(), 1));
    cache.get(key, 0);
    cache.release();
    cache.get(key, 0);
    expect(reused).toEqual([null, null]);
    expect(cache.rendered).toBe(2);
  });
});
